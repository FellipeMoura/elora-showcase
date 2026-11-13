import {
  and,
  asc,
  eq,
  gte,
  lte,
  professionalSchedules,
  scheduleExceptions,
  type Tx,
} from '@elora/db';
import type {
  ProfessionalSchedule,
  ScheduleException,
} from './AvailabilityTypes.js';

interface CreateScheduleInput {
  userId: string;
  dayOfWeek: 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
  startTime: string;
  endTime: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

interface UpdateSchedulePatch {
  startTime?: string;
  endTime?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

interface CreateExceptionInput {
  userId: string;
  startAt: Date;
  endAt: Date;
  kind: 'vacation' | 'sick' | 'training' | 'holiday' | 'other';
  notes?: string | null;
}

interface UpdateExceptionPatch {
  startAt?: Date;
  endAt?: Date;
  kind?: 'vacation' | 'sick' | 'training' | 'holiday' | 'other';
  notes?: string | null;
}

export const AvailabilityQuery = {
  // Schedules --------------------------------------------------------

  findSchedules: async (
    tx: Tx,
    filters: { userId?: string; dayOfWeek?: ProfessionalSchedule['dayOfWeek'] }
  ): Promise<ProfessionalSchedule[]> => {
    const where = and(
      filters.userId ? eq(professionalSchedules.userId, filters.userId) : undefined,
      filters.dayOfWeek
        ? eq(professionalSchedules.dayOfWeek, filters.dayOfWeek)
        : undefined,
    );
    return tx
      .select()
      .from(professionalSchedules)
      .where(where)
      .orderBy(
        asc(professionalSchedules.userId),
        asc(professionalSchedules.dayOfWeek),
        asc(professionalSchedules.startTime)
      );
  },

  findScheduleById: async (
    tx: Tx,
    id: string
  ): Promise<ProfessionalSchedule | undefined> => {
    const [row] = await tx
      .select()
      .from(professionalSchedules)
      .where(eq(professionalSchedules.id, id))
      .limit(1);
    return row;
  },

  createSchedule: async (
    tx: Tx,
    tenantId: string,
    input: CreateScheduleInput
  ): Promise<ProfessionalSchedule> => {
    const [row] = await tx
      .insert(professionalSchedules)
      .values({
        tenantId,
        userId: input.userId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo ?? null,
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir professional_schedule');
    return row;
  },

  updateSchedule: async (
    tx: Tx,
    id: string,
    patch: UpdateSchedulePatch
  ): Promise<ProfessionalSchedule | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.startTime !== undefined) set.startTime = patch.startTime;
    if (patch.endTime !== undefined) set.endTime = patch.endTime;
    if (patch.effectiveFrom !== undefined) set.effectiveFrom = patch.effectiveFrom;
    if (patch.effectiveTo !== undefined) set.effectiveTo = patch.effectiveTo;

    const [row] = await tx
      .update(professionalSchedules)
      .set(set)
      .where(eq(professionalSchedules.id, id))
      .returning();
    return row;
  },

  deleteSchedule: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(professionalSchedules)
      .where(eq(professionalSchedules.id, id))
      .returning({ id: professionalSchedules.id });
    return deleted.length > 0;
  },

  // Exceptions -------------------------------------------------------

  findExceptions: async (
    tx: Tx,
    filters: { userId?: string; from?: Date; to?: Date }
  ): Promise<ScheduleException[]> => {
    // Range query: overlap entre [from, to] e [start_at, end_at].
    const where = and(
      filters.userId ? eq(scheduleExceptions.userId, filters.userId) : undefined,
      filters.to ? lte(scheduleExceptions.startAt, filters.to) : undefined,
      filters.from ? gte(scheduleExceptions.endAt, filters.from) : undefined,
    );
    return tx
      .select()
      .from(scheduleExceptions)
      .where(where)
      .orderBy(asc(scheduleExceptions.startAt));
  },

  findExceptionById: async (
    tx: Tx,
    id: string
  ): Promise<ScheduleException | undefined> => {
    const [row] = await tx
      .select()
      .from(scheduleExceptions)
      .where(eq(scheduleExceptions.id, id))
      .limit(1);
    return row;
  },

  createException: async (
    tx: Tx,
    tenantId: string,
    input: CreateExceptionInput
  ): Promise<ScheduleException> => {
    const [row] = await tx
      .insert(scheduleExceptions)
      .values({
        tenantId,
        userId: input.userId,
        startAt: input.startAt,
        endAt: input.endAt,
        kind: input.kind,
        notes: input.notes ?? null,
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir schedule_exception');
    return row;
  },

  updateException: async (
    tx: Tx,
    id: string,
    patch: UpdateExceptionPatch
  ): Promise<ScheduleException | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.startAt !== undefined) set.startAt = patch.startAt;
    if (patch.endAt !== undefined) set.endAt = patch.endAt;
    if (patch.kind !== undefined) set.kind = patch.kind;
    if (patch.notes !== undefined) set.notes = patch.notes;

    const [row] = await tx
      .update(scheduleExceptions)
      .set(set)
      .where(eq(scheduleExceptions.id, id))
      .returning();
    return row;
  },

  deleteException: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(scheduleExceptions)
      .where(eq(scheduleExceptions.id, id))
      .returning({ id: scheduleExceptions.id });
    return deleted.length > 0;
  },
};
