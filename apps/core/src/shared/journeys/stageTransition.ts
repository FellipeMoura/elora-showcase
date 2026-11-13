import {
  and,
  clientForms,
  eq,
  formTemplates,
  inArray,
  journeyEvents,
  journeys,
  quotes,
  sql,
  tenants,
  treatments,
} from '@elora/db';
import type { InferSelectModel, Tx } from '@elora/db';
import { AppError } from '../errors/AppError.js';
import { logger } from '../observability/logger.js';
import type { JourneyEventType } from './eventTypes.js';

// =====================================================================
// Helper canônico de transição de stage (chat-domain.md §16).
//
// TODA mudança em `journeys.stage` passa por aqui. Services nunca tocam
// `journeys.stage` direto — só via `applyStageTransition`. Garante:
//   - pares (from, to) válidos
//   - guard rails N3 aplicados
//   - `journey_event: stage_transitioned` gravado
//   - `last_activity_at` atualizado
//
// Convenções:
//   - Recebe `tx` (transação aberta pelo caller via `withTenant`). Não abre
//     transação própria — caller controla escopo. RLS já está ativa.
//   - Throw `AppError` com 404/409 em falhas semânticas (caller deixa
//     propagar pra middleware de erro).
//
// Mudanças de status (won/lost) ficam em `markJourneyWon`/`markJourneyLost`
// — são "off-funnel", lógica diferente.
// =====================================================================

export type JourneyStage = 'lead' | 'evaluation' | 'sale' | 'treatment' | 'result';

// Contexto opcional que o caller passa pra que o helper valide guard rails
// específicos da transição. Cada campo é usado em (no máximo) um par de
// transição — ver §16.1.
export interface StageTransitionContext {
  // Quote que disparou a transição (lead→sale/evaluation→sale).
  // Helper checa `status ≠ draft`.
  quoteId?: string;
  // Quando true, o caller assume que já criou treatment + sessions
  // (sale→treatment via 1ª presença). Helper apenas checa que existe
  // quote accepted + sessions ligadas — não cria nada.
  triggerSource?: 'first_presence' | 'last_session_done';
}

interface ApplyOptions {
  to: JourneyStage;
  reason: JourneyEventType;
  context?: StageTransitionContext;
  actorUserId?: string | null;
}

type Journey = InferSelectModel<typeof journeys>;

const VALID_PAIRS: Array<[JourneyStage, JourneyStage]> = [
  ['lead', 'evaluation'],
  ['lead', 'sale'],         // pula avaliação; alerta no log se tenants.skip_evaluation=false
  ['evaluation', 'sale'],
  ['sale', 'treatment'],
  ['treatment', 'result'],
  // Reabertura excepcional pós-result (chat-domain.md §11.6) — quando staff
  // reabre treatment, journey volta de result pra treatment automaticamente.
  ['result', 'treatment'],
];

function isValidPair(from: JourneyStage, to: JourneyStage): boolean {
  return VALID_PAIRS.some(([f, t]) => f === from && t === to);
}

export async function applyStageTransition(
  tx: Tx,
  journeyId: string,
  options: ApplyOptions
): Promise<Journey> {
  const [journey] = await tx
    .select()
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .limit(1);

  if (!journey) throw new AppError('Jornada não encontrada', 404);
  if (journey.closedAt) {
    throw new AppError(
      `Jornada já encerrada (status=${journey.status}) — não aceita transições`,
      409
    );
  }

  const from = journey.stage as JourneyStage;
  const { to, reason, context, actorUserId } = options;

  if (from === to) {
    throw new AppError(`Jornada já está em stage=${to}`, 409);
  }
  if (!isValidPair(from, to)) {
    throw new AppError(`Transição inválida: ${from} → ${to}`, 409);
  }

  // Guard rails N3 por par. Cada bloco valida pré-condições E pode buscar
  // dados adicionais da tx — RLS já filtra pelo tenant atual.
  await runGuardRails(tx, journey, from, to, context);

  // Reset lead_substage ao sair de 'lead' (substage só faz sentido em lead).
  // Ao reentrar em lead (caso teórico — pares VALID_PAIRS não contemplam isso
  // hoje), seria recomputado pela próxima cascata. Reset incondicional aqui é
  // defensivo: pares válidos atuais ou são saída de lead, ou nada-pra-fazer.
  const shouldClearLeadSubstage = from === 'lead';

  const [updated] = await tx
    .update(journeys)
    .set({
      stage: to,
      lastActivityAt: new Date(),
      ...(shouldClearLeadSubstage ? { leadSubstage: null } : {}),
    })
    .where(eq(journeys.id, journeyId))
    .returning();

  if (!updated) throw new AppError('Falha ao atualizar jornada', 500);

  await tx.insert(journeyEvents).values({
    tenantId: journey.tenantId,
    journeyId: journey.id,
    eventType: 'stage_transitioned',
    payload: { from, to, reason } as Record<string, unknown>,
    actorUserId: actorUserId ?? null,
  });

  return updated;
}

