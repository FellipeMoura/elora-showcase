import {
  and,
  eq,
  procedureSessions,
  sql,
  treatmentProcedures,
  type SQL,
  type Tx,
} from '@elora/db';
import type { ProcedureSession } from './ProcedureSessionsTypes.js';

interface FindFilters {
  clientId?: string;
  procedureId?: string;
  treatmentId?: string;
  status?: 'pending' | 'signed' | 'done' | 'cancelled';
}

interface Pagination {
  page: number;
  pageSize: number;
}

export const ProcedureSessionsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: ProcedureSession[]; total: number }> => {
    // treatmentId requer JOIN com treatment_procedures. Reusamos a query base
    // mas com IN (...) subquery — mais simples que join condicional.
    const treatmentSessionIdsCte = filters.treatmentId
      ? sql`${procedureSessions.id} IN (
          SELECT ${treatmentProcedures.procedureSessionId}
          FROM ${treatmentProcedures}
          WHERE ${treatmentProcedures.treatmentId} = ${filters.treatmentId}
        )`
      : undefined;

    const where = and(
      filters.clientId
        ? eq(procedureSessions.clientId, filters.clientId)
        : undefined,
      filters.procedureId
        ? eq(procedureSessions.procedureId, filters.procedureId)
        : undefined,
      filters.status ? eq(procedureSessions.status, filters.status) : undefined,
      treatmentSessionIdsCte,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(procedureSessions)
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(procedureSessions)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (
    tx: Tx,
    id: string
  ): Promise<ProcedureSession | undefined> => {
    const [row] = await tx
      .select()
      .from(procedureSessions)
      .where(eq(procedureSessions.id, id))
      .limit(1);
    return row;
  },

  updateNotes: async (
    tx: Tx,
    id: string,
    evolutionNotes: string | null
  ): Promise<ProcedureSession | undefined> => {
    const [row] = await tx
      .update(procedureSessions)
      .set({ evolutionNotes })
      .where(eq(procedureSessions.id, id))
      .returning();
    return row;
  },

  setStatus: async (
    tx: Tx,
    id: string,
    status: 'pending' | 'signed' | 'done' | 'cancelled'
  ): Promise<ProcedureSession | undefined> => {
    const [row] = await tx
      .update(procedureSessions)
      .set({ status })
      .where(eq(procedureSessions.id, id))
      .returning();
    return row;
  },

  // Resolve treatment ativo desta session via treatment_procedures.
  // Retorna ID do treatment (ou undefined se não linkada).
  findTreatmentIdForSession: async (
    tx: Tx,
    sessionId: string
  ): Promise<string | undefined> => {
    const [row] = await tx
      .select({ treatmentId: treatmentProcedures.treatmentId })
      .from(treatmentProcedures)
      .where(eq(treatmentProcedures.procedureSessionId, sessionId))
      .limit(1);
    return row?.treatmentId;
  },
};
