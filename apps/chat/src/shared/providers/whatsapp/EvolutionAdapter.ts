import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../errors/AppError.js';
import { logger } from '../../observability/logger.js';
import { getBrMobileVariants } from '../../utils/brPhoneVariants.js';
import type {
  InboundMediaBuffer,
  IWhatsAppProvider,
} from './IWhatsAppProvider.js';
import type {
  EditMessageInput,
  MediaPayload,
  MessageRef,
  MessageStatus,
  NormalizedInboundEvent,
  OutboundMedia,
  OutboundTemplate,
  OutboundText,
  RevokeMessageInput,
  WebhookRequest,
} from './types.js';

// =====================================================================
// Adapter que conversa com Evolution API v2. Suporta os dois tracks
// (`baileys` e `meta_cloud`) ramificando internamente conforme
// `config.integration`. Ver arquitetura.md §7.
//
// Por que um adapter pros dois tracks: Evolution v2 expõe a mesma API
// REST e mesmo formato de webhook pros dois — só muda `integration` no
// momento de criar a instância. Ramificar internamente custa menos
// código que duas classes com 95% de comportamento idêntico.
//
// Provisionamento da instância (criar no Evolution, configurar webhook)
// é responsabilidade do módulo whatsappChannels — esse adapter SÓ usa
// instância pronta cuja config vem em `provider_config`.
// =====================================================================

// Shape esperado em `whatsapp_channels.provider_config` pra canais reais.
// Provisionamento (admin) é quem preenche; adapter só consome.
const evolutionConfigSchema = z.object({
  baseUrl: z.string().url(),
  instanceName: z.string().min(1),
  // Token de instância — Evolution pode usar a master key global OU um token
  // específico criado no `POST /instance/create`. Damos preferência ao
  // específico (princípio do menor privilégio).
  apiKey: z.string().min(1),
  // Modo da instância. Default 'baileys' pra compat com canais pré-Evolution.
  integration: z.enum(['baileys', 'meta_cloud']).default('baileys'),
  // Bearer token configurado no `webhook.headers.Authorization` ao provisionar.
  // Validamos com `Authorization: Bearer <webhookToken>` chegando do Evolution.
  webhookToken: z.string().min(8),
});

export type EvolutionConfig = z.infer<typeof evolutionConfigSchema>;

// =====================================================================
// Payload do webhook Evolution — apenas os campos que usamos. Campos
// adicionais são preservados em `raw` pra debug.
// =====================================================================

const evolutionWebhookSchema = z.object({
  event: z.string(),
  instance: z.string().optional(),
  data: z.unknown(),
});

// Apenas pra extrair texto / mídia — payload Evolution tem várias formas.
// Cobertura V1: text (conversation, extendedTextMessage), image, audio.
//
// `contextInfo` aparece em qualquer kind quando a msg é um reply: traz
// `stanzaId` (externalId da msg citada) e `participant` (jid do autor). Não
// vem em `conversation` direto (text simples usa `extendedTextMessage` quando
// tem context). Pipeline usa pra preencher `replyToMessageId`.
interface EvolutionContextInfo {
  stanzaId?: string;
  participant?: string;
}

interface EvolutionMessageData {
  key: { remoteJid: string; fromMe: boolean; id: string };
  pushName?: string;
  messageTimestamp?: number | string;
  message?: {
    conversation?: string;
    extendedTextMessage?: { text?: string; contextInfo?: EvolutionContextInfo };
    imageMessage?: { url?: string; caption?: string; mimetype?: string; contextInfo?: EvolutionContextInfo };
    audioMessage?: { url?: string; mimetype?: string; contextInfo?: EvolutionContextInfo };
    videoMessage?: { url?: string; caption?: string; mimetype?: string; contextInfo?: EvolutionContextInfo };
    documentMessage?: { url?: string; fileName?: string; mimetype?: string; contextInfo?: EvolutionContextInfo };
    stickerMessage?: { url?: string; mimetype?: string; contextInfo?: EvolutionContextInfo };
  };
  status?: string;
}

export class EvolutionAdapter implements IWhatsAppProvider {
  readonly channelId: string;
  readonly providerType: string;
  private readonly config: EvolutionConfig;