async function runGuardRails(
  tx: Tx,
  journey: Journey,
  from: JourneyStage,
  to: JourneyStage,
  context: StageTransitionContext | undefined
): Promise<void> {
  // lead → evaluation: só checa que journey está em lead (já checado em
  // VALID_PAIRS + from===journey.stage acima). Sem guard adicional.
  if (from === 'lead' && to === 'evaluation') return;

  // lead → sale (skip): permitido em qualquer tenant, mas se
  // `tenants.skip_evaluation=false` emite alerta no log — sinaliza que a
  // jornada pulou avaliação contra a configuração padrão do tenant. Guard
  // duro continua: quote anexada com status≠draft.
  if (from === 'lead' && to === 'sale') {
    const [tenant] = await tx
      .select({ skipEvaluation: tenants.skipEvaluation })
      .from(tenants)
      .where(eq(tenants.id, journey.tenantId))
      .limit(1);
    if (!tenant?.skipEvaluation) {
      logger.warn(
        {
          tenantId: journey.tenantId,
          journeyId: journey.id,
          quoteId: context?.quoteId,
        },
        'Transição lead → sale em tenant com skip_evaluation=false (permitida com alerta)'
      );
    }
    await assertAcceptedQuoteForJourney(tx, journey.id, context?.quoteId);
    return;
  }

  // evaluation → sale: (a) quote.status≠draft anexado; (b) se tenant tem ≥1
  // form_template required_for_evaluation, precisa de client_form completed
  // desse template pra esse cliente.
  if (from === 'evaluation' && to === 'sale') {
    await assertAcceptedQuoteForJourney(tx, journey.id, context?.quoteId);
    await assertRequiredFormCompletedIfNeeded(tx, journey);
    return;
  }

  // sale → treatment: existência de quote accepted + procedure_sessions na journey.
  // Disparo natural é "1ª presença assinalada" — caller já criou treatment.
  if (from === 'sale' && to === 'treatment') {
    const [acceptedCount] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(quotes)
      .where(and(eq(quotes.journeyId, journey.id), eq(quotes.status, 'accepted')));
    if (!acceptedCount || acceptedCount.count === 0) {
      throw new AppError(
        'Transição sale → treatment requer ao menos um quote aceito na jornada',
        409
      );
    }

    // Confere que há ≥1 treatment ativo na journey (caller criou agora).
    const [treatmentCount] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(treatments)
      .where(and(eq(treatments.journeyId, journey.id), eq(treatments.status, 'active')));
    if (!treatmentCount || treatmentCount.count === 0) {
      throw new AppError(
        'Transição sale → treatment requer treatment ativo na jornada (criar antes via 1ª presença)',
        409
      );
    }
    return;
  }

  // treatment → result: todos os treatments da journey fora de active.
  if (from === 'treatment' && to === 'result') {
    const [activeCount] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(treatments)
      .where(and(eq(treatments.journeyId, journey.id), eq(treatments.status, 'active')));
    if (activeCount && activeCount.count > 0) {
      throw new AppError(
        'Transição treatment → result requer todos os treatments fora de active',
        409
      );
    }
    return;
  }

  // result → treatment: trigger é "treatment reaberto" — caller já fez UPDATE
  // em treatment.status: completed→active. Helper confere que existe ≥1 active.
  if (from === 'result' && to === 'treatment') {
    const [activeCount] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(treatments)
      .where(and(eq(treatments.journeyId, journey.id), eq(treatments.status, 'active')));
    if (!activeCount || activeCount.count === 0) {
      throw new AppError(
        'Reabrir result → treatment requer treatment ativo (reabrir antes via UPDATE)',
        409
      );
    }
    return;
  }
}

async function assertAcceptedQuoteForJourney(
  tx: Tx,
  journeyId: string,
  quoteId: string | undefined
): Promise<void> {
  // Semântica atualizada (chat-domain.md §5.3 ext.): stage `sale` representa
  // VENDA FECHADA — exige quote em status='accepted'. Antes (até 2026-05)
  // bastava status != draft (envio); essa interpretação foi descartada por
  // não refletir o ciclo comercial real.
  if (quoteId) {
    const [quote] = await tx
      .select({ status: quotes.status, journeyId: quotes.journeyId })
      .from(quotes)
      .where(eq(quotes.id, quoteId))
      .limit(1);
    if (!quote) throw new AppError('Orçamento não encontrado', 404);
    if (quote.journeyId !== journeyId) {
      throw new AppError('Orçamento não pertence a esta jornada', 409);
    }
    if (quote.status !== 'accepted') {
      throw new AppError(
        `Transição pra sale requer quote.status='accepted' (atual=${quote.status})`,
        409
      );
    }
    return;
  }

  const [row] = await tx
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(quotes)
    .where(and(eq(quotes.journeyId, journeyId), eq(quotes.status, 'accepted')));
  if (!row || row.count === 0) {
    throw new AppError(
      'Transição pra sale requer ao menos um orçamento aceito',
      409
    );
  }
}

