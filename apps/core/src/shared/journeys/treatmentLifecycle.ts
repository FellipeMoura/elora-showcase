import {
  and,
  appointments,
  eq,
  journeys,
  procedureSessions,
  sql,
  treatmentProcedures,
  treatments,
  type Tx,
} from '@elora/db';
import { AppError } from '../errors/AppError.js';
import { recordJourneyEvent, touchJourneyActivity } from './eventLogger.js';
import type { JourneyEventType } from './eventTypes.js';
import { applyStageTransition, type JourneyStage } from './stageTransition.js';

// =====================================================================
// Helpers cross-módulo do ciclo do treatment (chat-domain.md §6, §16.4).
//
// Reúne lógica de 1ª presença → cria treatment + vincula sessions, e
// auto-conclusão quando última session é done. Vive em shared/ porque é
// consumido por procedureAppointments, procedureSessions e treatments.
//
// Convenções:
//   - Recebem `tx` já transacional. RLS aplicada pelo caller.
//   - Caller passa `actorUserId` quando relevante (audit em events).
// =====================================================================

interface EnsureTreatmentInput {
  tenantId: string;
  journeyId: string;
  clientId: string;
  defaultName?: string;
}

export interface EnsureTreatmentResult {
  treatmentId: string;
  created: boolean;
  linkedSessionCount: number;
}

// Procura treatment ativo na journey. Se não houver, cria um e vincula
// todas as procedure_sessions pendentes do cliente que ainda não estão
// em treatment_procedures (chat-domain.md §16.4 passo 3). Disparado pela
// 1ª presença assinalada (procedureAppointments.markDone).
export async function ensureTreatmentForJourney(
  tx: Tx,
  input: EnsureTreatmentInput,
  actorUserId: string | null
): Promise<EnsureTreatmentResult> {
  const [existing] = await tx
    .select({ id: treatments.id })
    .from(treatments)
    .where(
      and(
        eq(treatments.journeyId, input.journeyId),
        eq(treatments.status, 'active')
      )
    )
    .limit(1);
  if (existing) {
    return { treatmentId: existing.id, created: false, linkedSessionCount: 0 };
  }

  const now = new Date();
  const [created] = await tx
    .insert(treatments)
    .values({
      tenantId: input.tenantId,
      journeyId: input.journeyId,
      clientId: input.clientId,
      name: input.defaultName?.trim() || 'Tratamento',
      status: 'active',
      startedAt: now,
    })
    .returning({ id: treatments.id });
  if (!created) throw new AppError('Falha ao criar treatment', 500);

  // Vincula sessions pendentes não-linkadas do cliente. Critério evita
  // re-linkar sessions de treatments anteriores (NOT EXISTS na join).
  const unlinked = await tx
    .select({ id: procedureSessions.id })
    .from(procedureSessions)
    .where(
      and(
        eq(procedureSessions.clientId, input.clientId),
        eq(procedureSessions.status, 'pending'),
        sql`NOT EXISTS (
          SELECT 1 FROM ${treatmentProcedures}
          WHERE ${treatmentProcedures.procedureSessionId} = ${procedureSessions.id}
        )`
      )
    );

  if (unlinked.length > 0) {
    await tx.insert(treatmentProcedures).values(
      unlinked.map((s) => ({
        treatmentId: created.id,
        procedureSessionId: s.id,
        tenantId: input.tenantId,
      }))
    );
  }

  await recordJourneyEvent(tx, {
    tenantId: input.tenantId,
    journeyId: input.journeyId,
    eventType: 'treatment_started',
    payload: {
      treatmentId: created.id,
      linkedSessionCount: unlinked.length,
    },
    actorUserId,
  });

  // Stage transition condicional sale → treatment. Idempotente — se já está
  // em treatment (raro, criação dupla?), não tentamos.
  await transitionStageIfDifferent(tx, input.journeyId, 'treatment', 'treatment_started', actorUserId);

  return {
    treatmentId: created.id,
    created: true,
    linkedSessionCount: unlinked.length,
  };
}

// Adiciona o par (treatment, session) em treatment_procedures sem duplicar.
export async function linkSessionToTreatment(
  tx: Tx,
  tenantId: string,
  treatmentId: string,
  sessionId: string
): Promise<void> {
  await tx
    .insert(treatmentProcedures)
    .values({
      tenantId,
      treatmentId,
      procedureSessionId: sessionId,
    })
    .onConflictDoNothing({
      target: [treatmentProcedures.treatmentId, treatmentProcedures.procedureSessionId],
    });
}

