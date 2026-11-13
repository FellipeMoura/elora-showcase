// =====================================================================
// Scheduler de jobs do core.
//
// API pública:
//   - `startJobs()`  → boota o Worker e registra os crons do registry.
//   - `stopJobs()`   → encerra Worker e desconecta Redis (graceful shutdown).
//
// Para adicionar um novo job, ver comentário em `registry.ts`.
// =====================================================================

import { logger } from '../observability/logger.js';
import { jobsRedis } from './connection.js';
import { schedulerQueue } from './queue.js';
import { bootstrapSchedulers } from './scheduler.js';
import { startSchedulerWorker, stopSchedulerWorker } from './worker.js';

export async function startJobs(): Promise<void> {
  startSchedulerWorker();
  try {
    await bootstrapSchedulers();
  } catch (err) {
    // Falha no bootstrap NÃO derruba o app — o worker já está vivo, então
    // se algum cron foi gravado em deploy anterior ele segue disparando.
    // Log de error é o suficiente pra Sentry pegar.
    logger.error(
      { err: err instanceof Error ? err.message : err },
      '[jobs] bootstrap de schedulers falhou — worker segue ativo',
    );
  }
}

export async function stopJobs(): Promise<void> {
  // Ordem: worker primeiro (drena jobs em vôo), depois queue + redis.
  await stopSchedulerWorker();
  await schedulerQueue.close();
  jobsRedis.disconnect();
}
