import { eq, whatsappConversations, withTenant } from '@elora/db';
import { db } from '../../database/db.js';
import { coreGateway } from '../../coreGateway/index.js';
import { EVENT_CHANNELS, eventBus } from '../../eventBus/index.js';
import { logger } from '../../observability/logger.js';
import { markUiOutbound } from '../../observability/outboundDuplicationDetector.js';
import { OutboundGuard } from '../../outboundGuard/outboundGuard.js';
import { createWhatsappProvider } from '../../providers/whatsapp/providerFactory.js';
import type { MessageRef } from '../../providers/whatsapp/types.js';
import { MediaStorage } from '../../storage/index.js';
import { ConversationsQuery } from '../../../modules/conversations/ConversationsQuery.js';
import { MessageTemplatesService } from '../../../modules/messageTemplates/MessageTemplatesService.js';
import { MessagesQuery } from '../../../modules/messages/MessagesQuery.js';
import type { Message } from '../../../modules/messages/MessagesTypes.js';
import { WhatsappChannelsService } from '../../../modules/whatsappChannels/WhatsappChannelsService.js';
import { WhatsappContactsQuery } from '../../../modules/whatsappContacts/WhatsappContactsQuery.js';
import { WhatsappContactsService } from '../../../modules/whatsappContacts/WhatsappContactsService.js';
import { WhatsappConversationsService } from '../../../modules/whatsappConversations/WhatsappConversationsService.js';
import { WhatsappMessagesQuery } from '../../../modules/whatsappMessages/WhatsappMessagesQuery.js';
import { tryAcquireConvLock } from './convLock.js';
import type { OutboundJobData } from './types.js';

// =====================================================================
// Pipeline do OutboundDeliveryWorker. Roda pra cada job da fila.
//
// Fluxo (compare com comments em MessagesService.enqueueOutbound):
//   1. Lock por conversationId — preserva ordem dentro da conv. Quem não
//      pega, lança LockUnavailableError → worker.ts move o job pra delayed.
//   2. Carrega a message domain (sempre tem `deliveryStatus='pending'` por
//      construção do enqueue — guard interno valida e ignora caso contrário).
//   3. Resolve contexto: contact, channel, conv transport.
//   4. Pre-flight gates: opt-in, canal ativo+open, janela 24h (Cloud) ou
//      OutboundGuard (Baileys). Cada falha → markDeliveryFailed('rejected',
//      reason) + publish + return.
//   5. Outbox: pré-insere whatsapp_messages com external_id=NULL + chama
//      markUiOutbound. Garante que detector + DB têm rastro ANTES de
//      provider.send abrir a janela de eco. Cleanup: markOutboxFailed em
//      caso de erro do adapter (status='failed' preserva auditoria).
//   6. Resolve payload (texto direto, mídia com presigned URL, template
//      renderizado) e chama adapter. Falha de rede/provider →
//      markOutboxFailed + markDeliveryFailed('failed', 'provider_error') +
//      publish + return.
//   7. Finaliza em transação única:
//        - UPDATE whatsapp_messages outbox row com externalId + payload reais
//        - UPDATE messages (status='sent', sent_at, whatsapp_message_id)
//        - touch whatsapp_conversations.last_outbound_at
//        - touch conversations.last_message_at
//   8. Side-effects pós-tx: journey activity, lead_substage, publish
//      wa.message.sent (compat com listeners de cascata existentes).
//   9. Publish wa.message.status_changed (todas as transições).
// =====================================================================

// Erro sinalizador pro worker.ts mover o job pra delayed e devolver o slot.
// Não é falha real — apenas concorrência com outra msg da mesma conv.
export class LockUnavailableError extends Error {
  constructor(public readonly conversationId: string) {
    super(`Lock indisponível pra conversation ${conversationId}`);
    this.name = 'LockUnavailableError';
  }
}

export async function processOutboundJob(data: OutboundJobData): Promise<void> {
  const { tenantId, conversationId, messageId } = data;

  const lock = await tryAcquireConvLock(conversationId, `job:${messageId}`);
  if (!lock) throw new LockUnavailableError(conversationId);

  try {
    await runPipeline(tenantId, conversationId, messageId);
  } finally {
    await lock.release();
  }
}

