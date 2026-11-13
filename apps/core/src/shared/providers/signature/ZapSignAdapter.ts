import { AppError } from '../../errors/AppError.js';
import { logger } from '../../observability/logger.js';
import type { ISignatureProvider } from './ISignatureProvider.js';
import type {
  CreateFromTemplateInput,
  DocumentRef,
  DocumentStatus,
  NormalizedSignatureEvent,
  ProviderTemplateInfo,
  ProviderTemplateSummary,
  WebhookRequest,
} from './types.js';

// =====================================================================
// Adapter ZapSign — implementa ISignatureProvider.
// API REST documentada em https://docs.zapsign.com.br.
//
// Princípios:
// - Erros HTTP do ZapSign viram AppError com statusCode propagado.
// - Quando o adapter está sem token (`isConfigured = false`), métodos de
//   I/O lançam AppError 503 — defesa pra backend subir sem provisionar.
// - Webhook não tem assinatura HMAC nativa: a gente cadastra um header
//   custom no painel da ZapSign (X-Elora-Webhook-Token) e valida aqui.
// =====================================================================

export interface ZapSignConfig {
  apiToken: string | null;
  // Base URL define o ambiente:
  //   - https://api.zapsign.com.br/api/v1         → produção (requer Plano de API)
  //   - https://sandbox.api.zapsign.com.br/api/v1 → sandbox (gratuito, sem validade jurídica)
  // Não há flag de body — o ambiente é decidido pelo subdomínio.
  apiBaseUrl: string;
  webhookToken: string | null;
}

// Payload retornado por GET /models/{token}/. ZapSign mudou shape ao longo
// do tempo — tem template antigo com array `data_to_send: [{de: '{{x}}'}]`
// e template novo com `inputs: [{variable: 'x'}]`. Aceitamos os dois;
// `extractVariablesFromZapsignModel` consolida.
interface ZapSignModel {
  token?: string;
  name?: string;
  inputs?: Array<{ variable?: string; description?: string; type?: string }>;
  data_to_send?: Array<{ de?: string; para?: string }>;
  data?: Array<{ de?: string; para?: string }>;
  [key: string]: unknown;
}

// Resposta paginada de GET /models/ (DRF-style). Iteramos `next` até cap
// de páginas (segurança contra loop por payload mal-formado).
interface ZapSignModelsList {
  count?: number;
  next?: string | null;
  previous?: string | null;
  results?: Array<{ token?: string; name?: string }>;
}

// Payload retornado por POST /models/create-doc/ e GET /docs/{token}/.
// Tipamos só o que consumimos; demais campos vão preservados em metadata.
interface ZapSignDocument {
  open_id?: number | string;
  token: string;
  name?: string;
  status?: string;
  signed_file?: string | null;
  original_file?: string | null;
  created_at?: string;
  last_update_at?: string;
  signers?: Array<{
    token?: string;
    name?: string;
    sign_url?: string;
    status?: string;
    signed_at?: string | null;
    times_viewed?: number;
    last_view_at?: string | null;
  }>;
}

// Eventos do webhook ZapSign (event_type). Mapeamos os relevantes pro
// nosso domain; o resto vira NormalizedSignatureEvent{kind:'unknown'}.
type ZapSignEventType =
  | 'doc_signed'
  | 'auto_reject'
  | 'doc_refused'
  | 'doc_deleted'
  | 'email_link_viewed'
  | string;

interface ZapSignWebhookPayload {
  event_type?: ZapSignEventType;
  status?: string;
  token?: string;
  open_id?: number | string;
  signed_at?: string | null;
  signed_file?: string | null;
  name?: string;
  // ZapSign pode mandar campos extras dependendo do tipo de evento — pegamos
  // tudo como Record pra log/audit.
  [key: string]: unknown;
}

const HEADER_WEBHOOK_TOKEN = 'x-elora-webhook-token';

export class ZapSignAdapter implements ISignatureProvider {
  readonly providerType = 'zapsign' as const;
  readonly isConfigured: boolean;
  private readonly config: ZapSignConfig;

  constructor(config: ZapSignConfig) {
    this.config = {
      ...config,
      // Normaliza trailing slash pra evitar `//docs/`.
      apiBaseUrl: config.apiBaseUrl.replace(/\/+$/, ''),
    };
    this.isConfigured = Boolean(config.apiToken);
  }

  // =====================================================================
  // Painel web do provider — derivado puramente do apiBaseUrl. Não depende
  // do token (URL é pública) — frontend pode linkar mesmo se ZapSign não
  // estiver provisionado ainda.
  // =====================================================================

  get isSandbox(): boolean {
    return this.config.apiBaseUrl.includes('sandbox.');
  }

  get panelUrl(): string {
    return this.isSandbox
      ? 'https://sandbox.app.zapsign.com.br/conta/modelos'
      : 'https://app.zapsign.com.br/conta/modelos';
  }

  // =====================================================================
  // Templates
  // =====================================================================

