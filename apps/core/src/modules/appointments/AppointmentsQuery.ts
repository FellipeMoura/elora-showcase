import {
  and,
  appointments,
  eq,
  gte,
  lte,
  sql,
  type SQL,
  type Tx,
} from '@elora/db';
import type { Appointment } from './AppointmentsTypes.js';

interface FindFilters {
  kind?: 'evaluation' | 'procedure';
  journeyId?: string;
  clientId?: string;
  professionalId?: string;
  unitId?: string;
  equipmentId?: string;
  status?: 'scheduled' | 'confirmed' | 'attended' | 'no_show' | 'cancelled';
  dateFrom?: Date;
  dateTo?: Date;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateEvaluationAppointmentInput {
  kind: 'evaluation';
  journeyId: string;
  clientId: string;
  evaluationId: string;
  professionalId?: string | null;
  unitId?: string | null;
  scheduledAt: Date;
  durationMinutes: number;
  notes?: string | null;
}

interface CreateProcedureAppointmentInput {
  kind: 'procedure';
  journeyId: string;
  clientId: string;
  procedureSessionId: string;
  professionalId?: string | null;
  unitId?: string | null;
  equipmentId?: string | null;
  scheduledAt: Date;
  durationMinutes: number;
  notes?: string | null;
}

type CreateInput = CreateEvaluationAppointmentInput | CreateProcedureAppointmentInput;

interface UpdatePatch {
  professionalId?: string | null;
  unitId?: string | null;
  equipmentId?: string | null;
  scheduledAt?: Date;
  durationMinutes?: number;
  notes?: string | null;
}

export const AppointmentsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: Appointment[]; total: number }> => {
    const where = and(
      filters.kind ? eq(appointments.kind, filters.kind) : undefined,
      filters.journeyId ? eq(appointments.journeyId, filters.journeyId) : undefined,
      filters.clientId ? eq(appointments.clientId, filters.clientId) : undefined,
      filters.professionalId
        ? eq(appointments.professionalId, filters.professionalId)
        : undefined,
      filters.unitId ? eq(appointments.unitId, filters.unitId) : undefined,
      filters.equipmentId
        ? eq(appointments.equipmentId, filters.equipmentId)
        : undefined,
      filters.status ? eq(appointments.status, filters.status) : undefined,
      filters.dateFrom ? gte(appointments.scheduledAt, filters.dateFrom) : undefined,
      filters.dateTo ? lte(appointments.scheduledAt, filters.dateTo) : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(appointments)
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(appointments)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<Appointment | undefined> => {
    const [row] = await tx
      .select()
      .from(appointments)
      .where(eq(appointments.id, id))
      .limit(1);
    return row;
  },

  // Verifica se existe outro appointment ATIVO (não terminal) referenciando
  // esta procedure_session. Usado pra impedir double-booking. "Ativo" =
  // status NOT IN (cancelled, no_show).
  findActiveAppointmentForSession: async (
    tx: Tx,
    procedureSessionId: string
  ): Promise<Appointment | undefined> => {
    const [row] = await tx
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.procedureSessionId, procedureSessionId),
          sql`${appointments.status} NOT IN ('cancelled', 'no_show')`
        )
      )
      .limit(1);
    return row;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<Appointment> => {
    const values =
      input.kind === 'evaluation'
        ? {
            tenantId,
            journeyId: input.journeyId,
            clientId: input.clientId,
            kind: 'evaluation' as const,
            evaluationId: input.evaluationId,
            procedureSessionId: null,
            professionalId: input.professionalId ?? null,
            unitId: input.unitId ?? null,
            equipmentId: null,
            scheduledAt: input.scheduledAt,
            durationMinutes: input.durationMinutes,
            notes: input.notes ?? null,
          }
        : {
            tenantId,
            journeyId: input.journeyId,
            clientId: input.clientId,
            kind: 'procedure' as const,
            evaluationId: null,
            procedureSessionId: input.procedureSessionId,
            professionalId: input.professionalId ?? null,
            unitId: input.unitId ?? null,
            equipmentId: input.equipmentId ?? null,
            scheduledAt: input.scheduledAt,
            durationMinutes: input.durationMinutes,
            notes: input.notes ?? null,
          };

    const [row] = await tx.insert(appointments).values(values).returning();
    if (!row) throw new Error('Falha ao inserir appointment');
    return row;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch
  ): Promise<Appointment | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.professionalId !== undefined) set.professionalId = patch.professionalId;
    if (patch.unitId !== undefined) set.unitId = patch.unitId;
    if (patch.equipmentId !== undefined) set.equipmentId = patch.equipmentId;
    if (patch.scheduledAt !== undefined) set.scheduledAt = patch.scheduledAt;
    if (patch.durationMinutes !== undefined)
      set.durationMinutes = patch.durationMinutes;
    if (patch.notes !== undefined) set.notes = patch.notes;

    const [row] = await tx
      .update(appointments)
      .set(set)
      .where(eq(appointments.id, id))
      .returning();
    return row;
  },

  setStatus: async (
    tx: Tx,
    id: string,
    status:
      | 'scheduled'
      | 'confirmed'
      | 'attended'
      | 'no_show'
      | 'cancelled'
  ): Promise<Appointment | undefined> => {
    const [row] = await tx
      .update(appointments)
      .set({ status })
      .where(eq(appointments.id, id))
      .returning();
    return row;
  },
};
