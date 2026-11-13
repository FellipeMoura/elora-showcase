import {
  and,
  appointments,
  clients,
  desc,
  eq,
  evaluations,
  inArray,
  ne,
  searchInColumns,
  sql,
  type SQL,
  type Tx,
} from '@elora/db';
import type { Evaluation } from './EvaluationsTypes.js';

// Row da listagem com client embutido (sempre join inner). O appointment
// associado é resolvido em consulta separada (`findLatestActiveAppointmentsByEvaluationIds`)
// e mesclado no service — espelha a lógica usada no EvaluationsSection do
// frontend e evita gymnastics com LATERAL (drizzle 0.38 não tem helper).
//
// Como em QuotesQuery: o tipo aqui carrega Date nas colunas do drizzle, mas
// Express serializa Date→ISO no res.json. Wire types em EvaluationsTypes
// descrevem o que chega no cliente.
export type EvaluationListItemRow = Evaluation & {
  clientName: string;
  clientPhoneE164: string;
};

export interface LatestEvaluationAppointment {
  evaluationId: string;
  appointmentId: string;
  status:
    | 'scheduled'
    | 'confirmed'
    | 'attended'
    | 'no_show'
    | 'cancelled';
  scheduledAt: Date;
}

interface FindFilters {
  journeyId?: string;
  clientId?: string;
  status?: 'pending' | 'performed' | 'cancelled';
  kind?: 'initial' | 'reevaluation' | 'return';
  // Busca textual em client.name + client.phone_e164.
  q?: string;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  journeyId: string;
  clientId: string;
  kind: 'initial' | 'reevaluation' | 'return';
  generalNotes?: string | null;
}

interface UpdatePatch {
  kind?: 'initial' | 'reevaluation' | 'return';
  generalNotes?: string | null;
}

export const EvaluationsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: EvaluationListItemRow[]; total: number }> => {
    const where = and(
      filters.journeyId ? eq(evaluations.journeyId, filters.journeyId) : undefined,
      filters.clientId ? eq(evaluations.clientId, filters.clientId) : undefined,
      filters.status ? eq(evaluations.status, filters.status) : undefined,
      filters.kind ? eq(evaluations.kind, filters.kind) : undefined,
      // Busca casa nome OU telefone — operadora digita um dos dois.
      searchInColumns(filters.q, clients.name, clients.phoneE164),
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    // Inner join é seguro: evaluation.client_id é NOT NULL.
    const items = await tx
      .select({
        id: evaluations.id,
        tenantId: evaluations.tenantId,
        journeyId: evaluations.journeyId,
        clientId: evaluations.clientId,
        kind: evaluations.kind,
        status: evaluations.status,
        performedAt: evaluations.performedAt,
        performedByUserId: evaluations.performedByUserId,
        generalNotes: evaluations.generalNotes,
        createdAt: evaluations.createdAt,
        updatedAt: evaluations.updatedAt,
        clientName: clients.name,
        clientPhoneE164: clients.phoneE164,
      })
      .from(evaluations)
      .innerJoin(clients, eq(clients.id, evaluations.clientId))
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(evaluations)
      .innerJoin(clients, eq(clients.id, evaluations.clientId))
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  // Pra cada evaluation, devolve o appointment não-cancelado mais recente
  // (reagendamento pode gerar várias linhas; mantemos o mais recente).
  // Single roundtrip via DISTINCT ON, depois agrupado em Map pelo caller.
  findLatestActiveAppointmentsByEvaluationIds: async (
    tx: Tx,
    evaluationIds: string[]
  ): Promise<LatestEvaluationAppointment[]> => {
    if (evaluationIds.length === 0) return [];

    // DISTINCT ON (evaluation_id) ... ORDER BY evaluation_id, scheduled_at DESC
    // garante 1 row por evaluation com o appointment mais recente não-cancelado.
    const rows = await tx
      .selectDistinctOn([appointments.evaluationId], {
        evaluationId: appointments.evaluationId,
        appointmentId: appointments.id,
        status: appointments.status,
        scheduledAt: appointments.scheduledAt,
      })
      .from(appointments)
      .where(
        and(
          inArray(
            appointments.evaluationId,
            evaluationIds
          ),
          ne(appointments.status, 'cancelled')
        )
      )
      .orderBy(appointments.evaluationId, desc(appointments.scheduledAt));

    return rows
      .filter((r): r is typeof r & { evaluationId: string } =>
        r.evaluationId !== null
      )
      .map((r) => ({
        evaluationId: r.evaluationId,
        appointmentId: r.appointmentId,
        status: r.status,
        scheduledAt: r.scheduledAt,
      }));
  },

  findById: async (tx: Tx, id: string): Promise<Evaluation | undefined> => {
    const [row] = await tx
      .select()
      .from(evaluations)
      .where(eq(evaluations.id, id))
      .limit(1);
    return row;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<Evaluation> => {
    const [row] = await tx
      .insert(evaluations)
      .values({
        tenantId,
        journeyId: input.journeyId,
        clientId: input.clientId,
        kind: input.kind,
        status: 'pending',
        generalNotes: input.generalNotes ?? null,
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir evaluation');
    return row;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch
  ): Promise<Evaluation | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.kind !== undefined) set.kind = patch.kind;
    if (patch.generalNotes !== undefined) set.generalNotes = patch.generalNotes;

    const [row] = await tx
      .update(evaluations)
      .set(set)
      .where(eq(evaluations.id, id))
      .returning();
    return row;
  },

  // Usada pela cascata do appointments service quando appointment kind=evaluation
  // vira attended.
  markPerformed: async (
    tx: Tx,
    id: string,
    performedByUserId: string | null
  ): Promise<Evaluation | undefined> => {
    const [row] = await tx
      .update(evaluations)
      .set({
        status: 'performed',
        performedAt: new Date(),
        performedByUserId,
      })
      .where(eq(evaluations.id, id))
      .returning();
    return row;
  },

  setStatus: async (
    tx: Tx,
    id: string,
    status: 'pending' | 'performed' | 'cancelled'
  ): Promise<Evaluation | undefined> => {
    const [row] = await tx
      .update(evaluations)
      .set({ status })
      .where(eq(evaluations.id, id))
      .returning();
    return row;
  },
};