// Marca session como `signed` (presença atestada). Status `done` agora é
// reservado pra conclusão de evolução clínica — pré-fase seguinte do MVP.
// `executedAt`/`executedByUserId` ficam preenchidos pra rastreabilidade
// mínima (quem registrou a presença, quando).
export async function markSessionSigned(
  tx: Tx,
  sessionId: string,
  executorUserId: string | null,
  executedAt?: Date
): Promise<void> {
  await tx
    .update(procedureSessions)
    .set({
      status: 'signed',
      executedAt: executedAt ?? new Date(),
      executedByUserId: executorUserId,
    })
    .where(eq(procedureSessions.id, sessionId));
}

// Override manual pra fluxos administrativos / legacy. Sessão vai direto
// pra `done` sem passar por `signed` — usado pelo procedureSessions
// `/done` endpoint (admin/manager) e por scripts de migração. NÃO chamar
// no fluxo padrão; o caminho normal é signed (presença) → done (evolução).
export async function markSessionDone(
  tx: Tx,
  sessionId: string,
  executorUserId: string | null,
  executedAt?: Date
): Promise<void> {
  await tx
    .update(procedureSessions)
    .set({
      status: 'done',
      executedAt: executedAt ?? new Date(),
      executedByUserId: executorUserId,
    })
    .where(eq(procedureSessions.id, sessionId));
}

// Após uma session virar done, verifica se TODAS as sessions do treatment
// estão fora de pending+signed → marca treatment como completed automaticamente.
// "Concluída" = status in (done, cancelled). `pending`/`signed` ainda contam
// como em andamento (assinatura registra presença mas exige evolução clínica
// pra fechar). Cancelled não bloqueia auto-complete — decisão consciente
// ("não vai acontecer" ≠ "ainda esperando").
export async function checkAndAutoCompleteTreatment(
  tx: Tx,
  treatmentId: string,
  actorUserId: string | null
): Promise<{ completed: boolean }> {
  const [row] = await tx
    .select({
      unfinishedCount: sql<number>`
        COUNT(CASE WHEN ${procedureSessions.status} IN ('pending', 'signed') THEN 1 END)::int
      `.as('unfinished_count'),
      total: sql<number>`COUNT(*)::int`.as('total'),
    })
    .from(treatmentProcedures)
    .innerJoin(
      procedureSessions,
      eq(treatmentProcedures.procedureSessionId, procedureSessions.id)
    )
    .where(eq(treatmentProcedures.treatmentId, treatmentId));

  if (!row || row.total === 0) return { completed: false };
  if (row.unfinishedCount > 0) return { completed: false };

  const now = new Date();
  const [treatment] = await tx
    .update(treatments)
    .set({ status: 'completed', completedAt: now })
    .where(
      and(eq(treatments.id, treatmentId), eq(treatments.status, 'active'))
    )
    .returning({
      id: treatments.id,
      journeyId: treatments.journeyId,
      tenantId: treatments.tenantId,
    });
  if (!treatment) return { completed: false };

  await recordJourneyEvent(tx, {
    tenantId: treatment.tenantId,
    journeyId: treatment.journeyId,
    eventType: 'treatment_completed',
    payload: { treatmentId: treatment.id },
    actorUserId,
  });
  await touchJourneyActivity(tx, treatment.journeyId);

  await checkAndTransitionJourneyToResult(tx, treatment.journeyId, 'treatment_completed', actorUserId);

  return { completed: true };
}

// Verifica se todos os treatments da journey estão fora de `active`.
// Se sim e journey está em stage=treatment, transiciona pra result.
// Idempotente — se journey já está em result ou não há treatments, no-op.
export async function checkAndTransitionJourneyToResult(
  tx: Tx,
  journeyId: string,
  triggerReason: JourneyEventType,
  actorUserId: string | null
): Promise<void> {
  const [active] = await tx
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(treatments)
    .where(
      and(eq(treatments.journeyId, journeyId), eq(treatments.status, 'active'))
    );
  if (active && active.count > 0) return;

  const [any] = await tx
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(treatments)
    .where(eq(treatments.journeyId, journeyId));
  if (!any || any.count === 0) return;

  await transitionStageIfDifferent(tx, journeyId, 'result', triggerReason, actorUserId);
}

