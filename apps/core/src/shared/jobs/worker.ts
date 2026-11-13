import { Worker, type Job } from 'bullmq';
import { jobsRedis } from './connection.js';
import { logger } from '../observability/logger.js';
import { SCHEDULER_QUEUE_NAME, scheduledJobs, type ScheduledJobDef } from './registry.js';

let worker: Worker | null = null;

// Lookup O(1) por job.name. Carregado uma vez no boot — registry é estático.
const jobsByName: Map<string, ScheduledJobDef> = new Map(
  scheduledJobs.map((j) => [j.name, j]),
);

// Concurrency 2: jobs do scheduler são cron diários/horários, raramente
// concorrem. 2 cobre o caso de um job lento atrasar enquanto outro vence.
// Subir só quando provado que está acumulando.
const SCHEDULER_CONCURRENCY = 2;

export function startSchedulerWorker(): void {
  if (worker) return;

  worker = new Worker(
    SCHEDULER_QUEUE_NAME,
    async (job: Job) => {
      const def = jobsByName.get(job.name);
      if (!def) {
        // Job velho que sumiu do registry (renomeado/removido). Logar e
        // marcar sucesso — fail aqui causaria retry eterno até `attempts`
        // estourar; sucesso deixa o scheduler do BullMQ consumir e seguir.
        // O scheduler "fantasma" continua disparando até alguém limpar via
        // `removeJobScheduler`. Boot já trata cleanup (ver scheduler.ts).
        logger.warn(
          { jobName: job.name, jobId: job.id },
          '[schedulerWorker] job sem handler no registry — ignorando',
        );
        return;
      }

      const startedAt = Date.now();
      logger.info(
        { jobName: def.name, jobId: job.id, description: def.description },
        '[schedulerWorker] job iniciado',
      );
      try {
        await def.run();
        logger.info(
          {
            jobName: def.name,
            jobId: job.id,
            durationMs: Date.now() - startedAt,
          },
          '[schedulerWorker] job concluído',
        );
      } catch (err) {
        logger.error(
          {
            jobName: def.name,
            jobId: job.id,
            durationMs: Date.now() - startedAt,
            err: err instanceof Error ? err.message : err,
            stack: err instanceof Error ? err.stack : undefined,
          },
          '[schedulerWorker] job falhou',
        );
        throw err;
      }
    },
    {
      connection: jobsRedis,
      concurrency: SCHEDULER_CONCURRENCY,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error(
      {
        jobName: job?.name,
        jobId: job?.id,
        attempts: job?.attemptsMade,
        err: err.message,
      },
      '[schedulerWorker] retry/fail final',
    );
  });

  worker.on('error', (err) => {
    logger.error({ err: err.message }, '[schedulerWorker] erro do worker');
  });

  logger.info('[schedulerWorker] iniciado');
}

export async function stopSchedulerWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
}