async function runPipeline(
  tenantId: string,
  conversationId: string,
  messageId: string,
): Promise<void> {
  // ─── 2. Carrega message pendente ─────────────────────────────────────
  const message = await withTenant(db, tenantId, (tx) =>
    MessagesQuery.findById(tx, messageId),
  );
  if (!message) {
    logger.warn({ tenantId, messageId }, '[outboundWorker] message não encontrada — skip');
    return;
  }
  if (message.deliveryStatus !== 'pending') {
    // Reconciler já tocou OU job duplicado. Idempotente — só loga.
    logger.debug(
      { tenantId, messageId, status: message.deliveryStatus },
      '[outboundWorker] message já saiu de pending — skip',
    );
    return;
  }
  if (message.direction !== 'outbound') {
    logger.warn(
      { tenantId, messageId, direction: message.direction },
      '[outboundWorker] message não é outbound — skip (bug?)',
    );
    return;
  }

  // ─── 3. Resolve contexto ─────────────────────────────────────────────
  const conv = await withTenant(db, tenantId, async (tx) => {
    return ConversationsQuery.findById(tx, conversationId);
  });
  if (!conv) {
    await rejectAndPublish(
      tenantId,
      conversationId,
      messageId,
      'unknown',
      { detail: 'conversation não encontrada' },
    );
    return;
  }

  // Contato = o ativo do cliente (no máximo 1, índice parcial
  // wa_contacts_client_active_unique), e tem que ser do canal da conversa —
  // antes pegava o primeiro de qualquer canal (inclusive inativo).
  //
  // Cliente cadastrado à mão que nunca falou no WhatsApp não tem contato:
  // cria no canal da conversa a partir do phone_e164 do cadastro. Nasce sem
  // opt-in, então o pre-flight abaixo rejeita como no_opt_in — a UI oferece
  // "registrar opt-in" e o retry passa.
  const contacts = await withTenant(db, tenantId, (tx) =>
    WhatsappContactsQuery.findByClientId(tx, conv.clientId),
  );
  const activeContact = contacts.find((c) => c.active) ?? null;
  if (activeContact && activeContact.whatsappChannelId !== conv.whatsappChannelId) {
    await rejectAndPublish(tenantId, conversationId, messageId, 'unknown', {
      detail: 'contato WhatsApp do cliente está em outro canal',
      contactChannelId: activeContact.whatsappChannelId,
    });
    return;
  }
  let waContact = activeContact;
  if (!waContact) {
    const created = await WhatsappContactsService.findOrCreateByPhone(
      tenantId,
      conv.whatsappChannelId,
      conv.client.phoneE164,
    );
    waContact =
      created.clientId === conv.clientId
        ? created
        : ((await withTenant(db, tenantId, (tx) =>
            WhatsappContactsQuery.update(tx, created.id, { clientId: conv.clientId }),
          )) ?? created);
  }

  if (!waContact.optedInAt) {
    await rejectAndPublish(tenantId, conversationId, messageId, 'no_opt_in', {
      phone: waContact.phoneE164,
    });
    return;
  }

  // Canal precisa estar ativo + connectionState='open'. Self-heal via live
  // re-fetch se cache diverge (evento CONNECTION_UPDATE pode ter sido perdido).
  let channel = await WhatsappChannelsService.findById(
    tenantId,
    waContact.whatsappChannelId,
  );
  if (!channel.active) {
    await rejectAndPublish(tenantId, conversationId, messageId, 'channel_disconnected', {
      reason: 'canal desativado',
      channelId: channel.id,
    });
    return;
  }
  const isMockChannel =
    (channel.providerConfig as Record<string, unknown> | null)?.mock === true;
  if (!isMockChannel && channel.connectionState !== 'open') {
    try {
      const live = await WhatsappChannelsService.getConnectionState(tenantId, channel.id);
      if (live.state !== channel.connectionState) {
        const updated = await WhatsappChannelsService.setConnectionState(
          tenantId,
          channel.id,
          live.state,
          new Date(),
        );
        if (updated) channel = updated;
      }
      if (live.state !== 'open') {
        await rejectAndPublish(
          tenantId,
          conversationId,
          messageId,
          'channel_disconnected',
          { liveState: live.state, channelId: channel.id },
        );
        return;
      }
    } catch (err) {
      logger.warn(
        { tenantId, channelId: channel.id, err: err instanceof Error ? err.message : err },
        '[outboundWorker] getConnectionState falhou — bloqueia por defesa',
      );
      await rejectAndPublish(
        tenantId,
        conversationId,
        messageId,
        'channel_disconnected',
        { reason: 'live state check falhou', channelId: channel.id },
      );
      return;
    }
  }

  const waConv = await WhatsappConversationsService.findOrCreate(
    tenantId,
    channel.id,
    waContact.id,
    conversationId,
  );

  // ─── 4. Pre-flight provider-aware ────────────────────────────────────
  const provider = createWhatsappProvider(channel);
  const isTemplate = message.kind === 'template';

  // Resolve o número de envio. `whatsapp_e164` é cache da resolução prévia
  // (do check no cadastro ou de um envio anterior). Quando vazio, faz lazy
  // backfill agora: probe das variantes BR, UPDATE no contato, e usa o
  // número resolvido daqui em diante. Se a conta não existir mais no
  // WhatsApp (cliente fez switch / deletou), reject `not_on_whatsapp` —
  // staff atualiza o cadastro.
  let sendingToE164 = waContact.whatsappE164 ?? null;
  if (!sendingToE164) {
    try {
      const resolved = await provider.resolveNumber(waContact.phoneE164);
      if (!resolved.exists || !resolved.matchedE164) {
        await rejectAndPublish(
          tenantId,
          conversationId,
          messageId,
          'not_on_whatsapp',
          { phoneE164: waContact.phoneE164 },
        );
        return;
      }
      sendingToE164 = resolved.matchedE164;
      await withTenant(db, tenantId, (tx) =>
        WhatsappContactsQuery.update(tx, waContact.id, {
          whatsappE164: sendingToE164!,
        }),
      );
    } catch (err) {
      logger.warn(
        {
          tenantId,
          channelId: channel.id,
          contactId: waContact.id,
          err: err instanceof Error ? err.message : err,
        },
        '[outboundWorker] resolveNumber falhou — caindo em provider_error',
      );
      await failAndPublish(
        tenantId,
        conversationId,
        messageId,
        'provider_error',
        { stage: 'resolveNumber' },
      );
      return;
    }
  }

  if (provider.requiresWindowGate()) {
    if (!isTemplate) {
      const windowState = await WhatsappConversationsService.windowStatus(
        tenantId,
        waConv.id,
      );
      if (!windowState.withinInboundWindow) {
        await rejectAndPublish(
          tenantId,
          conversationId,
          messageId,
          'window_24h_expired',
          { lastInboundAt: windowState.lastInboundAt },
        );
        return;
      }
    }
  } else {
    if (isTemplate) {
      await rejectAndPublish(tenantId, conversationId, messageId, 'invalid_template', {
        reason: 'template não suportado neste provider',
        providerType: channel.providerType,
      });
      return;
    }
    const guardBody =
      message.kind === 'media' ? message.body ?? null : message.body;
    const guard = await OutboundGuard.check({
      channelId: channel.id,
      recipientPhone: sendingToE164,
      body: guardBody,
    });
    if (!guard.allowed) {
      await rejectAndPublish(tenantId, conversationId, messageId, 'rate_limited', {
        guardReason: guard.reason,
        retryAfterSec: guard.retryAfterSec,
      });
      return;
    }
  }

  // ─── 5. Outbox pre-insert ────────────────────────────────────────────
  // Reserva a row de transport ANTES de chamar provider.send. Dois ganhos:
  //   (a) markUiOutbound roda antes do adapter — a flag fica setada quando
  //       o webhook eco chega (típico em <100ms), o que casa com o hard-block
  //       em inboundNormalizer/pipeline.ts:handleOutboundCaptured.
  //   (b) Se Evolution responde com externalId X e webhook eco traz externalId
  //       diferente (visto com sendMedia v2), a row já existe no DB com NULL —
  //       finalizamos no commit do worker. Sem a pré-inserção haveria janela
  //       onde nem o detector nem o findByExternalId capturavam o eco.
  // payloadType começa como aproximação a partir do message.kind; a tx do
  // step 7 sobrescreve com o tipo real retornado pelo adapter.
  const outboxWaMsg = await withTenant(db, tenantId, async (tx) =>
    WhatsappMessagesQuery.create(tx, {
      tenantId,
      whatsappConversationId: waConv.id,
      externalId: undefined,
      direction: 'outbound',
      payloadType: outboxPayloadType(message),
      payload: {},
      status: 'queued',
    }),
  );

  // Detector da UI marcado AGORA (não pós-persist). Janela 10s cobre o
  // round-trip Evolution → WhatsApp → webhook eco; setar depois do persist
  // abria buraco onde eco rápido escapava do hard-block.
  markUiOutbound(tenantId, conversationId);

  // ─── 6. Adapter ──────────────────────────────────────────────────────
  // Resolve quoted ref antes do build pra passar pro adapter. Reply target
  // foi validado na enqueue (mesma conversa + tem whatsapp_message_id), mas
  // entre o INSERT pending e o envio pode ter sido apagada — caso raro,
  // tratamos enviando sem quoted (operador pode não notar a perda, mas a
  // mensagem entrega).
  const quoted = await resolveQuotedRef(tenantId, message, sendingToE164);

  let messageRef: MessageRef;
  let payloadType: string;
  let payload: Record<string, unknown>;
  try {
    const built = await buildAndSend(
      provider,
      message,
      sendingToE164,
      tenantId,
      quoted,
    );
    messageRef = built.messageRef;
    payloadType = built.payloadType;
    payload = built.payload;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(
      { tenantId, messageId, channelId: channel.id, err: errMsg },
      '[outboundWorker] adapter lançou exceção',
    );
    await withTenant(db, tenantId, (tx) =>
      WhatsappMessagesQuery.markOutboxFailed(tx, outboxWaMsg.id, errMsg),
    );
    await failAndPublish(tenantId, conversationId, messageId, 'provider_error', {
      message: errMsg,
    });
    return;
  }

  if (messageRef.status === 'failed') {
    logger.warn(
      { tenantId, messageId, externalId: messageRef.externalId, error: messageRef.error },
      '[outboundWorker] adapter retornou failed',
    );
    await withTenant(db, tenantId, (tx) =>
      WhatsappMessagesQuery.markOutboxFailed(
        tx,
        outboxWaMsg.id,
        messageRef.error ?? 'adapter retornou failed',
      ),
    );
    await failAndPublish(tenantId, conversationId, messageId, 'provider_error', {
      externalId: messageRef.externalId,
      providerError: messageRef.error,
    });
    return;
  }

  // ─── 7. Persiste sucesso em transação única ──────────────────────────
  // Finaliza o outbox row (mesma id pré-inserida) — UPDATE em vez de INSERT
  // pra preservar a row que o detector e o webhook já podem estar observando.
  //
  // Relógio único da timeline (shared/utils/messageClock.ts): o domínio usa o
  // relógio deste servidor no momento da confirmação; o `messageRef.sentAt`
  // (relógio do host do Evolution) fica só no transport. Mensagem recém
  // enviada nunca é "backlog", então não passa pelo resolveMessageTimestamp.
  const sentAt = new Date();
  const persisted = await withTenant(db, tenantId, async (tx) => {
    const waMsg = await WhatsappMessagesQuery.finalizeOutbox(tx, outboxWaMsg.id, {
      externalId: messageRef.externalId,
      payloadType,
      payload,
      status: messageRef.status,
      sentAt: messageRef.sentAt,
    });
    if (!waMsg) {
      logger.warn(
        { tenantId, messageId, outboxId: outboxWaMsg.id },
        '[outboundWorker] outbox row sumiu antes do finalize (cleanup manual? bug?) — abortando publish',
      );
      return null;
    }

    const updatedMsg = await MessagesQuery.markDeliverySent(
      tx,
      messageId,
      waMsg.id,
      sentAt,
      message.kind === 'media' ? message.mediaUrl : null,
    );
    if (!updatedMsg) {
      // Race: reconciler/outro worker já moveu pra terminal. Mantém
      // whatsapp_messages criada (audit) e segue — não publica wa.message.sent
      // pra evitar evento conflitante. Loga pra investigar.
      logger.warn(
        { tenantId, messageId, externalId: waMsg.externalId },
        '[outboundWorker] markDeliverySent não atualizou (race com reconciler?)',
      );
      return null;
    }

    await tx
      .update(whatsappConversations)
      .set({ lastOutboundAt: sentAt })
      .where(eq(whatsappConversations.id, waConv.id));

    await ConversationsQuery.touchLastMessageAt(tx, conversationId, sentAt);

    return { waMsg, domainMsg: updatedMsg };
  });

  if (!persisted) return;

  // ─── 8. Side-effects pós-tx ──────────────────────────────────────────

  // Resolve journey ativa apenas pra cascata — a message já tem journey_id
  // se o controller a carimbou no INSERT (inputs do enqueue passam por lá).
  const journeyId = persisted.domainMsg.journeyId;
  if (journeyId) {
    try {
      await coreGateway.journeysTouchActivity(tenantId, journeyId);
      await coreGateway.journeysRecomputeLeadSubstage(tenantId, journeyId, 'outbound_sent');
    } catch (err) {
      // Side-effect falhar não desfaz envio — só loga. UI já refletiu sucesso.
      logger.warn(
        { tenantId, messageId, journeyId, err: err instanceof Error ? err.message : err },
        '[outboundWorker] cascata de journey falhou (best-effort)',
      );
    }
  }

  // Publish compat — wa.message.sent continua existindo pra listeners de
  // cascata. Mantém clientId disponível pro relay no apps/core.
  await eventBus.publish(EVENT_CHANNELS.whatsappMessageSent, {
    tenantId,
    channelId: channel.id,
    whatsappConversationId: waConv.id,
    conversationId,
    whatsappMessageId: persisted.waMsg.id,
    messageId: persisted.domainMsg.id,
    clientId: conv.clientId,
    authorUserId: persisted.domainMsg.authorUserId,
    authoredOnDevice: false,
    sentAt: sentAt.toISOString(),
  });

  // Publish transição (frontend atualiza badge da bolha).
  await publishStatusChanged(tenantId, channel.id, conversationId, messageId, 'sent', null);
}

