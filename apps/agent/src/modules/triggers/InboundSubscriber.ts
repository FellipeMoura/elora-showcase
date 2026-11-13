import {
  EVENT_CHANNELS,
  type WhatsappMessageReceivedEvent,
} from '@elora/events-contracts';
import { redisSubscriber } from '../../shared/redis/redis.js';
import { logger } from '../../shared/observability/logger.js';
import { idleTriggerScheduler } from './IdleTriggerScheduler.js';

// =====================================================================
// InboundSubscriber — assina `wa.message.received` no Redis pub/sub e
// delega ao IdleTriggerScheduler. Mantém scope mínimo: parsing do payload
// + log de cada decisão. Toda a lógica de agendamento mora no scheduler.
//
// Por que NÃO escutar `wa.message.sent` (outbound capturado do celular):
//   - É staff respondendo PELO ZAP — mesmo efeito de "humano assumiu".
//   - Mas isso já está coberto pelo `HumanReplyCanceller` (assina
//     message.created, que é publicado pra QUALQUER outbound, incluindo
//     o capturado do celular: o `recordOutbound` dispara o evento).
// =====================================================================

let started = false;

function handleRawMessage(raw: string): void {
  let payload: WhatsappMessageReceivedEvent;
  try {
    payload = JSON.parse(raw) as WhatsappMessageReceivedEvent;
  } catch (err) {
    logger.error(
      {
        err: err instanceof Error ? err.message : err,
        raw: raw.slice(0, 200),
      },
      '[inboundSubscriber] payload mal-formado',
    );
    return;
  }

  void handlePayload(payload);
}

async function handlePayload(p: WhatsappMessageReceivedEvent): Promise<void> {
  try {
    const result = await idleTriggerScheduler.handleInbound({
      tenantId: p.tenantId,
      channelId: p.channelId,
      conversationId: p.conversationId,
      messageId: p.messageId,
      clientId: p.clientId,
      receivedAt: new Date(p.receivedAt),
    });

    if (result.decision === 'skipped') {
      logger.debug(
        {
          tenantId: p.tenantId,
          conversationId: p.conversationId,
          reason: result.reason,
        },
        '[inboundSubscriber] inbound ignorado',
      );
    }
  } catch (err) {
    logger.error(
      {
        tenantId: p.tenantId,
        conversationId: p.conversationId,
        err: err instanceof Error ? err.message : err,
      },
      '[inboundSubscriber] falha ao processar inbound',
    );
  }
}

export async function startInboundSubscriber(): Promise<void> {
  if (started) return;
  started = true;

  // O cliente subscriber é compartilhado entre módulos do agent — anexamos
  // um listener `message` no boot. Caso outro módulo (ex.: HumanReplyCanceller)
  // também subscreva, todos os handlers recebem todas as mensagens; cada
  // um filtra pelo nome do canal.
  await redisSubscriber.subscribe(EVENT_CHANNELS.whatsappMessageReceived);

  redisSubscriber.on('message', (channel: string, raw: string) => {
    if (channel !== EVENT_CHANNELS.whatsappMessageReceived) return;
    handleRawMessage(raw);
  });

  logger.info(
    { channel: EVENT_CHANNELS.whatsappMessageReceived },
    '[inboundSubscriber] iniciado',
  );
}

export async function stopInboundSubscriber(): Promise<void> {
  if (!started) return;
  await redisSubscriber.unsubscribe(EVENT_CHANNELS.whatsappMessageReceived);
  started = false;
}