  constructor(channelId: string, rawConfig: unknown) {
    this.channelId = channelId;
    const parsed = evolutionConfigSchema.safeParse(rawConfig);
    if (!parsed.success) {
      throw new AppError(
        `Configuração Evolution inválida pro canal ${channelId}: ${parsed.error.issues[0]?.message ?? 'desconhecido'}`,
        500,
      );
    }
    this.config = parsed.data;
    this.providerType = this.config.integration;
  }

  // Cloud API tem janela 24h enforçada pelo Meta no protocolo; Baileys não
  // tem esse conceito. Quando false, MessagesService permite texto livre
  // a qualquer momento (defesa contra ban Baileys vem do OutboundGuard:
  // rate limit + dedupe no shared/outboundGuard).
  requiresWindowGate(): boolean {
    return this.config.integration === 'meta_cloud';
  }

  // =====================================================================
  // Outbound
  // =====================================================================

  async sendText(input: OutboundText): Promise<MessageRef> {
    const data = await this.post<EvolutionSendResponse>(
      `/message/sendText/${this.config.instanceName}`,
      {
        number: toEvolutionNumber(input.to),
        text: input.text,
        quoted: input.quoted ? buildQuotedPayload(input.quoted) : undefined,
      },
    );
    return this.refFromResponse(data);
  }

  async sendMedia(input: OutboundMedia): Promise<MessageRef> {
    // Evolution v2 aceita `media: <url|base64>` + `mediatype` (string). Pra
    // tipos não suportados (raros, edge case), surfaceia erro do server.
    const data = await this.post<EvolutionSendResponse>(
      `/message/sendMedia/${this.config.instanceName}`,
      {
        number: toEvolutionNumber(input.to),
        mediatype: input.media.type,
        media: input.media.url,
        caption: input.media.caption,
        fileName: input.media.filename,
        mimetype: input.media.mimeType,
        quoted: input.quoted ? buildQuotedPayload(input.quoted) : undefined,
      },
    );
    return this.refFromResponse(data);
  }

  async sendTemplate(input: OutboundTemplate): Promise<MessageRef> {
    if (this.config.integration === 'baileys') {
      // Track não-oficial: templates não existem no protocolo do WhatsApp Web.
      // Caller (MessagesService) já renderizou o body do template; enviamos
      // como texto simples. Sem isso, mensagem ativa fora da janela 24h não
      // teria como sair.
      if (!input.renderedBody) {
        throw new AppError(
          'sendTemplate em canal Baileys exige `renderedBody` resolvido pelo caller',
          500,
        );
      }
      return this.sendText({ to: input.to, text: input.renderedBody });
    }

    // meta_cloud: Evolution v2 expõe templates via `/message/sendTemplate/`
    // (endpoint próprio que chama Cloud API). Implementação completa entra
    // quando primeiro tenant Cloud aparecer — exige template aprovado pela
    // Meta + ID + mapping de variáveis pros placeholders do template.
    throw new AppError(
      'sendTemplate em canal meta_cloud ainda não implementado',
      501,
    );
  }

  async editMessage(input: EditMessageInput): Promise<void> {
    // Evolution v2: POST /chat/updateMessage/{instance} com `key` completo
    // (remoteJid, fromMe=true, id) + `text` novo. WhatsApp aceita edição
    // até 15min após o envio — fora dessa janela o servidor responde 400.
    await this.post(`/chat/updateMessage/${this.config.instanceName}`, {
      number: toEvolutionNumber(input.toE164),
      key: {
        remoteJid: toEvolutionJid(input.toE164),
        fromMe: true,
        id: input.externalId,
      },
      text: input.text,
    });
  }

  async revokeMessage(input: RevokeMessageInput): Promise<void> {
    // Evolution v2: DELETE /chat/deleteMessageForEveryone/{instance}. Body
    // passado como query string em alguns provedores; a v2 da Evolution
    // aceita body JSON também — implementação aqui usa body via fetch DELETE.
    await this.del(
      `/chat/deleteMessageForEveryone/${this.config.instanceName}`,
      {
        id: input.externalId,
        remoteJid: toEvolutionJid(input.toE164),
        fromMe: true,
      },
    );
  }

