import { z } from 'zod';

// =====================================================================
// Tipos canônicos da camada de transporte WhatsApp (provider-agnostic).
// Adapters (Evolution, Mock) trabalham nesses tipos — o resto do app
// NUNCA toca em payload bruto de provedor.
// =====================================================================

// ---- Outbound (mensagens que saem) ----

// `sticker` aparece em InboundMessageEvent quando cliente envia figurinha
// (parseado de message.stickerMessage). NÃO é alvo de outbound V1 — a UI
// nunca envia sticker (sendMediaSchema em MessagesTypes restringe a
// image/audio/video/document). Forward-compat: o dia que vier sendSticker,
// já não precisa migrar tipo de payload.
export const mediaPayloadSchema = z.object({
  type: z.enum(['image', 'audio', 'video', 'document', 'sticker']),
  url: z.string().url(),
  caption: z.string().optional(),
  filename: z.string().optional(),
  mimeType: z.string().optional(),
});

export type MediaPayload = z.infer<typeof mediaPayloadSchema>;

// Contexto pra responder/citar uma mensagem específica. WhatsApp Web mostra a
// citação como bloco acima da nova msg, com cor/borda da quem mandou.
// `externalId` é o id WhatsApp da msg respondida; `participantE164` é quem
// originalmente mandou (a outra ponta da conversa pra inbound resposta, ou o
// próprio número conectado pra outbound resposta). Evolution monta o `quoted`
// nativo dali — sem isso, vira mensagem normal sem citação visual no celular.
export const quotedRefSchema = z.object({
  externalId: z.string().min(1),
  // Telefone da mensagem citada. Pra citar inbound, é o cliente; pra citar
  // outbound (citar a si mesmo), é o número da clínica.
  participantE164: z.string().min(8),
  // Se a msg citada era nossa (`fromMe=true` no protocolo) ou do cliente.
  // Evolution usa pra setar o flag correto no quoted.
  fromMe: z.boolean(),
  // Body original da mensagem citada — vai em `quoted.message.conversation`.
  // Não obrigatório (a maioria dos clients renderiza pelo id), mas alguns
  // builds antigos da Evolution exigem. Caller (MessagesService) carrega do
  // banco antes de enfileirar.
  body: z.string().optional(),
});

export type QuotedRef = z.infer<typeof quotedRefSchema>;

// `to` é E.164 (+5511999999999). Adapter de cada provider normaliza
// se o formato divergir (ex: Evolution aceita só dígitos).
export const outboundTextSchema = z.object({
  to: z.string().min(8),
  text: z.string().min(1).max(4096),
  quoted: quotedRefSchema.optional(),
});

export const outboundMediaSchema = z.object({
  to: z.string().min(8),
  media: mediaPayloadSchema,
  quoted: quotedRefSchema.optional(),
});

export const outboundTemplateSchema = z.object({
  to: z.string().min(8),
  templateId: z.string().min(1),
  variables: z.record(z.string()).default({}),
  // Body do template já com variáveis substituídas. Caller (MessagesService)
  // renderiza antes de chamar — adapter de track Baileys usa isso pra enviar
  // como texto (não há aprovação Meta). Adapter de track Cloud ignora e usa
  // templateId + variables pra invocar a API de template oficial.
  renderedBody: z.string().min(1).optional(),
});

export type OutboundText = z.infer<typeof outboundTextSchema>;
export type OutboundMedia = z.infer<typeof outboundMediaSchema>;
export type OutboundTemplate = z.infer<typeof outboundTemplateSchema>;

// Edição de mensagem outbound. `externalId` + `toE164` identificam unicamente
// a msg no WhatsApp (provider precisa do par). `text` é o novo conteúdo —
// substitui o anterior. V1 só texto; caption de mídia fica pra V2.
export interface EditMessageInput {
  externalId: string;
  toE164: string;
  text: string;
}

// Revogação de msg outbound (apagar pra todos no WhatsApp). Sem prazo no
// protocolo, mas WhatsApp pode rejeitar mensagens muito antigas — caller
// trata o erro do provider e devolve 400 pro frontend nesse caso.
export interface RevokeMessageInput {
  externalId: string;
  toE164: string;
}

// ---- Resultado do envio ----

export type MessageStatus = 'queued' | 'sent' | 'delivered' | 'read' | 'failed';

export interface MessageRef {
  // ID que vai pra `whatsapp_messages.external_id`. Único dentro do provider.
  externalId: string;
  status: MessageStatus;
  sentAt: Date;
  // Quando status='failed', motivo retornado pelo provider.
  error?: string;
}

// ---- Inbound (eventos vindos via webhook do provider) ----
// Cada adapter recebe payload bruto e converte pra esse union.

