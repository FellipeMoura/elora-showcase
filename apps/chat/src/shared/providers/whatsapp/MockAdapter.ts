import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { logger } from '../../observability/logger.js';
import type {
  InboundMediaBuffer,
  IWhatsAppProvider,
} from './IWhatsAppProvider.js';
import type {
  EditMessageInput,
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
// Adapter mock — vive em dev/teste. Loga envios, mantém status em memória,
// e expõe shape simples pra simular inbound (`POST /webhook/...` em modo
// mock recebe esse formato direto, sem precisar de provider real).
//
// IMPORTANTE: estado é por instância. Cada canal Mock tem seu próprio
// histórico em RAM. Reiniciar o app limpa tudo — comportamento esperado
// pra um mock.
// =====================================================================

// Shape canônico esperado por normalizeWebhook do Mock. Evolution tem shape
// próprio (ver EvolutionAdapter). Aqui o Mock define o contrato MAIS
// SIMPLES POSSÍVEL pra desbloquear o pipeline em dev/CI:
const mockInboundSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('message_received'),
    // 'inbound' = cliente mandou (default). 'outbound' simula staff
    // respondendo direto pelo celular pareado — útil pra testar o caminho
    // `authoredOnDevice=true` em dev/CI sem precisar de WhatsApp real.
    direction: z.enum(['inbound', 'outbound']).default('inbound'),
    externalId: z.string().min(1).optional(),
    from: z.string().min(8),
    profileName: z.string().optional(),
    text: z.string().optional(),
    media: z
      .object({
        type: z.enum(['image', 'audio', 'video', 'document']),
        url: z.string().url(),
        caption: z.string().optional(),
        filename: z.string().optional(),
        mimeType: z.string().optional(),
      })
      .optional(),
  }),
  z.object({
    kind: z.literal('status_updated'),
    externalId: z.string().min(1),
    status: z.enum(['queued', 'sent', 'delivered', 'read', 'failed']),
    error: z.string().optional(),
  }),
  z.object({
    kind: z.literal('message_edited'),
    externalId: z.string().min(1),
    from: z.string().min(8),
    text: z.string().min(1),
  }),
  z.object({
    kind: z.literal('message_deleted'),
    externalId: z.string().min(1),
    from: z.string().min(8),
  }),
  z.object({
    kind: z.literal('call_received'),
    externalId: z.string().min(1).optional(),
    from: z.string().min(8),
    status: z.enum(['missed', 'received', 'declined']).default('missed'),
    durationSec: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('ignored'),
    reason: z.string().min(1),
  }),
]);

interface SentRecord {
  externalId: string;
  to: string;
  payload: Record<string, unknown>;
  status: MessageStatus;
  sentAt: Date;
}

export class MockAdapter implements IWhatsAppProvider {
  readonly channelId: string;
  readonly providerType = 'mock';

  // Histórico por canal — útil pra debug e pra `getStatus` saber o que
  // foi enviado. Map<externalId, SentRecord>.
  private readonly sent = new Map<string, SentRecord>();

  constructor(channelId: string) {
    this.channelId = channelId;
  }

  // Mock segue o track Baileys: sem janela 24h enforçada. Em dev/CI a
  // ergonomia de "mande qualquer coisa em qualquer hora" é o que se quer.
  requiresWindowGate(): boolean {
    return false;
  }

  async sendText(input: OutboundText): Promise<MessageRef> {
    const externalId = randomUUID();
    const sentAt = new Date();
    this.sent.set(externalId, {
      externalId,
      to: input.to,
      payload: { kind: 'text', text: input.text },
      status: 'sent',
      sentAt,
    });
    logger.info(
      { channelId: this.channelId, to: input.to, externalId, kind: 'text' },
      `[MockAdapter] sendText → ${input.to}: "${input.text.slice(0, 60)}"`
    );
    return { externalId, status: 'sent', sentAt };
  }

  async sendMedia(input: OutboundMedia): Promise<MessageRef> {
    const externalId = randomUUID();
    const sentAt = new Date();
    this.sent.set(externalId, {
      externalId,
      to: input.to,
      payload: { kind: 'media', media: input.media },
      status: 'sent',
      sentAt,
    });
    logger.info(
      {
        channelId: this.channelId,
        to: input.to,
        externalId,
        mediaType: input.media.type,
      },
      `[MockAdapter] sendMedia → ${input.to} (${input.media.type})`
    );
    return { externalId, status: 'sent', sentAt };
  }

  async sendTemplate(input: OutboundTemplate): Promise<MessageRef> {
    const externalId = randomUUID();
    const sentAt = new Date();
    this.sent.set(externalId, {
      externalId,
      to: input.to,
      payload: { kind: 'template', templateId: input.templateId, vars: input.variables },
      status: 'sent',
      sentAt,
    });
    logger.info(
      {
        channelId: this.channelId,
        to: input.to,
        externalId,
        templateId: input.templateId,
      },
      `[MockAdapter] sendTemplate → ${input.to} (template=${input.templateId})`
    );
    return { externalId, status: 'sent', sentAt };
  }