// =====================================================================
// Helpers de UPDATE + publish, repetidos várias vezes acima.
// =====================================================================

async function rejectAndPublish(
  tenantId: string,
  conversationId: string,
  messageId: string,
  reason:
    | 'no_opt_in'
    | 'not_on_whatsapp'
    | 'channel_disconnected'
    | 'window_24h_expired'
    | 'invalid_template'
    | 'rate_limited'
    | 'unknown',
  detail: Record<string, unknown> | null,
): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    MessagesQuery.markDeliveryFailed(tx, messageId, 'rejected', reason, detail),
  );
  // channelId pode ser desconhecido nesse ponto (ex: contact não existe). Usa
  // string vazia como fallback — relay no core só usa pra label/log, sala
  // socket é por conversation/tenant.
  await publishStatusChanged(tenantId, '', conversationId, messageId, 'rejected', reason);
}

async function failAndPublish(
  tenantId: string,
  conversationId: string,
  messageId: string,
  reason: 'provider_error' | 'worker_timeout' | 'unknown',
  detail: Record<string, unknown> | null,
): Promise<void> {
  await withTenant(db, tenantId, (tx) =>
    MessagesQuery.markDeliveryFailed(tx, messageId, 'failed', reason, detail),
  );
  await publishStatusChanged(tenantId, '', conversationId, messageId, 'failed', reason);
}