export interface InboundMessageEvent {
  kind: 'message_received';
  // Direção do tráfego no canal — distingue mensagem que entrou (cliente
  // mandou) de mensagem que SAIU mas o staff disparou direto pelo celular
  // pareado (webhook `fromMe=true`). Esse segundo caso vira `outbound` no
  // pipeline com flag `authoredOnDevice=true` no domain. Ver
  // arquitetura.md §7.4.
  direction: 'inbound' | 'outbound';
  externalId: string;
  // Telefone da outra ponta da conversa em E.164. Quando `direction='inbound'`,
  // é o remetente. Quando `direction='outbound'`, é o destinatário — ainda
  // assim este campo serve pra resolver o contato (mesmo número, mesma linha
  // de `whatsapp_contacts`).
  fromE164: string;
  // Nome do perfil quando o provider entrega.
  profileName?: string;
  // Texto simples se for mensagem de texto.
  text?: string;
  // Quando for mídia, o provider entrega URL pública/temporária + tipo.
  media?: MediaPayload;
  // ExternalId (whatsapp_message_id remoto) da mensagem sendo respondida —
  // populado quando o webhook traz `contextInfo.stanzaId` (cliente citou
  // uma mensagem prévia ao responder). Pipeline mapeia pro id local via
  // WhatsappMessagesQuery.findByExternalId restrito à conversa atual. Pode
  // ficar null se a citação aponta pra msg fora do nosso histórico.
  replyToExternalId?: string;
  receivedAt: Date;
  // Payload bruto pra debug/forense. Não usar pra lógica.
  raw: Record<string, unknown>;
}

export interface InboundStatusEvent {
  kind: 'status_updated';
  externalId: string;
  status: MessageStatus;
  updatedAt: Date;
  error?: string;
  raw: Record<string, unknown>;
}

// Cliente editou uma mensagem que já enviou. WhatsApp deixa editar até 15min
// após o envio — adapter parseia o evento (messages.update com flag de edit
// no Evolution) e devolve o NOVO conteúdo. Pipeline faz UPDATE in-place em
// messages.body + edited_at. Não mantemos histórico de versões — mesmo
// comportamento do WhatsApp Web. NÃO há `direction` aqui porque V1 só
// captamos edição inbound (cliente). Edição outbound é disparada
// explicitamente pelo MessagesService.editMessage e não passa por webhook.
export interface InboundMessageEditedEvent {
  kind: 'message_edited';
  externalId: string;
  fromE164: string;
  // Novo texto. WhatsApp Web só edita texto — se vier caption de mídia
  // (raro), tratamos igual texto (substitui body).
  text: string;
  editedAt: Date;
  raw: Record<string, unknown>;
}

// Cliente apagou uma mensagem que já enviou ("apagar pra todos" no app).
// Pipeline faz soft delete: deleted_at + deletion_origin='client'. Conteúdo
// permanece no DB pra auditoria; UI esconde body/mediaUrl e mostra texto de
// notificação ("Esta mensagem foi apagada"). NÃO é fluxo simétrico ao
// outbound revoke — esse aqui é o cliente apagando, o outbound revoke é o
// staff disparando via MessagesService.revokeMessage.
export interface InboundMessageDeletedEvent {
  kind: 'message_deleted';
  externalId: string;
  fromE164: string;
  deletedAt: Date;
  raw: Record<string, unknown>;
}

// Tentativa/conclusão de chamada de voz/vídeo no WhatsApp. Pipeline cria uma
// message com `kind='call'` na timeline da conversation pra staff ver que
// cliente tentou ligar. Não é mensagem clicável — apenas notificação visual.
// `status` cobre os 3 cenários práticos: `missed` (não atendemos), `received`
// (atendemos), `declined` (recusamos). V1 captura só inbound (cliente liga
// pra clínica); outbound ficaria se UI tiver botão "ligar" — fora de escopo.
export interface InboundCallEvent {
  kind: 'call_received';
  externalId: string;
  fromE164: string;
  status: 'missed' | 'received' | 'declined';
  // Duração em segundos quando atendida. Ausente em missed/declined.
  durationSec?: number;
  startedAt: Date;
  receivedAt: Date;
  raw: Record<string, unknown>;
}

// Payloads válidos mas que não viram registro no domain (presença online,
// digitando, ack interno do provider). Adapter sinaliza pra o normalizer
// dropar limpo, sem tratar como erro.
export interface InboundIgnoredEvent {
  kind: 'ignored';
  reason: string;
  raw: Record<string, unknown>;
}

// Estado do socket reportado pelo provider (Evolution CONNECTION_UPDATE,
// equivalente Meta/etc). Pipeline atualiza `whatsapp_channels.connection_state`
// pra UI mostrar status e oncall saber quando o canal cai. Provider envia
// vários por segundo durante reconexão — pipeline filtra por "estado mudou".
export type ConnectionStateName = 'open' | 'connecting' | 'closed' | 'unknown';

export interface InboundConnectionStateEvent {
  kind: 'connection_state';
  state: ConnectionStateName;
  receivedAt: Date;
  raw: Record<string, unknown>;
}

export type NormalizedInboundEvent =
  | InboundMessageEvent
  | InboundStatusEvent
  | InboundMessageEditedEvent
  | InboundMessageDeletedEvent
  | InboundCallEvent
  | InboundConnectionStateEvent
  | InboundIgnoredEvent;

// ---- Webhook verification ----
// Tudo que `verifyWebhook` precisa, extraído da Request Express. Tipo
// próprio (vs. aceitar `Request` direto) porque o adapter não deve depender
// de Express — facilita teste e uso fora de HTTP.
export interface WebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  // Buffer do payload original (antes de JSON.parse). Necessário pra
  // verificações HMAC, que recalculam hash sobre os bytes exatos recebidos.
  // Capturado por `express.json({ verify })` em server.ts.
  rawBody: Buffer;
  query: Record<string, string | string[] | undefined>;
}
