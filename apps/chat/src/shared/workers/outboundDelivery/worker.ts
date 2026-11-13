import { DelayedError, Worker, type Job } from 'bullmq';
import { redis } from '../../redis/redis.js';
import { logger } from '../../observability/logger.js';
import { LockUnavailableError, processOutboundJob } from './pipeline.js';
import { OUTBOUND_QUEUE_NAME, type OutboundJobData } from './types.js';

let worker: Worker<OutboundJobData> | null = null;

// Quando o lock por conversation está ocupado (outra msg da mesma conv
// processando), re-tentamos daqui a 200ms. Curto porque o lock costuma
// durar 0.5–2s (chamada Evolution + UPDATE), e queremos preservar ordem
// FIFO dentro da conv com latência mínima.
const LOCK_RETRY_DELAY_MS = 200;

// Boota o Worker outbound. Idempotente — segunda chamada é noop. Chamado
// pelo `server.ts` depois do listen() pra HTTP + workers subirem juntos.
//
// Concurrency 5: igual ao inbound. Cada job é I/O-bound (rede Evolution +
// transação DB), 5 paralelos é margem segura pra pool DB sem contenção. Se
// observar fila acumulando, sobe pra 10 — mas medir antes.
export function startOutboundWorker(): void {
  if (worker) return;
  worker = new Worker<OutboundJobData>(
    OUTBOUND_QUEUE_NAME,
    async (job: Job<OutboundJobData>, token?: string) => {
      try {
        await processOutboundJob(job.data);
      } catch (err) {
        if (err instanceof LockUnavailableError) {
          // Lock segurado por outro job da mesma conv. Move pro delayed e
          // devolve o slot ao worker. `token` é necessário pro BullMQ aceitar
          // o move sem reclamar de ownership (introduzido em BullMQ 4.x).
          await job.moveToDelayed(Date.now() + LOCK_RETRY_DELAY_MS, token);
          // DelayedError é o sinal pro processor pular o complete/fail e
          // deixar o job na fila delayed sem incrementar attemptsMade.
          throw new DelayedError();
        }
        throw err;
      }
    },
    {
      connection: redis,
      concurrency: 5,
    },
  );

  worker.on('completed', (job) => {
    logger.debug(
      {
        jobId: job.id,
        tenantId: job.data.tenantId,
        conversationId: job.data.conversationId,
        messageId: job.data.messageId,
      },
      '[outboundWorker] job concluído',
    );
  });

  worker.on('failed', (job, err) => {
    // DelayedError não é "falha" — é o sinal de move pra delayed. Não logar
    // como erro pra não poluir métricas.
    if (err instanceof DelayedError) return;
    logger.error(
      {
        jobId: job?.id,
        tenantId: job?.data.tenantId,
        messageId: job?.data.messageId,
        attempts: job?.attemptsMade,
        err: err.message,
        stack: err.stack,
      },
      '[outboundWorker] job falhou',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, '[outboundWorker] erro do worker');
  });

  logger.info('[outboundWorker] iniciado');
}

export async function stopOutboundWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}
