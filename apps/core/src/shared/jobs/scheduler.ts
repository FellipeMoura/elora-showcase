import { logger } from '../observability/logger.js';
import { schedulerQueue } from './queue.js';
import {
  scheduledJobs,
  SCHEDULER_TIMEZONE,
  type ScheduledJobDef,
} from './registry.js';

// =====================================================================
// Bootstrap dos schedulers (cron) — chamado uma vez no boot do core.
//
// Para cada job no registry, faz upsert do `jobScheduler` no BullMQ
// (idempotente: re-deploy não duplica). Também faz cleanup de schedulers
// "fantasma" — IDs que estão no Redis mas não existem mais no registry
// (ex.: job foi removido/renomeado em deploy). Sem isso, jobs antigos
// continuariam disparando e o worker logaria warn em cada execução.
//
// Multi-instância: se o core rodar em mais de um processo, todos chamam
// `upsertJobScheduler` no boot. BullMQ deduplica pelo ID — ok. Só um
// worker pega cada disparo (lock distribuído nativo do BullMQ).
// =====================================================================

export async function bootstrapSchedulers(): Promise<void> {
  // Upsert de todos os schedulers do registry.
  for (const def of scheduledJobs) {
    await upsertScheduler(def);
  }

  // Cleanup de fantasmas — IDs no Redis sem contrapartida no registry.
  await cleanupOrphanSchedulers(new Set(scheduledJobs.map((j) => j.name)));

  logger.info(
    { count: scheduledJobs.length, tz: SCHEDULER_TIMEZONE },
    '[scheduler] bootstrap concluído',
  );
}

async function upsertScheduler(def: ScheduledJobDef): Promise<void> {
  await schedulerQueue.upsertJobScheduler(
    def.name,
    {
      pattern: def.cron,
      tz: SCHEDULER_TIMEZONE,
    },
    {
      name: def.name,
      // Payload vazio — toda info que o handler precisa vive no registry.
      // Mantém Redis enxuto e evita "config drift" entre o payload velho
      // de um scheduler antigo e a versão atual do código.
      data: {},
    },
  );
  logger.info(
    { jobName: def.name, cron: def.cron, description: def.description },
    '[scheduler] cron registrado',
  );
}

async function cleanupOrphanSchedulers(registeredNames: Set<string>): Promise<void> {
  // BullMQ paginate: getJobSchedulers(start, end). `-1` = sem upper bound.
  // O retorno tem `key` = scheduler ID (mesmo que foi passado pra
  // `upsertJobScheduler`).
  const existing = await schedulerQueue.getJobSchedulers(0, -1);
  for (const s of existing) {
    if (!s.key || registeredNames.has(s.key)) continue;
    await schedulerQueue.removeJobScheduler(s.key);
    logger.warn(
      { jobName: s.key },
      '[scheduler] cron orfão removido (não está no registry)',
    );
  }
}
