import {
  EVENT_CHANNELS,
  type MessageCreatedEvent,
} from '@elora/events-contracts';
import { redisSubscriber } from '../../shared/redis/redis.js';
import { logger } from '../../shared/observability/logger.js';
import { idleTriggerScheduler } from './IdleTriggerScheduler.js';

// =====================================================================
// HumanReplyCanceller — assina `message.created`. Esse canal é publicado
// pelo apps/chat APENAS pra outbound recém-inserida em `messages` (ver
// MessagesService.ts:439 + descrição em events-contracts). Significa que
// QUALQUER mensagem outbound (UI staff, celular pareado capturado, ou
// futuramente o próprio agent) passa por aqui.
//
// Regra: cancela o trigger pendente da conversa SE author != system agent.
// Cancelamento é idempotente (queue ignora job inexistente). Cancelar
// quando agente acabou de mandar quebra o pipeline — IdleTriggerScheduler
// filtra esse caso antes de tocar na fila.
// =====================================================================

let started = false;

function handleRawMessage(raw: string): void {
  let payload: MessageCreatedEvent;
  try {
    payload = JSON.parse(raw) as MessageCreatedEvent;
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : err,
        raw: raw.slice(0, 200),
      },
      '[humanReplyCanceller] payload mal-formado',
    );
    return;
  }

  void handlePayload(payload);
}

async function handlePayload(p: MessageCreatedEvent): Promise<void> {
  try {
    const result = await idleTriggerScheduler.handleHumanReply({
      tenantId: p.tenantId,
      conversationId: p.conversationId,
      authorUserId: p.authorUserId,
    });

    if (result.decision === 'cancelled') {
      // Log já saiu no scheduler — não duplicar aqui.
      return;
    }
    logger.debug(
      {
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        authorUserId: p.authorUserId,
        reason: result.reason,
      },
      '[humanReplyCanceller] mantido (sem cancel)',
    );
  } catch (err) {
    logger.error(
      {
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        err: err instanceof Error ? err.message : err,
      },
      '[humanReplyCanceller] falha ao processar',
    );
  }
}

export async function startHumanReplyCanceller(): Promise<void> {
  if (started) return;
  started = true;

  await redisSubscriber.subscribe(EVENT_CHANNELS.messageCreated);

  redisSubscriber.on('message', (channel: string, raw: string) => {
    if (channel !== EVENT_CHANNELS.messageCreated) return;
    handleRawMessage(raw);
  });

  logger.info(
    { channel: EVENT_CHANNELS.messageCreated },
    '[humanReplyCanceller] iniciado',
  );
}

export async function stopHumanReplyCanceller(): Promise<void> {
  if (!started) return;
  await redisSubscriber.unsubscribe(EVENT_CHANNELS.messageCreated);
  started = false;
}
