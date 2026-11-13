import { Worker, type Job } from 'bullmq';
import { redis } from '../../redis/redis.js';
import { logger } from '../../observability/logger.js';
import { processInboundJob } from './pipeline.js';
import { INBOUND_QUEUE_NAME, type InboundJobData } from './types.js';

let worker: Worker<InboundJobData> | null = null;

// Boota o Worker. Idempotente — segunda chamada é noop. Chamado pelo
// `server.ts` depois do listen() pra HTTP e worker subirem juntos.
//
// Concurrency 5: 5 jobs em paralelo por processo. Limita uso simultâneo
// do pool DB (cada job abre 1 transação via withTenant). Ajustar quando
// medirmos contenção real — por enquanto 5 é o default seguro.
export function startInboundWorker(): void {
  if (worker) return;
  worker = new Worker<InboundJobData>(
    INBOUND_QUEUE_NAME,
    async (job: Job<InboundJobData>) => {
      await processInboundJob(job.data);
    },
    {
      connection: redis,
      concurrency: 5,
    }
  );

  worker.on('completed', (job) => {
    logger.debug(
      { jobId: job.id, tenantId: job.data.tenantId, channelId: job.data.channelId },
      '[inboundWorker] job concluído'
    );
  });

  worker.on('failed', (job, err) => {
    logger.error(
      {
        jobId: job?.id,
        tenantId: job?.data.tenantId,
        channelId: job?.data.channelId,
        attempts: job?.attemptsMade,
        err: err.message,
        stack: err.stack,
      },
      '[inboundWorker] job falhou'
    );
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, '[inboundWorker] erro do worker');
  });

  logger.info('[inboundWorker] iniciado');
}

export async function stopInboundWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}
