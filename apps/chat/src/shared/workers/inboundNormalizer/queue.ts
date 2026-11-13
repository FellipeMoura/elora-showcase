import { Queue } from 'bullmq';
import { redis } from '../../redis/redis.js';
import { INBOUND_QUEUE_NAME, type InboundJobData } from './types.js';

// Queue compartilhada (módulo singleton). Conecta ao mesmo Redis do app.
// `removeOnComplete` mantém só os últimos 1000 jobs OK em memória — dashboard
// continua útil pra debug recente sem inchar Redis.
export const inboundQueue = new Queue<InboundJobData>(INBOUND_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { count: 1000 },
    removeOnFail: { count: 5000 },
  },
});

// Enfileira um evento de webhook. Chamado pelo handler HTTP — retorna
// rápido pro caller (provider) respondendo 200 enquanto processamento
// fica async.
export async function enqueueInbound(data: InboundJobData): Promise<void> {
  await inboundQueue.add('inbound', data);
}