  async getStatus(externalId: string): Promise<MessageStatus> {
    // Evolution não expõe um GET status individual fácil — o canal correto é
    // o webhook (MESSAGES_UPDATE) que mantém `whatsapp_messages.status`
    // atualizado em tempo real. Esse método é fallback raro pra reconciliar
    // mensagens "perdidas"; retornar 'sent' como neutro é seguro (não força
    // falsamente 'delivered' nem 'failed').
    logger.debug(
      { channelId: this.channelId, externalId },
      '[EvolutionAdapter] getStatus chamado — Evolution não tem endpoint direto, retornando sent',
    );
    return 'sent';
  }

  // Descriptografa mídia inbound via endpoint dedicado da Evolution.
  // Sem isso, o que está em `audioMessage.url` etc é o `.enc` bruto do
  // WhatsApp — bytes cifrados que nenhum player consegue tocar.
  //
  // Suficiente passar `key.id` no body — Evolution faz lookup interno e
  // recupera mediaKey + cipher do DB próprio (DATABASE_SAVE_DATA_NEW_MESSAGE
  // tem que estar `true`, o que já é o caso no nosso compose).
  async fetchInboundMediaBuffer(
    rawPayload: unknown,
  ): Promise<InboundMediaBuffer | null> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (rawPayload as any)?.data;
    const keyId = data?.key?.id;
    if (typeof keyId !== 'string' || keyId.length === 0) {
      return null;
    }
    try {
      const resp = await this.post<{
        base64?: string;
        mimetype?: string;
        fileName?: string;
      }>(`/chat/getBase64FromMediaMessage/${this.config.instanceName}`, {
        message: { key: { id: keyId } },
        convertToMp4: false,
      });
      if (!resp.base64) return null;
      return {
        buffer: Buffer.from(resp.base64, 'base64'),
        // Evolution às vezes devolve `audio/mp4` mesmo pra OGG do WhatsApp —
        // browser players modernos tocam audio/mp4 + audio/ogg + audio/webm
        // sem problema. Se vier vazio, fallback genérico (raro).
        mimeType: resp.mimetype ?? 'application/octet-stream',
        filename: resp.fileName,
      };
    } catch (err) {
      // Evolution às vezes retorna 400 (AggregateError) quando o socket
      // Baileys está rate-limited. Caller já loga; aqui retornamos null
      // pra permitir fallback ou degradação graciosa.
      logger.warn(
        {
          channelId: this.channelId,
          keyId,
          err: err instanceof Error ? err.message : err,
        },
        '[EvolutionAdapter] fetchInboundMediaBuffer falhou',
      );
      return null;
    }
  }

  // Evolution v2: POST /chat/whatsappNumbers/{instance} com body
  // { numbers: ['5511...', '551199...'] }. Resposta é array de
  // [{ exists: boolean, jid: string, number: string }].
  //
  // Em canais Baileys o lookup é instantâneo (cache local do socket); em
  // meta_cloud a Evolution faz round-trip com a Cloud API e pode demorar
  // ~1s. Caller aplica debounce no frontend pra evitar flicker.
  async checkNumberExists(toE164: string): Promise<boolean> {
    const resolved = await this.resolveNumber(toE164);
    return resolved.exists;
  }

  // Probe as variantes BR (com/sem 9) numa única chamada. A Evolution aceita
  // array em `numbers` e responde 1 item por número consultado, o que torna
  // o probe atômico (mesma janela de cache no canal Baileys, mesma rate
  // budget no canal Cloud). Devolve o E.164 que respondeu positivo —
  // `matchedE164` pode diferir do input quando a quirk BR está ativa.
  async resolveNumber(
    toE164: string,
  ): Promise<{ exists: boolean; matchedE164: string | null }> {
    const variants = getBrMobileVariants(toE164);
    const numbers = variants.map((v) => toEvolutionNumber(v));
    const data = await this.post<
      Array<{ exists?: boolean; number?: string; jid?: string }>
    >(
      `/chat/whatsappNumbers/${this.config.instanceName}`,
      { numbers },
    );
    if (!Array.isArray(data)) {
      return { exists: false, matchedE164: null };
    }
    // Evolution preserva a ordem de `numbers` na resposta, mas defendemos
    // por mapeamento via `number` — alguns builds reordenam quando há
    // mismatch de cache. Vamos pela ordem das variantes (input primeiro) e
    // confirmamos o `exists`.
    for (let i = 0; i < variants.length; i++) {
      const probed = toEvolutionNumber(variants[i]!);
      const hit = data.find(
        (item) => item.number === probed && item.exists === true,
      );
      if (hit) {
        return { exists: true, matchedE164: variants[i]! };
      }
    }
    return { exists: false, matchedE164: null };
  }

  async getProfilePicture(toE164: string): Promise<string | null> {
    // Evolution v2: POST /chat/fetchProfilePictureUrl/{instance}.
    // Devolve { profilePictureUrl } ou erro 404 quando contato não tem foto
    // / privacidade está restrita. Tratamos qualquer falha como "sem foto"
    // pra que o caller não precise lidar com try/catch — best-effort por design.
    try {
      const data = await this.post<{ profilePictureUrl?: string | null }>(
        `/chat/fetchProfilePictureUrl/${this.config.instanceName}`,
        { number: toEvolutionNumber(toE164) },
      );
      return data.profilePictureUrl ?? null;
    } catch (err) {
      logger.debug(
        { channelId: this.channelId, toE164, err: err instanceof Error ? err.message : err },
        '[EvolutionAdapter] getProfilePicture sem foto ou erro — null',
      );
      return null;
    }
  }

  // =====================================================================
  // Inbound
  // =====================================================================

  verifyWebhook(req: WebhookRequest): boolean {
    // Evolution configura webhook com headers customizados — colocamos
    // `Authorization: Bearer <webhookToken>` ao provisionar. Validamos aqui.
    const auth = req.headers['authorization'] ?? req.headers['Authorization'];
    const header = Array.isArray(auth) ? auth[0] : auth;
    if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
    const presented = header.slice('Bearer '.length).trim();
    // Comparação direta — token é gerado no Elora, não há risco de timing
    // attack relevante em ambiente single-tenant Evolution. Se virar dor,
    // troca por crypto.timingSafeEqual.
    return presented === this.config.webhookToken;
  }

  normalizeWebhook(rawPayload: unknown): NormalizedInboundEvent {
    const envelope = evolutionWebhookSchema.safeParse(rawPayload);
    if (!envelope.success) {
      return {
        kind: 'ignored',
        reason: `Envelope Evolution inválido: ${envelope.error.issues[0]?.message ?? 'desconhecido'}`,
        raw: (rawPayload ?? {}) as Record<string, unknown>,
      };
    }
    const { event, data } = envelope.data;
    const raw = rawPayload as Record<string, unknown>;

    switch (normalizeEventName(event)) {
      case 'messages.upsert':
      case 'send.message':
        return this.parseMessageEvent(data, raw, event);
      case 'messages.update':
        // `messages.update` é overloaded no Evolution: vem tanto pra status
        // (delivered/read) quanto pra edição de mensagem (cliente editou
        // msg). Distinção por payload: edit tem `data.message.editedMessage`
        // ou `protocolMessage.editedMessage`; status tem `data.status`.
        // Edit ganha precedência — se ambos vierem por bug do provider,
        // edit é a informação mais importante.
        return this.parseUpdateEvent(data, raw);
      case 'messages.delete':
      case 'message.revoke':
        return this.parseDeleteEvent(data, raw);
      case 'call':
      case 'call.upsert':
      case 'calls.update':
        return this.parseCallEvent(data, raw);
      case 'connection.update':
        return this.parseConnectionUpdate(data, raw);
      default:
        // PRESENCE, CHATS_*, CONTACTS_*, etc — eventos sem valor pro
        // pipeline. Drop limpo. (CONNECTION_UPDATE virou case tratado
        // acima — alimenta whatsapp_channels.connection_state).
        return {
          kind: 'ignored',
          reason: `Evento Evolution não tratado: ${event}`,
          raw,
        };
    }
  }

  // Mapeia o `state` cru do Evolution pro nome normalizado do union. Evolution
  // varia entre 'open' / 'connecting' / 'close' / 'closed' a depender da
  // versão — normalizamos pra 4 valores fixos. Desconhecidos viram 'unknown'.
  private parseConnectionUpdate(
    data: unknown,
    raw: Record<string, unknown>,
  ): NormalizedInboundEvent {
    const stateRaw =
      (data as { state?: unknown } | null | undefined)?.state ?? '';
    const stateStr = typeof stateRaw === 'string' ? stateRaw.toLowerCase() : '';
    let state: 'open' | 'connecting' | 'closed' | 'unknown' = 'unknown';
    if (stateStr === 'open') state = 'open';
    else if (stateStr === 'connecting') state = 'connecting';
    else if (stateStr === 'close' || stateStr === 'closed') state = 'closed';
    return {
      kind: 'connection_state',
      state,
      receivedAt: new Date(),
      raw,
    };
  }

  // =====================================================================
  // Internos
  // =====================================================================

  private parseMessageEvent(
    data: unknown,
    raw: Record<string, unknown>,
    _eventName: string,
  ): NormalizedInboundEvent {
    const d = data as EvolutionMessageData | null;
    if (!d || !d.key || typeof d.key.remoteJid !== 'string') {
      return { kind: 'ignored', reason: 'data.key.remoteJid ausente', raw };
    }

    // `fromMe=true` cobre dois cenários distintos:
    //   1. Eco do `sendText`/`sendMedia` que disparamos pela API. O externalId
    //      já vai estar gravado no DB — pipeline dedupa.
    //   2. Staff respondeu direto pelo celular pareado (`MESSAGES_UPSERT`
    //      com externalId NOVO). Persistir como outbound + marcar
    //      `authored_on_device=true` no domain.
    //
    // Ramificação fica no pipeline (que enxerga o DB); aqui só sinalizamos a
    // direção. `remoteJid` é o "outro lado" da conversa em ambos os casos —
    // mesmo número de contato.
    const direction: 'inbound' | 'outbound' = d.key.fromMe ? 'outbound' : 'inbound';

    // Filtra mensagens de grupo — `remoteJid` termina em `@g.us` pra grupos.
    // V1 não suporta WhatsApp em grupo (caso de uso não-existente em clínica).
    if (d.key.remoteJid.endsWith('@g.us')) {
      return { kind: 'ignored', reason: 'Mensagem de grupo (não suportado V1)', raw };
    }

    const fromE164 = jidToE164(d.key.remoteJid);
    if (!fromE164) {
      return {
        kind: 'ignored',
        reason: `remoteJid não E.164: ${d.key.remoteJid}`,
        raw,
      };
    }

    const message = d.message ?? {};
    const text =
      message.conversation ?? message.extendedTextMessage?.text ?? undefined;

    // Mídia: prioridade image > audio > video > document > sticker. Evolution
    // baixa o arquivo e expõe URL via SERVER_URL (configurada no compose).
    // Sticker é categoria própria — pipeline distingue via kind='sticker' no
    // domain (UI renderiza diferente: bolha transparente, sem botão de download).
    let media: MediaPayload | undefined
    if (message.imageMessage?.url) {
      media = {
        type: 'image',
        url: message.imageMessage.url,
        caption: message.imageMessage.caption,
        mimeType: message.imageMessage.mimetype,
      };
    } else if (message.audioMessage?.url) {
      media = {
        type: 'audio',
        url: message.audioMessage.url,
        mimeType: message.audioMessage.mimetype,
      };
    } else if (message.videoMessage?.url) {
      media = {
        type: 'video',
        url: message.videoMessage.url,
        caption: message.videoMessage.caption,
        mimeType: message.videoMessage.mimetype,
      };
    } else if (message.documentMessage?.url) {
      media = {
        type: 'document',
        url: message.documentMessage.url,
        filename: message.documentMessage.fileName,
        mimeType: message.documentMessage.mimetype,
      };
    } else if (message.stickerMessage?.url) {
      media = {
        type: 'sticker',
        url: message.stickerMessage.url,
        mimeType: message.stickerMessage.mimetype ?? 'image/webp',
      };
    }

    // Sem texto e sem mídia, mensagem não tem conteúdo útil — drop.
    if (!text && !media) {
      return {
        kind: 'ignored',
        reason: 'Mensagem sem texto ou mídia suportada',
        raw,
      };
    }

    const replyToExternalId = extractReplyExternalId(message);

    return {
      kind: 'message_received',
      direction,
      externalId: d.key.id || randomUUID(),
      fromE164,
      // pushName em `fromMe=true` é o NOSSO perfil (do número conectado),
      // não da pessoa do outro lado. Não pode contaminar o profile_name do
      // contato — só usamos quando inbound.
      profileName: direction === 'inbound' ? d.pushName : undefined,
      text,
      media,
      replyToExternalId,
      receivedAt: parseTimestamp(d.messageTimestamp),
      raw,
    };
  }

  // `messages.update` é overloaded. Demultiplexa: prioridade pra edit (texto
  // novo), fallback pra status (delivered/read). Se nenhum dos dois bater,
  // ignora — Evolution às vezes emite update vazio em transições internas.
  private parseUpdateEvent(
    data: unknown,
    raw: Record<string, unknown>,
  ): NormalizedInboundEvent {
    const d = data as EvolutionMessageData | null;
    if (!d || !d.key?.id) {
      return { kind: 'ignored', reason: 'update sem key.id', raw };
    }
    const editedText = extractEditedText(d);
    if (editedText !== null) {
      const fromE164 = jidToE164(d.key.remoteJid ?? '');
      if (!fromE164) {
        return {
          kind: 'ignored',
          reason: `edit com remoteJid inválido: ${d.key.remoteJid}`,
          raw,
        };
      }
      // Edição feita pelo CLIENTE. Quando staff edita uma msg outbound
      // pela UI, chamamos editMessage diretamente — não passa por webhook.
      // Evolution pode emitir eco com fromMe=true ao editarmos via API;
      // filtramos pra não duplicar UPDATE no banco.
      if (d.key.fromMe) {
        return { kind: 'ignored', reason: 'eco do nosso editMessage', raw };
      }
      return {
        kind: 'message_edited',
        externalId: d.key.id,
        fromE164,
        text: editedText,
        editedAt: new Date(),
        raw,
      };
    }
    const status = mapEvolutionStatus(d.status);
    if (!status) {
      return {
        kind: 'ignored',
        reason: `update sem edit nem status mapeável (${d.status ?? '<vazio>'})`,
        raw,
      };
    }
    return {
      kind: 'status_updated',
      externalId: d.key.id,
      status,
      updatedAt: new Date(),
      raw,
    };
  }

  // Evento `call` da Evolution. Estrutura típica:
  //   data: { from, id, status: 'offer'|'accept'|'reject'|'terminate'|'timeout',
  //           date_start?: ISO|number, isVideo?: boolean }
  // ou pode vir como array `data: [{ ... }]`. Normalizamos pra:
  //   - 'offer' + 'timeout' → 'missed'
  //   - 'reject' → 'declined'
  //   - 'accept'/'terminate' com duração → 'received'
  // V1 ignora chamadas de grupo (`from` termina em `@g.us`) e chamadas
  // outbound (raro, exigiria botão dedicado na UI).
  private parseCallEvent(
    data: unknown,
    raw: Record<string, unknown>,
  ): NormalizedInboundEvent {
    const entry = Array.isArray(data) ? (data[0] as unknown) : data;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = entry as any;
    if (!d || typeof d.from !== 'string') {
      return { kind: 'ignored', reason: 'call sem `from`', raw };
    }
    if (d.from.endsWith('@g.us')) {
      return { kind: 'ignored', reason: 'Chamada de grupo (não suportado V1)', raw };
    }
    const fromE164 = jidToE164(d.from);
    if (!fromE164) {
      return { kind: 'ignored', reason: `call com from inválido: ${d.from}`, raw };
    }

    const statusRaw = String(d.status ?? '').toLowerCase();
    let status: 'missed' | 'received' | 'declined';
    if (statusRaw === 'reject') {
      status = 'declined';
    } else if (statusRaw === 'accept' || statusRaw === 'terminate') {
      status = 'received';
    } else {
      // 'offer' sem follow-up vira 'missed'; 'timeout' idem.
      status = 'missed';
    }

    return {
      kind: 'call_received',
      externalId: typeof d.id === 'string' ? d.id : randomUUID(),
      fromE164,
      status,
      durationSec: typeof d.duration === 'number' ? d.duration : undefined,
      startedAt: parseTimestamp(d.date_start ?? d.date),
      receivedAt: new Date(),
      raw,
    };
  }

  // `messages.delete` — cliente apagou mensagem pra todos. Pode também
  // chegar via `messages.update` com protocolMessage.type='REVOKE' em
  // algumas versões; fallback fica em parseUpdateEvent se necessário.
  // Filtra fromMe=true (eco do nosso revokeMessage) pra não duplicar
  // soft delete.
  private parseDeleteEvent(
    data: unknown,
    raw: Record<string, unknown>,
  ): NormalizedInboundEvent {
    const d = data as EvolutionMessageData | null;
    if (!d || !d.key?.id) {
      return { kind: 'ignored', reason: 'delete sem key.id', raw };
    }
    if (d.key.fromMe) {
      return { kind: 'ignored', reason: 'eco do nosso revokeMessage', raw };
    }
    const fromE164 = jidToE164(d.key.remoteJid ?? '');
    if (!fromE164) {
      return {
        kind: 'ignored',
        reason: `delete com remoteJid inválido: ${d.key.remoteJid}`,
        raw,
      };
    }
    return {
      kind: 'message_deleted',
      externalId: d.key.id,
      fromE164,
      deletedAt: new Date(),
      raw,
    };
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private async del<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('DELETE', path, body);
  }

  private async request<T>(
    method: 'POST' | 'DELETE',
    path: string,
    body: unknown,
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.config.apiKey,
      },
      body: JSON.stringify(body),
      // 15s default: WhatsApp pode demorar em conexão instável; mais que isso
      // sinaliza Evolution travado e é melhor falhar fast pro caller decidir.
      signal: AbortSignal.timeout(15_000),
    }).catch((err) => {
      throw new AppError(
        `Falha ao falar com Evolution (${path}): ${err instanceof Error ? err.message : err}`,
        502,
      );
    });

    const text = await res.text();
    if (!res.ok) {
      logger.warn(
        { channelId: this.channelId, path, status: res.status, body: text.slice(0, 500) },
        '[EvolutionAdapter] resposta de erro',
      );
      // Caso especial: Evolution responde 400 com TypeError "reading
      // 'sendMessage'" quando o registro da instância existe mas o socket
      // Baileys interno não foi inicializado (típico após restart do
      // container Evolution sem persistência de sessão, ou logout multi-
      // device no celular pareado). O pre-check de connectionState deveria
      // pegar antes, mas se cair aqui significa que o cache disse 'open' e
      // a Evolution disse o contrário — devolve 409 com instrução de
      // recuperação em vez do 400 genérico que confundia operadores.
      if (res.status === 400 && /sendMessage/.test(text)) {
        throw new AppError(
          'Canal WhatsApp com socket quebrado. Reconecte pela página de canais (pode ser preciso reescanear QR).',
          409,
        );
      }
      throw new AppError(
        `Evolution respondeu ${res.status} em ${path}`,
        res.status >= 400 && res.status < 500 ? res.status : 502,
      );
    }

    // Endpoints como deleteMessageForEveryone podem responder body vazio.
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

  private refFromResponse(data: EvolutionSendResponse): MessageRef {
    return {
      externalId: data.key?.id ?? randomUUID(),
      // Evolution retorna status='PENDING' na resposta síncrona. Pra nosso
      // pipeline, tratamos como 'sent' (mensagem saiu daqui com sucesso);
      // 'delivered'/'read' vêm depois via webhook MESSAGES_UPDATE.
      status: 'sent',
      sentAt: data.messageTimestamp
        ? parseTimestamp(data.messageTimestamp)
        : new Date(),
    };
  }
}