// Reabre treatment completed/manually_closed → active. Se journey está em
// result, volta automaticamente pra treatment. Abandonado NÃO reabre por
// este caminho (semântica: "abandoned" = decisão final do worker).
export async function reopenTreatment(
  tx: Tx,
  treatmentId: string,
  actorUserId: string | null
): Promise<void> {
  const [t] = await tx
    .select()
    .from(treatments)
    .where(eq(treatments.id, treatmentId))
    .limit(1);
  if (!t) throw new AppError('Tratamento não encontrado', 404);
  if (t.status === 'active') {
    throw new AppError('Tratamento já está ativo', 409);
  }
  if (t.status === 'abandoned') {
    throw new AppError(
      'Tratamento foi abandonado pelo sistema — não pode ser reaberto por aqui',
      409
    );
  }

  await tx
    .update(treatments)
    .set({ status: 'active', completedAt: null })
    .where(eq(treatments.id, treatmentId));

  await transitionStageIfDifferent(tx, t.journeyId, 'treatment', 'treatment_started', actorUserId);
  await touchJourneyActivity(tx, t.journeyId);
}

// Marca abandono (worker de inatividade). Idempotente — se não está active,
// no-op silencioso. Caller decide quando rodar (cron).
export async function markTreatmentAbandoned(
  tx: Tx,
  treatmentId: string
): Promise<void> {
  const [t] = await tx
    .update(treatments)
    .set({ status: 'abandoned' })
    .where(and(eq(treatments.id, treatmentId), eq(treatments.status, 'active')))
    .returning({
      id: treatments.id,
      tenantId: treatments.tenantId,
      journeyId: treatments.journeyId,
    });
  if (!t) return;

  await recordJourneyEvent(tx, {
    tenantId: t.tenantId,
    journeyId: t.journeyId,
    eventType: 'treatment_abandoned',
    payload: { treatmentId: t.id },
  });

  await checkAndTransitionJourneyToResult(tx, t.journeyId, 'treatment_abandoned', null);
}

// Fechamento manual (chat-domain.md §6). Permite caller passar reason
// opcional pra contextualizar no payload.
export async function markTreatmentManuallyClosed(
  tx: Tx,
  treatmentId: string,
  actorUserId: string | null,
  reason?: string
): Promise<void> {
  const [t] = await tx
    .update(treatments)
    .set({ status: 'manually_closed' })
    .where(and(eq(treatments.id, treatmentId), eq(treatments.status, 'active')))
    .returning({
      id: treatments.id,
      tenantId: treatments.tenantId,
      journeyId: treatments.journeyId,
    });
  if (!t) {
    throw new AppError(
      'Tratamento não está ativo — não pode ser fechado manualmente',
      409
    );
  }

  await recordJourneyEvent(tx, {
    tenantId: t.tenantId,
    journeyId: t.journeyId,
    eventType: 'treatment_manually_closed',
    payload: { treatmentId: t.id, reason: reason ?? null },
    actorUserId,
  });
  await touchJourneyActivity(tx, t.journeyId);

  await checkAndTransitionJourneyToResult(tx, t.journeyId, 'treatment_manually_closed', actorUserId);
}

// Picker FIFO: pega a session pending mais antiga do (cliente, procedure)
// que NÃO tem appointment ativo. "Ativo" = appointment com status fora
// dos terminais 'cancelled'/'no_show' (que liberam a session). Usado pela
// UI quando staff escolhe rapidamente "agende a próxima session pendente".
export interface PickPendingSessionInput {
  clientId: string;
  procedureId: string;
}

export async function pickPendingSessionForProcedure(
  tx: Tx,
  input: PickPendingSessionInput
): Promise<string | undefined> {
  const [row] = await tx
    .select({ id: procedureSessions.id })
    .from(procedureSessions)
    .where(
      and(
        eq(procedureSessions.clientId, input.clientId),
        eq(procedureSessions.procedureId, input.procedureId),
        eq(procedureSessions.status, 'pending'),
        sql`NOT EXISTS (
          SELECT 1 FROM ${appointments}
          WHERE ${appointments.procedureSessionId} = ${procedureSessions.id}
          AND ${appointments.status} NOT IN ('cancelled', 'no_show')
        )`
      )
    )
    .orderBy(procedureSessions.createdAt)
    .limit(1);
  return row?.id;
}

// =====================================================================
// Helper interno: stage transition idempotente
// =====================================================================

async function transitionStageIfDifferent(
  tx: Tx,
  journeyId: string,
  to: JourneyStage,
  reason: JourneyEventType,
  actorUserId: string | null
): Promise<void> {
  const [j] = await tx
    .select({ stage: journeys.stage })
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .limit(1);
  if (!j) return;
  if (j.stage === to) return;
  await applyStageTransition(tx, journeyId, { to, reason, actorUserId });
}
