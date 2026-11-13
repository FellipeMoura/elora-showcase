import { Queue } from 'bullmq';
import { redis } from '../../redis/redis.js';
import { logger } from '../../observability/logger.js';
import {
  AGENT_TRIGGER_QUEUE_NAME,
  agentTriggerJobId,
  type AgentTriggerJobData,
} from './types.js';

// Queue singleton. Defaults:
//   attempts: 2         — agente é tolerante a falha transiente; 2 cobre
//                          flakey rede/provider. Mais que isso, o cliente
//                          já recebeu silêncio prolongado — handoff vale
//                          mais que retentar (PR 5+ decide).
//   backoff exp 5s      — primeira tentativa em 5s. Espaço pra rede acalmar.
//   removeOnComplete 500 — histórico de últimos 500 triggers bem-sucedidos
//                          no dashboard BullMQ.
//   removeOnFail 2000   — falhas têm mais valor pra forensics; mantém maior.
export const agentTriggerQueue = new Queue<AgentTriggerJobData>(
  AGENT_TRIGGER_QUEUE_NAME,
  {
    connection: redis,
    defaultJobOptions: {
      attempts: 2,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 2000 },
    },
  },
);

// Enfileira (ou substitui) o trigger pra uma conversa. Remove o job
// existente antes pra forçar reset do timer — sem remove, BullMQ devolve o
// job atual sem mexer no delay/data.
//
// `delayMs` é o atraso até a próxima tentativa do worker; o caller decide
// (0 pra out_of_hours, idleMinutes*60_000 pra idle).
export async function scheduleAgentTrigger(
  data: AgentTriggerJobData,
  delayMs: number,
): Promise<void> {
  const jobId = agentTriggerJobId(data.conversationId);
  await agentTriggerQueue.remove(jobId).catch(() => undefined);
  await agentTriggerQueue.add('trigger', data, { jobId, delay: delayMs });
  logger.debug(
    {
      tenantId: data.tenantId,
      conversationId: data.conversationId,
      triggerType: data.triggerType,
      delayMs,
    },
    '[agentTriggerQueue] enfileirado',
  );
}

// Cancela trigger pendente — chamado pelo HumanReplyCanceller quando
// staff responde antes do agente disparar. Idempotente: remove falha se
// job não existir (já consumido ou nunca houve) e silenciamos o erro.
export async function cancelAgentTrigger(conversationId: string): Promise<boolean> {
  const jobId = agentTriggerJobId(conversationId);
  try {
    const removed = await agentTriggerQueue.remove(jobId);
    // `remove()` retorna 1 quando removeu, 0 quando job não existia.
    return removed === 1;
  } catch {
    return false;
  }
}
