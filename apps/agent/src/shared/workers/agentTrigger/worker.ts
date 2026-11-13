import { Worker, type Job } from 'bullmq';
import { env } from '../../../env.js';
import { redis } from '../../redis/redis.js';
import { logger } from '../../observability/logger.js';
import { AgentRunner } from '../../../modules/conversations/index.js';
import { AGENT_TRIGGER_QUEUE_NAME, type AgentTriggerJobData } from './types.js';

let worker: Worker<AgentTriggerJobData> | null = null;

// Boot do worker. Idempotente — segunda chamada é noop.
//
// Concurrency 3: muito conservador. Cada turno do agente vai disparar
// múltiplas tool calls e LLM calls — uma rodada pode levar 5-15s. 3
// paralelos cobre bem dezenas de tenants com baixo pico simultâneo. Sobe
// quando virar gargalo medido.
export function startAgentTriggerWorker(): void {
  if (worker) return;

  // Gate global — checado a cada job pra reagir a kill switch sem
  // restart, mas note que processos em vôo continuam até retorno.
  worker = new Worker<AgentTriggerJobData>(
    AGENT_TRIGGER_QUEUE_NAME,
    async (job: Job<AgentTriggerJobData>) => {
      const drift = Date.now() - new Date(job.data.enqueuedAt).getTime();

      if (env.agent.globalKillSwitch) {
        logger.info(
          {
            jobId: job.id,
            tenantId: job.data.tenantId,
            conversationId: job.data.conversationId,
            triggerType: job.data.triggerType,
            driftMs: drift,
          },
          '[agentTriggerWorker] kill switch global ativo — job processado sem ação',
        );
        return;
      }

      logger.debug(
        {
          jobId: job.id,
          tenantId: job.data.tenantId,
          conversationId: job.data.conversationId,
          triggerType: job.data.triggerType,
          driftMs: drift,
        },
        '[agentTriggerWorker] disparando AgentRunner',
      );

      await AgentRunner.run({
        tenantId: job.data.tenantId,
        conversationId: job.data.conversationId,
        clientId: job.data.clientId,
        inputMessageId: job.data.inputMessageId,
        triggerType: job.data.triggerType,
        triggerMetadata: job.data.triggerMetadata,
      });
    },
    {
      connection: redis,
      concurrency: 3,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(
      {
        jobId: job?.id,
        tenantId: job?.data.tenantId,
        conversationId: job?.data.conversationId,
        attempts: job?.attemptsMade,
        err: err.message,
      },
      '[agentTriggerWorker] job falhou',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, '[agentTriggerWorker] erro do worker');
  });

  logger.info('[agentTriggerWorker] iniciado');
}

export async function stopAgentTriggerWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}