  async getTemplate(externalTemplateId: string): Promise<ProviderTemplateInfo> {
    this.assertConfigured();
    // /templates/{token}/ é o endpoint de CRUD canônico da ZapSign. NÃO use
    // /models/{token}/ — esse é resíduo legado do qual sobrou só o
    // /models/create-doc/ no nosso fluxo de envio.
    const model = await this.request<ZapSignModel>(
      'GET',
      `/templates/${encodeURIComponent(externalTemplateId)}/`,
    );
    return {
      name: typeof model.name === 'string' && model.name.trim() ? model.name.trim() : null,
      variables: extractVariablesFromZapsignModel(model),
    };
  }

  async listTemplates(): Promise<ProviderTemplateSummary[]> {
    this.assertConfigured();
    const collected: ProviderTemplateSummary[] = [];
    const seenTokens = new Set<string>();
    // ZapSign serve 20 templates/página (não configurável). Cap em 10 páginas
    // = 200 templates — folga suficiente pra clínica.
    const MAX_PAGES = 10;

    for (let page = 1; page <= MAX_PAGES; page++) {
      const response = await this.request<ZapSignModelsList>(
        'GET',
        `/templates/?page=${page}`,
      );
      const results = Array.isArray(response.results) ? response.results : [];
      for (const r of results) {
        const token = typeof r.token === 'string' ? r.token.trim() : '';
        if (!token || seenTokens.has(token)) continue;
        seenTokens.add(token);
        const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim() : '(sem nome)';
        collected.push({ externalTemplateId: token, name });
      }
      if (!response.next || results.length === 0) break;
    }

    // Ordenação alfabética estável — combobox renderiza na ordem recebida.
    collected.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    return collected;
  }

  // =====================================================================
  // Documentos
  // =====================================================================

  async createDocumentFromTemplate(input: CreateFromTemplateInput): Promise<DocumentRef> {
    this.assertConfigured();

    const phoneCountry = input.signer.phoneE164?.replace(/^\+?(\d{1,3}).*/, '$1') ?? '';
    const phoneNumber = input.signer.phoneE164?.replace(/^\+?\d{1,3}/, '') ?? '';

    const body: Record<string, unknown> = {
      template_id: input.externalTemplateId,
      signer_name: input.signer.name,
      signer_email: input.signer.email ?? '',
      signer_phone_country: phoneCountry,
      signer_phone_number: phoneNumber,
      // Mapeia [{name, value}] pro formato data: [{de, para}] da ZapSign.
      // ZapSign faz string-replace LITERAL — `{{x}}` não casa `{{ x }}` (espaços).
      // Pra cobrir DOCX criado no Word (que comumente tem `{{ var }}` com espaços
      // por causa de autocorrect/cópia), enviamos as duas variações: sem espaço
      // e com 1 espaço cada lado. A não-correspondente vira no-op silencioso.
      // Doc oficial: docs.zapsign.com.br/documentos/criar-documento-via-modelo.
      data: input.variables.flatMap((v) => [
        { de: `{{${v.name}}}`, para: v.value },
        { de: `{{ ${v.name} }}`, para: v.value },
      ]),
      lang: 'pt-br',
      // Desabilita notificações automáticas — caller manda link via WhatsApp.
      disable_signer_emails: input.disableSignerNotifications ?? true,
      send_automatic_email: false,
      send_automatic_whatsapp: false,
      ...(input.expiresAt != null
        ? {
            date_limit_to_sign: input.expiresAt.toISOString().slice(0, 10),
          }
        : {}),
    };

    if (input.documentName) {
      body.name = input.documentName;
    }

    const doc = await this.request<ZapSignDocument>(
      'POST',
      '/models/create-doc/',
      body,
    );

    const signer = doc.signers?.[0];
    const signUrl = signer?.sign_url ?? '';
    if (!signUrl) {
      throw new AppError(
        'ZapSign criou documento mas não retornou sign_url do signer.',
        502,
        { documentToken: doc.token },
      );
    }

    return {
      externalDocumentId: doc.token,
      externalOpenId: doc.open_id != null ? String(doc.open_id) : '',
      signUrl,
    };
  }

  async getDocument(externalDocumentId: string): Promise<DocumentStatus> {
    this.assertConfigured();
    const doc = await this.request<ZapSignDocument>(
      'GET',
      `/docs/${encodeURIComponent(externalDocumentId)}/`,
    );
    return normalizeStatus(doc);
  }

  async cancelDocument(externalDocumentId: string): Promise<void> {
    this.assertConfigured();
    await this.request<unknown>(
      'DELETE',
      `/docs/${encodeURIComponent(externalDocumentId)}/`,
    );
  }

  async downloadSignedPdf(externalDocumentId: string): Promise<Buffer> {
    this.assertConfigured();
    const doc = await this.request<ZapSignDocument>(
      'GET',
      `/docs/${encodeURIComponent(externalDocumentId)}/`,
    );
    if (!doc.signed_file) {
      throw new AppError(
        `Documento ${externalDocumentId} ainda não tem PDF assinado disponível.`,
        409,
      );
    }
    return downloadBuffer(doc.signed_file);
  }

  // =====================================================================
  // Webhook
  // =====================================================================

