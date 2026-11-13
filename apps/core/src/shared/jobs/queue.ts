import { Queue } from 'bullmq';
import { jobsRedis } from './connection.js';
import { SCHEDULER_QUEUE_NAME } from './registry.js';

// Queue compartilhada por todos os jobs agendados do core.
//
// Defaults:
//   attempts: 3              — jobs de manutenção podem absorver flakey de
//                              rede/DB. 3 tentativas com backoff exp 30s
//                              cobre janela curta de instabilidade. Jobs
//                              que querem retry específico podem override
//                              via opts no `upsertJobScheduler`.
//   backoff exp 30s          — 30s, 60s, 120s. Total ~3.5min no pior caso —
//                              razoável pra cron diário (próxima execução
//                              está a 24h, dá tempo de drenar).
//   removeOnComplete 100     — mantém histórico curto. Pra debug detalhado,
//                              consultar logs (todo handler loga summary).
//   removeOnFail 500         — mais retenção pra forensics de falha.
export const schedulerQueue = new Queue(SCHEDULER_QUEUE_NAME, {
  connection: jobsRedis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  },
});
