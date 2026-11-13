import { AppError } from '../../errors/AppError.js';
import { env } from '../../../env.js';
import { logger } from '../../observability/logger.js';

// =====================================================================
// EvolutionAdmin — wrapper administrativo do Evolution API.
//
// Diferença pro EvolutionAdapter: o adapter conversa COM UMA INSTÂNCIA
// específica (provisionada e pareada) usando o token dela. O admin opera
// no nível do gateway — cria/destroi instâncias, lê QR, checa estado —
// usando a master key global (`AUTHENTICATION_API_KEY` do container).
//
// Singleton porque a config (baseUrl + masterKey + webhookBaseUrl) é
// global ao chat backend. Métodos chamam Evolution via fetch nativo.
// =====================================================================

export interface CreateInstanceParams {
  instanceName: string;
  integration: 'baileys' | 'meta_cloud';
  // URL que o Evolution chama com eventos do webhook. Evolution exige path
  // absoluto. Default: `${webhookBaseUrl}/webhook/whatsapp/${channelId}`.
  webhookUrl: string;
  // Token Bearer pro `verifyWebhook` do EvolutionAdapter validar requests
  // que chegam do Evolution. Gerado pelo caller (provisioning).
  webhookToken: string;
}

export interface CreateInstanceResult {
  // Nome final que ficou registrado no Evolution (== params.instanceName).
  instanceName: string;
  // Token específico da instância. Use este — não a master key — pra
  // chamar /message/send* depois (princípio do menor privilégio).
  instanceApiKey: string;
}

export interface ConnectionStateResult {
  // Evolution responde com vários nomes ('open' / 'connecting' / 'close').
  // Normalizamos aqui pra reduzir ramificações no caller.
  state: 'open' | 'connecting' | 'closed' | 'unknown';
  raw: Record<string, unknown>;
}

export interface QrCodeResult {
  // Base64 da imagem PNG do QR code (data URL inclui prefix). Pode vir vazio
  // se a instância já está pareada — caller deve cheque connection-state
  // antes de pedir QR.
  base64: string | null;
  // Código de pareamento alternativo via número (Evolution v2 suporta).
  pairingCode?: string;
}

class EvolutionAdminImpl {
  private get baseUrl(): string {
    return env.evolution.baseUrl;
  }

  private get masterKey(): string {
    return env.evolution.apiKey;
  }

  // Webhook URL completo pra um canal: webhookBaseUrl é o endpoint público do
  // chat (acessível pelo container Evolution); o `:channelId` é mapeado pelo
  // route handler interno.
  buildWebhookUrl(channelId: string): string {
    return `${env.evolution.webhookBaseUrl.replace(/\/$/, '')}/webhook/whatsapp/${channelId}`;
  }

  async createInstance(
    params: CreateInstanceParams,
  ): Promise<CreateInstanceResult> {
    // Map nossos enums pros nomes do Evolution.
    const evolutionIntegration =
      params.integration === 'baileys' ? 'WHATSAPP-BAILEYS' : 'WHATSAPP-BUSINESS';

    const body = {
      instanceName: params.instanceName,
      integration: evolutionIntegration,
      qrcode: true,
      // Settings padrão razoáveis pra contexto clínica:
      rejectCall: false,
      groupsIgnore: true,
      alwaysOnline: false,
      readMessages: false,
      readStatus: false,
      syncFullHistory: false,
      webhook: {
        url: params.webhookUrl,
        byEvents: false, // single URL recebe TODOS os events
        base64: false, // mídia chega como URL, não inline
        headers: {
          Authorization: `Bearer ${params.webhookToken}`,
          'Content-Type': 'application/json',
        },
        // Eventos de interesse. CONNECTION_UPDATE alimenta
        // whatsapp_channels.connection_state (UI exibe estado do socket sem
        // polling). Evolution+Baileys pode disparar dezenas/s durante
        // reconexão — pipeline filtra "estado mudou" antes de gravar.
        events: [
          'MESSAGES_UPSERT',
          'MESSAGES_UPDATE',
          'SEND_MESSAGE',
          'CONNECTION_UPDATE',
        ],
      },
    };

    interface CreateResponse {
      instance?: { instanceName?: string; instanceId?: string };
      // Evolution v2.1.x retorna `hash` como string direta. Versões antigas
      // (v2.0.x e a doc oficial) mostram `{ apikey: "..." }`. Aceitamos ambos
      // pra resiliência entre upgrades minor da imagem.
      hash?: string | { apikey?: string };
    }

    const data = await this.post<CreateResponse>('/instance/create', body);
    const rawHash = data.hash;
    const instanceApiKey =
      typeof rawHash === 'string' ? rawHash : rawHash?.apikey;
    if (!instanceApiKey) {
      logger.error(
        { instanceName: params.instanceName, responseKeys: Object.keys(data) },
        '[EvolutionAdmin] response sem hash/apikey — shape mudou?',
      );
      throw new AppError(
        'Evolution criou instância mas não retornou apikey específica',
        502,
      );
    }
    logger.info(
      { instanceName: params.instanceName, integration: params.integration },
      '[EvolutionAdmin] instância criada',
    );
    return {
      instanceName: data.instance?.instanceName ?? params.instanceName,
      instanceApiKey,
    };
  }

