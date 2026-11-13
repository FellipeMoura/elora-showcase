// =====================================================================
// Registro de jobs agendados do core.
//
// Cada job vive em `jobs/<nome>.ts` e exporta um `ScheduledJobDef`. Pra
// adicionar um novo job:
//   1. Criar `jobs/meuJob.ts` exportando `ScheduledJobDef`.
//   2. Importar e adicionar ao array `scheduledJobs` abaixo.
//   3. Pronto — `startScheduler` registra o cron e o worker dispatcha.
//
// Convenções:
//   - `name` é único (vira jobId e scheduler key no BullMQ). Não mudar
//     sem migration manual (job velho fica "orfão" no Redis).
//   - `cron` segue sintaxe BullMQ (mesma do node-cron, 5 ou 6 campos).
//     Default TZ = `America/Sao_Paulo` (env do app é BR).
//   - `run` é livre de transação — abre seu próprio `withTenant` quando
//     precisa de RLS. Tudo que joga exception é logado pelo worker e
//     entra em retry (até `attempts` do queue default).
// =====================================================================

import { expireQuotesJob } from './jobs/expireQuotes.js';

export interface ScheduledJobDef {
  // ID único do scheduler. Vira o nome do job e a key Redis. Não conter `:`.
  name: string;
  // Cron pattern (5 ou 6 campos). Avaliado em America/Sao_Paulo.
  cron: string;
  // Descrição PT-BR pro log de bootstrap.
  description: string;
  // Handler. Throw = retry conforme defaults do queue.
  run: () => Promise<void>;
}

// Registro: ordem é só estética (log de boot itera nessa ordem).
export const scheduledJobs: readonly ScheduledJobDef[] = [
  expireQuotesJob,
] as const;

export const SCHEDULER_QUEUE_NAME = 'core-scheduler';
export const SCHEDULER_TIMEZONE = 'America/Sao_Paulo';