// =====================================================================
// Helpers livres
// =====================================================================

interface EvolutionSendResponse {
  key?: { id?: string; remoteJid?: string; fromMe?: boolean };
  status?: string;
  messageTimestamp?: number | string;
}

// Normaliza dot.case (`messages.upsert`) e UPPER_SNAKE (`MESSAGES_UPSERT`) pra
// dot.case minúsculo, único formato que reconhecemos no switch.
function normalizeEventName(event: string): string {
  return event.toLowerCase().replaceAll('_', '.');
}

// Evolution aceita número em formatos variados — vamos padronizar pra string
// só com dígitos (DDI + DDD + número). Caller passa E.164 ('+5511...');
// removemos '+' e qualquer caractere não-numérico.
function toEvolutionNumber(e164: string): string {
  return e164.replace(/\D/g, '');
}

// JID completo (`<digits>@s.whatsapp.net`) é necessário no `key.remoteJid` dos
// endpoints de edit/revoke. Aceita E.164 ('+5511988887777') ou só dígitos.
function toEvolutionJid(e164: string): string {
  return `${toEvolutionNumber(e164)}@s.whatsapp.net`;
}

// Extrai o NOVO texto de um evento de edição. WhatsApp/Evolution agrupa o
// payload de edit em vários níveis dependendo da versão — tentamos as formas
// conhecidas. Retorna null se não for evento de edit (ou se for edit de
// mídia sem caption — V1 ignora).
function extractEditedText(data: EvolutionMessageData): string | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = data.message as any;
  if (!m) return null;
  const candidates: unknown[] = [
    m.editedMessage?.message?.conversation,
    m.editedMessage?.message?.extendedTextMessage?.text,
    m.editedMessage?.conversation,
    m.editedMessage?.extendedTextMessage?.text,
    m.protocolMessage?.editedMessage?.conversation,
    m.protocolMessage?.editedMessage?.extendedTextMessage?.text,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return null;
}

