import {
  and,
  asc,
  clients,
  eq,
  procedureSessions,
  sql,
  treatmentProcedures,
  treatments,
  type SQL,
  type Tx,
} from '@elora/db';
import type { ProcedureSession } from '../procedureSessions/ProcedureSessionsTypes.js';
import type { Treatment, TreatmentListItem } from './TreatmentsTypes.js';

interface FindFilters {
  journeyId?: string;
  clientId?: string;
  status?: 'active' | 'completed' | 'abandoned' | 'manually_closed';
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface UpdatePatch {
  name?: string;
  notes?: string | null;
}

export const TreatmentsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: TreatmentListItem[]; total: number }> => {
    const where = and(
      filters.journeyId ? eq(treatments.journeyId, filters.journeyId) : undefined,
      filters.clientId ? eq(treatments.clientId, filters.clientId) : undefined,
      filters.status ? eq(treatments.status, filters.status) : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    // Subquery escalar pra contagem de sessões. Subqueries escalares
    // funcionam aqui porque agrupam por treatmentProcedures.treatmentId =
    // treatments.id (correlato). Mantém o paginated query simples sem
    // GROUP BY (necessário se fizéssemos LEFT JOIN agregando inline).
    const sessionsTotal = sql<number>`(
      SELECT COUNT(*)::int FROM ${treatmentProcedures} tp
      INNER JOIN ${procedureSessions} ps ON ps.id = tp.procedure_session_id
      WHERE tp.treatment_id = ${treatments}.id
    )`;
    const sessionsDone = sql<number>`(
      SELECT COUNT(*)::int FROM ${treatmentProcedures} tp
      INNER JOIN ${procedureSessions} ps ON ps.id = tp.procedure_session_id
      WHERE tp.treatment_id = ${treatments}.id AND ps.status = 'done'
    )`;
    const sessionsPending = sql<number>`(
      SELECT COUNT(*)::int FROM ${treatmentProcedures} tp
      INNER JOIN ${procedureSessions} ps ON ps.id = tp.procedure_session_id
      WHERE tp.treatment_id = ${treatments}.id AND ps.status IN ('pending','signed')
    )`;

    const rows = await tx
      .select({
        treatment: treatments,
        clientName: clients.name,
        sessionsTotal,
        sessionsDone,
        sessionsPending,
      })
      .from(treatments)
      .innerJoin(clients, eq(clients.id, treatments.clientId))
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const items: TreatmentListItem[] = rows.map((r) => ({
      ...r.treatment,
      clientName: r.clientName,
      sessionsTotal: r.sessionsTotal,
      sessionsDone: r.sessionsDone,
      sessionsPending: r.sessionsPending,
    }));

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(treatments)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<Treatment | undefined> => {
    const [row] = await tx
      .select()
      .from(treatments)
      .where(eq(treatments.id, id))
      .limit(1);
    return row;
  },

  // Sessions vinculadas via treatment_procedures, ordenadas pelo createdAt
  // da session.
  findSessionsByTreatment: async (
    tx: Tx,
    treatmentId: string
  ): Promise<ProcedureSession[]> => {
    const rows = await tx
      .select({ session: procedureSessions })
      .from(treatmentProcedures)
      .innerJoin(
        procedureSessions,
        eq(treatmentProcedures.procedureSessionId, procedureSessions.id)
      )
      .where(eq(treatmentProcedures.treatmentId, treatmentId))
      .orderBy(asc(procedureSessions.createdAt));
    return rows.map((r) => r.session);
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch
  ): Promise<Treatment | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.notes !== undefined) set.notes = patch.notes;

    const [row] = await tx
      .update(treatments)
      .set(set)
      .where(eq(treatments.id, id))
      .returning();
    return row;
  },
};