async function publishStatusChanged(
  tenantId: string,
  channelId: string,
  conversationId: string,
  messageId: string,
  deliveryStatus: 'pending' | 'sent' | 'failed' | 'rejected',
  failureReason:
    | 'no_opt_in'
    | 'not_on_whatsapp'
    | 'channel_disconnected'
    | 'window_24h_expired'
    | 'invalid_template'
    | 'rate_limited'
    | 'provider_error'
    | 'worker_timeout'
    | 'unknown'
    | null,
): Promise<void> {
  await eventBus.publish(EVENT_CHANNELS.whatsappMessageStatusChanged, {
    tenantId,
    channelId,
    conversationId,
    messageId,
    deliveryStatus,
    failureReason,
    updatedAt: new Date().toISOString(),
  });
}

// =====================================================================
// Constrói payload do adapter conforme kind + envia. Encapsula a renderização
// de template e a geração de presigned URL pra mídia (precisa ser fresca no
// momento do envio, não no momento do INSERT).
// =====================================================================
interface BuiltSend {
  messageRef: MessageRef;
  payloadType: string;
  payload: Record<string, unknown>;
}

async function buildAndSend(
  provider: ReturnType<typeof createWhatsappProvider>,
  message: Message,
  toE164: string,
  tenantId: string,
  quoted: import('../../providers/whatsapp/types.js').QuotedRef | undefined,
): Promise<BuiltSend> {
  if (message.kind === 'text') {
    const body = message.body ?? '';
    const ref = await provider.sendText({ to: toE164, text: body, quoted });
    return { messageRef: ref, payloadType: 'text', payload: { text: body } };
  }

  if (message.kind === 'media') {
    if (!message.mediaUrl || !message.mediaType) {
      throw new Error('media message sem mediaUrl/mediaType');
    }
    const presignedUrl = await MediaStorage.getProviderDownloadUrl(message.mediaUrl);
    const ref = await provider.sendMedia({
      to: toE164,
      media: {
        type: message.mediaType as 'image' | 'audio' | 'video' | 'document',
        url: presignedUrl,
        caption: message.body ?? undefined,
      },
      quoted,
    });
    return {
      messageRef: ref,
      payloadType: message.mediaType,
      payload: {
        media: {
          type: message.mediaType,
          objectKey: message.mediaUrl,
          caption: message.body ?? undefined,
        },
      },
    };
  }

  if (message.kind === 'template') {
    if (!message.templateId) throw new Error('template message sem templateId');
    const template = await MessageTemplatesService.findById(tenantId, message.templateId);
    if (!template.active) {
      // Template foi desativado entre INSERT e processamento. Levanta — caller
      // converte em failure_reason='invalid_template'.
      const e = new Error('Template desativado');
      (e as Error & { code?: string }).code = 'INVALID_TEMPLATE';
      throw e;
    }
    const variables = message.templateVariables ?? {};
    const ref = await provider.sendTemplate({
      to: toE164,
      templateId: template.id,
      variables,
      renderedBody: message.body ?? '',
    });
    return {
      messageRef: ref,
      payloadType: 'template',
      payload: { templateId: template.id, variables },
    };
  }

  throw new Error(`kind não suportado pelo worker outbound: ${message.kind}`);
}