// Monta o objeto `quoted` esperado pelo Evolution v2 a partir do nosso
// QuotedRef. Mínimo aceito é `key.id`; incluímos `fromMe`+`remoteJid` porque
// builds Baileys-baseados validam a estrutura key completa, e `message`
// minimal pra clients antigos que renderizam pelo body (a maioria moderna
// resolve pelo id contra o histórico). Quando body é null/undefined, ainda
// mandamos o campo vazio — alguns builds rejeitam quoted sem `message`.
function buildQuotedPayload(quoted: NonNullable<OutboundText['quoted']>): Record<string, unknown> {
  return {
    key: {
      id: quoted.externalId,
      fromMe: quoted.fromMe,
      remoteJid: toEvolutionJid(quoted.participantE164),
    },
    message: { conversation: quoted.body ?? '' },
  };
}

// Extrai `contextInfo.stanzaId` de qualquer kind de mensagem. Reply em
// WhatsApp pode anexar contextInfo em text/image/video/audio/document/sticker;
// olhamos só o primeiro `stanzaId` não-vazio.
function extractReplyExternalId(
  m: NonNullable<EvolutionMessageData['message']>,
): string | undefined {
  const candidates: EvolutionContextInfo | undefined =
    m.extendedTextMessage?.contextInfo ??
    m.imageMessage?.contextInfo ??
    m.videoMessage?.contextInfo ??
    m.audioMessage?.contextInfo ??
    m.documentMessage?.contextInfo ??
    m.stickerMessage?.contextInfo;
  return candidates?.stanzaId || undefined;
}