  verifyWebhook(req: WebhookRequest): boolean {
    // Sem token configurado → modo dev: aceita qualquer payload.
    // Em prod, ausência de token é um problema (registramos warning ao subir
    // o app — ver providerFactory). Aqui só não bloqueamos.
    if (!this.config.webhookToken) return true;

    const raw = req.headers[HEADER_WEBHOOK_TOKEN];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    return provided === this.config.webhookToken;
  }

  normalizeWebhook(rawPayload: unknown): NormalizedSignatureEvent {
    const payload = (rawPayload ?? {}) as ZapSignWebhookPayload;
    const externalDocumentId = payload.token ?? null;
    const eventType = payload.event_type ?? '';
    const metadata: Record<string, unknown> = { rawEvent: eventType, ...payload };

    if (!externalDocumentId) {
      return { kind: 'unknown', rawEvent: eventType, externalDocumentId: null };
    }

    switch (eventType) {
      case 'doc_signed':
        return {
          kind: 'document.signed',
          externalDocumentId,
          signedAt: parseDate(payload.signed_at) ?? new Date(),
          signedPdfUrl: typeof payload.signed_file === 'string' ? payload.signed_file : null,
          metadata,
        };
      case 'auto_reject':
      case 'doc_refused':
        return {
          kind: 'document.declined',
          externalDocumentId,
          declinedAt: new Date(),
          reason: typeof payload.status === 'string' ? payload.status : null,
          metadata,
        };
      case 'email_link_viewed':
        return {
          kind: 'document.viewed',
          externalDocumentId,
          viewedAt: new Date(),
          metadata,
        };
      default:
        return {
          kind: 'unknown',
          rawEvent: eventType,
          externalDocumentId,
        };
    }
  }

  // =====================================================================
  // HTTP helpers
  // =====================================================================

  private assertConfigured(): void {
    if (!this.isConfigured) {
      throw new AppError(
        'ZapSign não está provisionado (ZAPSIGN_API_TOKEN ausente).',
        503,
      );
    }
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.config.apiBaseUrl}${path}`;
    const start = Date.now();
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.apiToken}`,
          ...(body != null ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body != null ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new AppError(
        `ZapSign API ${method} ${path} falhou (network): ${(err as Error).message}`,
        502,
      );
    }

    const elapsedMs = Date.now() - start;
    logger.debug(
      { provider: 'zapsign', method, path, status: response.status, elapsedMs },
      'zapsign.request',
    );

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new AppError(
        `ZapSign API ${method} ${path} retornou ${response.status}: ${text.slice(0, 500)}`,
        response.status >= 500 ? 502 : response.status,
      );
    }

    // DELETE costuma retornar 204 No Content.
    if (response.status === 204) return undefined as T;

    const text = await response.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }
}

// =====================================================================
// Utilitários puros (testáveis isoladamente)
// =====================================================================

function normalizeStatus(doc: ZapSignDocument): DocumentStatus {
  const lastUpdate = parseDate(doc.last_update_at);
  const signedAt = parseDate(
    doc.signers?.find((s) => s.signed_at)?.signed_at ?? null,
  );
  const lastView = parseDate(
    doc.signers?.find((s) => s.last_view_at)?.last_view_at ?? null,
  );

  switch ((doc.status ?? '').toLowerCase()) {
    case 'signed':
      return {
        status: 'signed',
        signedAt: signedAt ?? lastUpdate,
        signedPdfUrl: doc.signed_file ?? null,
      };
    case 'refused':
    case 'auto-rejected':
    case 'auto_reject':
      return {
        status: 'declined',
        declinedAt: lastUpdate,
        reason: null,
      };
    case 'expired':
      return { status: 'expired' };
    case 'deleted':
    case 'cancelled':
      return { status: 'cancelled' };
    case 'pending':
    default:
      // Distingue 'sent' (pelo menos 1 signer viu) de 'pending' puro.
      if (lastView) return { status: 'viewed', viewedAt: lastView };
      return { status: 'sent', sentAt: parseDate(doc.created_at) };
  }
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new AppError(`Falha ao baixar PDF assinado: ${res.status}`, 502);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Consolida shapes legado/novo da resposta de GET /models/{id}/ em uma lista
// de chaves de variável únicas (preservando ordem de descoberta). Strip de
// `{{`/`}}` é defensivo — ZapSign expõe `{{key}}` no shape antigo (data) e
// `key` puro no shape novo (inputs[].variable).
function extractVariablesFromZapsignModel(model: ZapSignModel): string[] {
  const collected: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | undefined): void => {
    if (typeof raw !== 'string') return;
    const cleaned = raw
      .trim()
      .replace(/^\{\{/, '')
      .replace(/\}\}$/, '')
      .trim();
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    collected.push(cleaned);
  };

  if (Array.isArray(model.inputs)) {
    for (const it of model.inputs) push(it?.variable);
  }
  for (const key of ['data_to_send', 'data'] as const) {
    const arr = model[key];
    if (Array.isArray(arr)) {
      for (const it of arr) push((it as { de?: string } | undefined)?.de);
    }
  }
  return collected;
}