// Aproximação do payloadType usada no pre-insert do outbox. O valor real é
// definido por buildAndSend e sobrescrito em finalizeOutbox — esta função só
// existe pra evitar default 'text' chamativo em registros que serão mídia.
function outboxPayloadType(message: Message): string {
  if (message.kind === 'media') return message.mediaType ?? 'document';
  if (message.kind === 'template') return 'template';
  return 'text';
}

// Carrega a mensagem-alvo do reply e monta o QuotedRef pra passar ao adapter.
// `toE164` é o número do cliente (= participantE164 num chat 1:1 — quoted é
// sempre dentro da mesma conversa). `fromMe` reflete se o quoted é nosso
// (outbound) ou do cliente (inbound). Se a msg-alvo sumiu (apagada entre
// INSERT e processamento) ou não tem whatsapp_message_id, devolve undefined
// — envio segue sem citação visual (degradação aceitável).
async function resolveQuotedRef(
  tenantId: string,
  message: Message,
  toE164: string,
): Promise<import('../../providers/whatsapp/types.js').QuotedRef | undefined> {
  if (!message.replyToMessageId) return undefined;
  return withTenant(db, tenantId, async (tx) => {
    const target = await MessagesQuery.findById(tx, message.replyToMessageId!);
    if (!target || !target.whatsappMessageId) return undefined;
    const waMsg = await WhatsappMessagesQuery.findById(tx, target.whatsappMessageId);
    if (!waMsg || !waMsg.externalId) return undefined;
    return {
      externalId: waMsg.externalId,
      participantE164: toE164,
      fromMe: target.direction === 'outbound',
      body: target.body ?? undefined,
    };
  });
}