// '5511988887777@s.whatsapp.net' → '+5511988887777'. Validação simples: só
// retornamos quando tem 10-15 dígitos.
function jidToE164(jid: string): string | null {
  const digits = jid.split('@')[0]?.replace(/\D/g, '');
  if (!digits || digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

// Evolution emite `messageTimestamp` como Unix seconds (string ou number).
function parseTimestamp(ts: number | string | undefined): Date {
  if (ts === undefined) return new Date();
  const n = typeof ts === 'string' ? Number.parseInt(ts, 10) : ts;
  if (!Number.isFinite(n)) return new Date();
  // > 10^12 = milissegundos (raro), senão segundos.
  return new Date(n > 1e12 ? n : n * 1000);
}

// Evolution emite status em UPPER ou camelCase dependendo do evento.
// Mapeamos pra nossas constantes domain.
function mapEvolutionStatus(raw: string | undefined): MessageStatus | null {
  if (!raw) return null;
  const s = raw.toUpperCase();
  switch (s) {
    case 'PENDING':
      return 'queued';
    case 'SERVER_ACK':
    case 'SENT':
      return 'sent';
    case 'DELIVERY_ACK':
    case 'DELIVERED':
      return 'delivered';
    case 'READ':
    case 'PLAYED':
      return 'read';
    case 'ERROR':
    case 'FAILED':
      return 'failed';
    default:
      return null;
  }
}