  async editMessage(input: EditMessageInput): Promise<void> {
    const record = this.sent.get(input.externalId);
    if (record) {
      record.payload = { ...record.payload, text: input.text, edited: true };
    }
    logger.info(
      { channelId: this.channelId, externalId: input.externalId, to: input.toE164 },
      `[MockAdapter] editMessage → "${input.text.slice(0, 60)}"`,
    );
  }

  async revokeMessage(input: RevokeMessageInput): Promise<void> {
    const record = this.sent.get(input.externalId);
    if (record) {
      record.payload = { ...record.payload, revoked: true };
    }
    logger.info(
      { channelId: this.channelId, externalId: input.externalId, to: input.toE164 },
      '[MockAdapter] revokeMessage',
    );
  }

  async getStatus(externalId: string): Promise<MessageStatus> {
    const record = this.sent.get(externalId);
    // Otimismo: tudo que foi enviado é considerado 'delivered' por default.
    // Pra testar caminhos de erro/leitura, o teste injeta um status_updated
    // via normalizeWebhook + handler de webhook.
    return record?.status ?? 'failed';
  }

  async fetchInboundMediaBuffer(
    _rawPayload: unknown,
  ): Promise<InboundMediaBuffer | null> {
    // Mock não tem mídia real pra decodificar. Caller faz fallback pro
    // download direto da URL (que no mock aponta pra placeholder público).
    return null;
  }

  // Mock: heurística simples pra cobrir os dois caminhos da UI em dev.
  // Números terminados em '0' = sem WhatsApp (warning amarelo no form);
  // qualquer outro = com WhatsApp (verde). Suficiente pra testar feedback
  // sem precisar de canal real.
  async checkNumberExists(toE164: string): Promise<boolean> {
    const resolved = await this.resolveNumber(toE164);
    return resolved.exists;
  }

  // Mock não precisa modelar a quirk BR — devolve o próprio input quando
  // exists=true. Caller persiste `whatsappE164 = matchedE164` igual ao
  // phoneE164 e segue.
  async resolveNumber(
    toE164: string,
  ): Promise<{ exists: boolean; matchedE164: string | null }> {
    const digits = toE164.replace(/\D/g, '');
    const exists = !digits.endsWith('0');
    logger.debug(
      { channelId: this.channelId, toE164, exists },
      `[MockAdapter] resolveNumber → ${exists}`,
    );
    return { exists, matchedE164: exists ? toE164 : null };
  }

  async getProfilePicture(toE164: string): Promise<string | null> {
    // Mock devolve URL placeholder estável — útil pra UI exibir avatar em
    // dev sem precisar de canal real. Inclui o telefone no path pra
    // diferenciar contatos visualmente.
    logger.debug(
      { channelId: this.channelId, toE164 },
      '[MockAdapter] getProfilePicture — devolvendo placeholder',
    );
    return `https://placehold.co/256x256?text=${encodeURIComponent(toE164)}`;
  }

  verifyWebhook(_req: WebhookRequest): boolean {
    // Mock não autentica — em dev/CI o webhook é interno. EvolutionAdapter
    // valida Bearer token contra provider_config.webhookToken.
    return true;
  }

  normalizeWebhook(rawPayload: unknown): NormalizedInboundEvent {
    const parsed = mockInboundSchema.safeParse(rawPayload);
    if (!parsed.success) {
      return {
        kind: 'ignored',
        reason: `Payload mock inválido: ${parsed.error.issues[0]?.message ?? 'desconhecido'}`,
        raw: (rawPayload ?? {}) as Record<string, unknown>,
      };
    }

    const data = parsed.data;
    const raw = rawPayload as Record<string, unknown>;

    if (data.kind === 'message_received') {
      return {
        kind: 'message_received',
        direction: data.direction,
        externalId: data.externalId ?? randomUUID(),
        fromE164: data.from,
        // Mesma regra do EvolutionAdapter: profileName só vale como hint
        // do contato quando inbound. Em outbound, pushName seria do próprio
        // canal — não pode contaminar o contato.
        profileName: data.direction === 'inbound' ? data.profileName : undefined,
        text: data.text,
        media: data.media,
        receivedAt: new Date(),
        raw,
      };
    }

    if (data.kind === 'status_updated') {
      // Atualiza memória pra getStatus retornar coerente.
      const existing = this.sent.get(data.externalId);
      if (existing) existing.status = data.status;
      return {
        kind: 'status_updated',
        externalId: data.externalId,
        status: data.status,
        error: data.error,
        updatedAt: new Date(),
        raw,
      };
    }

    if (data.kind === 'message_edited') {
      return {
        kind: 'message_edited',
        externalId: data.externalId,
        fromE164: data.from,
        text: data.text,
        editedAt: new Date(),
        raw,
      };
    }

    if (data.kind === 'message_deleted') {
      return {
        kind: 'message_deleted',
        externalId: data.externalId,
        fromE164: data.from,
        deletedAt: new Date(),
        raw,
      };
    }

    if (data.kind === 'call_received') {
      return {
        kind: 'call_received',
        externalId: data.externalId ?? randomUUID(),
        fromE164: data.from,
        status: data.status,
        durationSec: data.durationSec,
        startedAt: new Date(),
        receivedAt: new Date(),
        raw,
      };
    }

    return {
      kind: 'ignored',
      reason: data.reason,
      raw,
    };
  }
}