async function assertRequiredFormCompletedIfNeeded(
  tx: Tx,
  journey: Journey
): Promise<void> {
  // Existe template marcado required_for_evaluation? Se não, regra é vácua.
  const requiredTemplates = await tx
    .select({ id: formTemplates.id })
    .from(formTemplates)
    .where(
      and(
        eq(formTemplates.requiredForEvaluation, true),
        eq(formTemplates.active, true)
      )
    );
  if (requiredTemplates.length === 0) return;

  // Precisa de ≥1 client_form completed cujo template seja required.
  const requiredIds = requiredTemplates.map((t) => t.id);
  const [completedCount] = await tx
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(clientForms)
    .where(
      and(
        eq(clientForms.clientId, journey.clientId),
        eq(clientForms.status, 'completed'),
        inArray(clientForms.formTemplateId, requiredIds)
      )
    );
  if (!completedCount || completedCount.count === 0) {
    throw new AppError(
      'Ficha de avaliação obrigatória ainda não preenchida — não é possível mover pra sale',
      409
    );
  }
}

// =====================================================================
// Marcações de status (off-funnel) — won / lost
// =====================================================================

export async function markJourneyWon(
  tx: Tx,
  journeyId: string,
  actorUserId?: string | null
): Promise<Journey> {
  const [journey] = await tx
    .select()
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .limit(1);

  if (!journey) throw new AppError('Jornada não encontrada', 404);
  if (journey.status === 'won') throw new AppError('Jornada já está marcada como ganha', 409);
  if (journey.status === 'lost') throw new AppError('Jornada está como perdida — não reabre pra won', 409);
  if (journey.stage !== 'result') {
    throw new AppError(
      `Só é possível marcar como ganha em stage=result (atual=${journey.stage})`,
      409
    );
  }

  const now = new Date();
  const [updated] = await tx
    .update(journeys)
    .set({ status: 'won', closedAt: now, lastActivityAt: now })
    .where(eq(journeys.id, journeyId))
    .returning();

  if (!updated) throw new AppError('Falha ao atualizar jornada', 500);

  await tx.insert(journeyEvents).values({
    tenantId: journey.tenantId,
    journeyId: journey.id,
    eventType: 'marked_won',
    actorUserId: actorUserId ?? null,
  });

  return updated;
}

const ALLOWED_LOST_REASONS = [
  'no_show',
  'price',
  'disqualified',
  'timeout',
  // Fechamentos auto-disparados a partir de quotes (chat-domain.md §5.3 ext.):
  //   - quote_rejected: todas as quotes da journey foram rejeitadas
  //     explicitamente — cliente disse não pra cada uma.
  //   - quote_expired: quote(s) passaram da validity e não foram aceitas;
  //     auto-disparado por automação de expire.
  // Manter `price` ainda disponível pra recepcionista marcar manualmente —
  // distinção semântica importa pra métrica:
  //   "price" = cliente sinalizou que preço foi o motivo
  //   "quote_rejected" = orçamento(s) recusado(s) sem motivo conhecido
  'quote_rejected',
  'quote_expired',
  'other',
] as const;

export type LostReason = (typeof ALLOWED_LOST_REASONS)[number];

export function isValidLostReason(value: string): value is LostReason {
  return (ALLOWED_LOST_REASONS as readonly string[]).includes(value);
}

export async function markJourneyLost(
  tx: Tx,
  journeyId: string,
  reason: LostReason,
  actorUserId?: string | null
): Promise<Journey> {
  const [journey] = await tx
    .select()
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .limit(1);

  if (!journey) throw new AppError('Jornada não encontrada', 404);
  if (journey.status === 'lost') throw new AppError('Jornada já está marcada como perdida', 409);
  if (journey.status === 'won') throw new AppError('Jornada ganha — não pode virar perdida', 409);

  const now = new Date();
  const [updated] = await tx
    .update(journeys)
    .set({ status: 'lost', lostReason: reason, closedAt: now, lastActivityAt: now })
    .where(eq(journeys.id, journeyId))
    .returning();

  if (!updated) throw new AppError('Falha ao atualizar jornada', 500);

  await tx.insert(journeyEvents).values({
    tenantId: journey.tenantId,
    journeyId: journey.id,
    eventType: 'marked_lost',
    payload: { reason } as Record<string, unknown>,
    actorUserId: actorUserId ?? null,
  });

  return updated;
}

export { ALLOWED_LOST_REASONS };

// Helper de reabertura compartilhado por core (endpoint manual futuro) e chat
// (gateway de criação por inbound). Mora em @elora/db pra evitar duplicação.
export {
  REOPEN_WINDOW_DAYS,
  tryReopenJourneyForClient,
  type ReopenResult,
} from '@elora/db';
