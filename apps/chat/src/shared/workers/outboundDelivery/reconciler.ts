import { tenants, withTenant } from '@elora/db';
import { db } from '../../database/db.js';
import { EVENT_CHANNELS, eventBus } from '../../eventBus/index.js';
import { logger } from '../../observability/logger.js';
import { MessagesQuery } from '../../../modules/messages/MessagesQuery.js';

// =====================================================================
// Reconciler de outbound stuck.
//
// Closer do loop quando o worker travou ou foi morto entre INSERT e UPDATE.
// Sem isso, a row ficaria `delivery_status='pending'` pra sempre e o staff
// veria spinner eterno na bolha.
//
// Roda a cada 5min via setInterval simples. Custo: 1 SELECT na tabela
// `tenants` (sem RLS) + 1 SELECT em messages por tenant (index parcial
// `messages_pending_stuck_idx` cobre, scan é barato mesmo em tenants
// grandes). Em produção V1 com dezenas de tenants, isso é ~50-100 queries
// rápidas a cada tick — tolerável. Se a tabela tenants crescer pra
// centenas/milhares, vale paralelizar ou criar policy de RLS pra role
// dedicada de reconciliação.
// =====================================================================

// Janela: mensagem pending há mais que isso é considerada travada. 5min cobre
// adapter Evolution lento (~30s no pior caso) + retries do BullMQ (3 tentativas
// com backoff exp 1s,2s,4s = ~7s) + margem larga pra absorver picos.
const STUCK_AFTER_MS = 5 * 60 * 1000;
const TICK_MS = 5 * 60 * 1000;

let timer: NodeJS.Timeout | null = null;

export function startOutboundReconciler(): void {
  if (timer) return;
  // Não roda imediato no boot — risco de processar mensagens que o worker
  // acabou de pegar mas ainda não atualizou. Primeiro tick em TICK_MS dá
  // tempo do worker normalizar.
  timer = setInterval(() => {
    void runTick().catch((err) => {
      logger.error(
        { err: err instanceof Error ? err.message : err },
        '[outboundReconciler] tick falhou',
      );
    });
  }, TICK_MS);
  logger.info('[outboundReconciler] iniciado');
}

export async function stopOutboundReconciler(): Promise<void> {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

async function runTick(): Promise<void> {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS);
  // `tenants` não tem RLS — lookup direto sem withTenant.
  const allTenants = await db.select({ id: tenants.id }).from(tenants);

  let totalReconciled = 0;
  for (const t of allTenants) {
    const stuck = await withTenant(db, t.id, (tx) =>
      MessagesQuery.findStuckPending(tx, cutoff),
    );
    if (stuck.length === 0) continue;

    logger.warn(
      { tenantId: t.id, count: stuck.length, cutoff: cutoff.toISOString() },
      '[outboundReconciler] mensagens pending stuck — marcando worker_timeout',
    );

    for (const row of stuck) {
      try {
        await withTenant(db, t.id, (tx) =>
          MessagesQuery.markDeliveryFailed(tx, row.id, 'failed', 'worker_timeout', {
            reconciledAt: new Date().toISOString(),
            stuckSinceMs: STUCK_AFTER_MS,
          }),
        );
        // channelId desconhecido aqui (precisaria de join extra). Relay no
        // core não usa pra rotear — sala socket é por conversation/tenant.
        await eventBus.publish(EVENT_CHANNELS.whatsappMessageStatusChanged, {
          tenantId: t.id,
          channelId: '',
          conversationId: row.conversationId,
          messageId: row.id,
          deliveryStatus: 'failed',
          failureReason: 'worker_timeout',
          updatedAt: new Date().toISOString(),
        });
        totalReconciled++;
      } catch (err) {
        logger.error(
          {
            tenantId: t.id,
            messageId: row.id,
            err: err instanceof Error ? err.message : err,
          },
          '[outboundReconciler] falha ao marcar row — pulando',
        );
      }
    }
  }

  if (totalReconciled > 0) {
    logger.info({ totalReconciled }, '[outboundReconciler] tick concluído');
  }
}
