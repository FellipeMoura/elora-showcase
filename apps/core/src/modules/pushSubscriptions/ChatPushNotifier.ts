import {
  clients,
  conversations,
  eq,
  messages,
  whatsappContacts,
  whatsappConversations,
  withTenant,
  type Tx,
} from '@elora/db';
import type { WhatsappMessageReceivedEvent } from '@elora/events-contracts';
import { db } from '../../shared/database/db.js';
import { logger } from '../../shared/observability/logger.js';
import { isPushConfigured, sendWebPush } from '../../shared/push/webPushClient.js';
import { chatUserIds } from '../../shared/realtime/chatAudience.js';
import { isUserActive } from '../../shared/realtime/presence.js';
import { PushSubscriptionsQuery } from './PushSubscriptionsQuery.js';
import {
  buildChatPushPayload,
  conversationTopic,
  type ChatPushSource,
  type MediaType,
  type MessageKind,
} from './chatPushPayload.js';

// Aparelho desligado por mais que isso perde a notificação (a conversa
// continua com o não-lido no app). 1 dia cobre fim de semana curto sem
// acordar o celular na segunda com mensagem de sexta.
const PUSH_TTL_SEC = 24 * 60 * 60;

// Linha com tantas falhas seguidas (5xx/timeout, não 404/410) é lixo —
// apaga pra não tentar pra sempre.
const MAX_CONSECUTIVE_FAILURES = 10;

// =====================================================================
// Push de mensagem recebida no chat. Chamado pelo redisSubscriber ao
// receber `wa.message.received` (fire-and-forget: nunca lança).
//
// Fluxo: audiência do chat (chat:use, sem o agente IA) → tira quem está
// ativo no app agora → assinaturas desses usuários → envia → limpa as
// expiradas.
// =====================================================================
export const ChatPushNotifier = {
  notifyMessageReceived: async (event: WhatsappMessageReceivedEvent): Promise<void> => {
    if (!isPushConfigured()) return;
    try {
      await deliver(event);
    } catch (err) {
      logger.error(
        {
          err: err instanceof Error ? err.message : err,
          tenantId: event.tenantId,
          conversationId: event.conversationId,
        },
        '[push] falha ao notificar mensagem recebida'
      );
    }
  },
};

async function deliver(event: WhatsappMessageReceivedEvent): Promise<void> {
  const { tenantId } = event;

  const audience = await chatUserIds(tenantId);
  const targets = audience.filter((userId) => !isUserActive(tenantId, userId));
  if (targets.length === 0) return;

  const loaded = await withTenant(db, tenantId, async (tx) => {
    const subs = await PushSubscriptionsQuery.findByUserIds(tx, targets);
    if (subs.length === 0) return null;
    const source = await loadSource(tx, event);
    return source ? { subs, source } : null;
  });
  if (!loaded) return;

  const payload = JSON.stringify(buildChatPushPayload(loaded.source));
  const topic = conversationTopic(event.conversationId);

  const results = await Promise.all(
    loaded.subs.map(async (sub) => ({
      sub,
      result: await sendWebPush(sub, payload, {
        ttlSec: PUSH_TTL_SEC,
        urgency: 'high',
        topic,
      }),
    }))
  );

  const ok: string[] = [];
  const gone: string[] = [];
  const failed: string[] = [];
  for (const { sub, result } of results) {
    if (result.kind === 'ok') ok.push(sub.id);
    else if (result.kind === 'gone') gone.push(sub.id);
    else {
      if (sub.failureCount + 1 >= MAX_CONSECUTIVE_FAILURES) gone.push(sub.id);
      else failed.push(sub.id);
      logger.warn(
        { tenantId, subscriptionId: sub.id, statusCode: result.statusCode, err: result.message },
        '[push] envio falhou'
      );
    }
  }

  await withTenant(db, tenantId, async (tx) => {
    await PushSubscriptionsQuery.markSuccess(tx, ok);
    await PushSubscriptionsQuery.incrementFailure(tx, failed);
    await PushSubscriptionsQuery.deleteByIds(tx, gone);
  });

  logger.debug(
    {
      tenantId,
      conversationId: event.conversationId,
      audience: audience.length,
      skippedActive: audience.length - targets.length,
      sent: ok.length,
      removed: gone.length,
      failed: failed.length,
    },
    '[push] mensagem recebida notificada'
  );
}

async function loadSource(
  tx: Tx,
  event: WhatsappMessageReceivedEvent
): Promise<ChatPushSource | null> {
  const [msg] = await tx
    .select({
      body: messages.body,
      kind: messages.kind,
      mediaType: messages.mediaType,
      deletedAt: messages.deletedAt,
      clientName: clients.name,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .leftJoin(clients, eq(clients.id, conversations.clientId))
    .where(eq(messages.id, event.messageId))
    .limit(1);
  // Mensagem apagada antes do push sair: não notifica.
  if (!msg || msg.deletedAt) return null;

  const [contact] = await tx
    .select({
      profileName: whatsappContacts.profileName,
      phoneE164: whatsappContacts.phoneE164,
    })
    .from(whatsappConversations)
    .innerJoin(whatsappContacts, eq(whatsappContacts.id, whatsappConversations.whatsappContactId))
    .where(eq(whatsappConversations.id, event.whatsappConversationId))
    .limit(1);

  return {
    conversationId: event.conversationId,
    isNewLead: event.isNewLead,
    receivedAt: event.receivedAt,
    clientName: msg.clientName,
    // Elora não tem nome fantasia — só o nome do cliente.
    clientTradeName: null,
    contactProfileName: contact?.profileName ?? null,
    contactPhoneE164: contact?.phoneE164 ?? null,
    messageBody: msg.body,
    messageKind: msg.kind as MessageKind,
    messageMediaType: (msg.mediaType as MediaType | null) ?? null,
  };
}