  async getQrCode(instanceName: string): Promise<QrCodeResult> {
    interface ConnectResponse {
      code?: string;
      base64?: string;
      pairingCode?: string;
    }
    // GET /instance/connect/{instance} — Evolution v2 retorna QR atual ou
    // status do socket se já conectado.
    const data = await this.get<ConnectResponse>(
      `/instance/connect/${encodeURIComponent(instanceName)}`,
    );
    return {
      base64: data.base64 ?? null,
      pairingCode: data.pairingCode,
    };
  }

  async getConnectionState(instanceName: string): Promise<ConnectionStateResult> {
    interface StateResponse {
      instance?: { state?: string };
    }
    const data = await this.get<StateResponse>(
      `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    );
    const raw = data as Record<string, unknown>;
    const stateRaw = data.instance?.state?.toLowerCase() ?? '';
    let state: ConnectionStateResult['state'] = 'unknown';
    if (stateRaw === 'open') state = 'open';
    else if (stateRaw === 'connecting') state = 'connecting';
    else if (stateRaw === 'close' || stateRaw === 'closed') state = 'closed';
    return { state, raw };
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.delete(`/instance/delete/${encodeURIComponent(instanceName)}`);
    logger.info({ instanceName }, '[EvolutionAdmin] instância deletada');
  }

  // ---- HTTP helpers ----

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private async delete(path: string): Promise<void> {
    await this.request('DELETE', path);
  }

  private async request<T = unknown>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.masterKey,
      },
      signal: AbortSignal.timeout(15_000),
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetch(url, init).catch((err) => {
      throw new AppError(
        `Falha ao falar com Evolution (${method} ${path}): ${err instanceof Error ? err.message : err}`,
        502,
      );
    });

    const text = await res.text();
    if (!res.ok) {
      logger.warn(
        { path, method, status: res.status, body: text.slice(0, 500) },
        '[EvolutionAdmin] erro na chamada',
      );
      const message = (() => {
        try {
          const parsed = JSON.parse(text) as { message?: string | string[] };
          if (Array.isArray(parsed.message)) return parsed.message.join('; ');
          return parsed.message ?? `HTTP ${res.status}`;
        } catch {
          return `HTTP ${res.status}`;
        }
      })();
      throw new AppError(
        `Evolution: ${message}`,
        res.status >= 400 && res.status < 500 ? res.status : 502,
      );
    }

    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new AppError(
        `Evolution retornou payload não-JSON em ${path}`,
        502,
      );
    }
  }
}

// Singleton — config vem de env, não muda em runtime. Reinstanciar a cada
// chamada seria desperdício.
export const evolutionAdmin = new EvolutionAdminImpl();

// Tipo exportado pra facilitar testes que queiram mockar.
export type EvolutionAdmin = typeof evolutionAdmin;
