import { Queue } from 'bullmq';
import { redis } from '../../redis/redis.js';
import { OUTBOUND_QUEUE_NAME, type OutboundJobData } from './types.js';

// Queue compartilhada (módulo singleton). Defaults:
//   attempts: 3  — retry curto. Pre-flight não é "transiente" (motivo errado
//                  não vira certo retentando), então 3 tentativas com backoff
//                  cobrem só falhas reais de adapter/rede. Pre-flight bloqueia
//                  imediatamente com UPDATE rejected — sem retry.
//   backoff exp 1s — primeiro retry em 1s, 2s, 4s. Total ~7s no pior caso.
//   removeOnComplete 1000 — dashboard útil sem inchar Redis.
export const outboundQueue = new Queue<OutboundJobData>(OUTBOUND_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

// Enfileira envio. Chamado pelo controller depois de inserir a row pending —
// retorna imediatamente pro HTTP response. O ID do job é `outbound-<messageId>`
// pra evitar duplicação acidental (mesma row enfileirada 2x vira no-op).
// `:` é proibido pelo BullMQ em custom job IDs (separador interno de keys
// Redis), por isso o `-`.
export async function enqueueOutboundDelivery(data: OutboundJobData): Promise<void> {
  await outboundQueue.add('outbound', data, { jobId: `outbound-${data.messageId}` });
}

// Re-enfileira após retry manual. O jobId é o mesmo da primeira tentativa, e
// `removeOnComplete: 1000` mantém o job terminal anterior em Redis — `add()`
// com jobId existente vira no-op silencioso. Remover primeiro libera o slot.
// `remove()` falha se o job não existe (já foi expulso pela política de
// retenção); ignoramos o erro porque add() vai funcionar dos dois jeitos.
export async function retryOutboundDelivery(data: OutboundJobData): Promise<void> {
  const jobId = `outbound-${data.messageId}`;
  await outboundQueue.remove(jobId).catch(() => undefined);
  await outboundQueue.add('outbound', data, { jobId });
}
