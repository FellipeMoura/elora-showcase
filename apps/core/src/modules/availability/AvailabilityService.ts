import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { RoleCode } from '../../shared/permissions/permissions.js';
import {
  computeFreeSlots,
  type FreeSlot,
} from '../../shared/scheduling/freeSlots.js';
import { AvailabilityQuery } from './AvailabilityQuery.js';
import type {
  CreateExceptionInput,
  CreateScheduleInput,
  FindExceptionsQuery,
  FindSchedulesQuery,
  FreeSlotsQuery,
  ProfessionalSchedule,
  ScheduleException,
  UpdateExceptionInput,
  UpdateScheduleInput,
} from './AvailabilityTypes.js';

// =====================================================================
// Política de autorização (decisão 4 do usuário, 2026-05-20):
//   - admin/manager editam disponibilidade de qualquer profissional
//   - professional edita só a própria
//   - reception/viewer só leem
//
// Permission `availability:write` é mapeada pros 3 papéis com escrita.
// Aqui no Service, adicional: se actor NÃO é admin/manager, então
// `target.userId` precisa ser `actor.userId`. Caso contrário, 403.
// =====================================================================

const PRIVILEGED_ROLES: ReadonlyArray<RoleCode> = ['admin', 'manager'];

function isPrivileged(roleCodes: ReadonlyArray<RoleCode>): boolean {
  return roleCodes.some((r) => PRIVILEGED_ROLES.includes(r));
}

function assertCanManage(
  actorUserId: string | null,
  actorRoleCodes: ReadonlyArray<RoleCode>,
  targetUserId: string
): void {
  if (isPrivileged(actorRoleCodes)) return;
  if (actorUserId && actorUserId === targetUserId) return;
  throw new AppError(
    'Sem permissão pra alterar disponibilidade de outro profissional',
    403
  );
}

export const AvailabilityService = {
  // Schedules --------------------------------------------------------

  findSchedules: async (
    tenantId: string,
    query: FindSchedulesQuery
  ): Promise<ProfessionalSchedule[]> => {
    return withTenant(db, tenantId, async (tx) => {
      return AvailabilityQuery.findSchedules(tx, {
        userId: query.userId,
        dayOfWeek: query.dayOfWeek,
      });
    });
  },

  createSchedule: async (
    tenantId: string,
    input: CreateScheduleInput,
    actorUserId: string | null,
    actorRoleCodes: ReadonlyArray<RoleCode>
  ): Promise<ProfessionalSchedule> => {
    assertCanManage(actorUserId, actorRoleCodes, input.userId);
    return withTenant(db, tenantId, async (tx) => {
      return AvailabilityQuery.createSchedule(tx, tenantId, {
        userId: input.userId,
        dayOfWeek: input.dayOfWeek,
        startTime: input.startTime,
        endTime: input.endTime,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
      });
    });
  },

  updateSchedule: async (
    tenantId: string,
    id: string,
    input: UpdateScheduleInput,
    actorUserId: string | null,
    actorRoleCodes: ReadonlyArray<RoleCode>
  ): Promise<ProfessionalSchedule> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await AvailabilityQuery.findScheduleById(tx, id);
      if (!current) throw new AppError('Horário não encontrado', 404);
      assertCanManage(actorUserId, actorRoleCodes, current.userId);

      // Refine no schema garante endTime > startTime quando ambos no payload.
      // Mas update pode trazer só um — validar usando o final-state.
      const finalStart = input.startTime ?? current.startTime;
      const finalEnd = input.endTime ?? current.endTime;
      if (!isTimeOrdered(finalStart, finalEnd)) {
        throw new AppError('endTime deve ser maior que startTime', 400);
      }

      const updated = await AvailabilityQuery.updateSchedule(tx, id, input);
      if (!updated) throw new AppError('Horário não encontrado', 404);
      return updated;
    });
  },

  deleteSchedule: async (
    tenantId: string,
    id: string,
    actorUserId: string | null,
    actorRoleCodes: ReadonlyArray<RoleCode>
  ): Promise<void> => {
    await withTenant(db, tenantId, async (tx) => {
      const current = await AvailabilityQuery.findScheduleById(tx, id);
      if (!current) throw new AppError('Horário não encontrado', 404);
      assertCanManage(actorUserId, actorRoleCodes, current.userId);
      const deleted = await AvailabilityQuery.deleteSchedule(tx, id);
      if (!deleted) throw new AppError('Horário não encontrado', 404);
    });
  },

  // Exceptions -------------------------------------------------------

  findExceptions: async (
    tenantId: string,
    query: FindExceptionsQuery
  ): Promise<ScheduleException[]> => {
    return withTenant(db, tenantId, async (tx) => {
      return AvailabilityQuery.findExceptions(tx, {
        userId: query.userId,
        from: query.from ? new Date(query.from) : undefined,
        to: query.to ? new Date(query.to) : undefined,
      });
    });
  },

  createException: async (
    tenantId: string,
    input: CreateExceptionInput,
    actorUserId: string | null,
    actorRoleCodes: ReadonlyArray<RoleCode>
  ): Promise<ScheduleException> => {
    assertCanManage(actorUserId, actorRoleCodes, input.userId);
    return withTenant(db, tenantId, async (tx) => {
      return AvailabilityQuery.createException(tx, tenantId, {
        userId: input.userId,
        startAt: new Date(input.startAt),
        endAt: new Date(input.endAt),
        kind: input.kind,
        notes: input.notes,
      });
    });
  },

  updateException: async (
    tenantId: string,
    id: string,
    input: UpdateExceptionInput,
    actorUserId: string | null,
    actorRoleCodes: ReadonlyArray<RoleCode>
  ): Promise<ScheduleException> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await AvailabilityQuery.findExceptionById(tx, id);
      if (!current) throw new AppError('Exceção não encontrada', 404);
      assertCanManage(actorUserId, actorRoleCodes, current.userId);

      const finalStart = input.startAt ? new Date(input.startAt) : current.startAt;
      const finalEnd = input.endAt ? new Date(input.endAt) : current.endAt;
      if (finalEnd <= finalStart) {
        throw new AppError('endAt deve ser maior que startAt', 400);
      }

      const updated = await AvailabilityQuery.updateException(tx, id, {
        startAt: input.startAt ? new Date(input.startAt) : undefined,
        endAt: input.endAt ? new Date(input.endAt) : undefined,
        kind: input.kind,
        notes: input.notes,
      });
      if (!updated) throw new AppError('Exceção não encontrada', 404);
      return updated;
    });
  },

  deleteException: async (
    tenantId: string,
    id: string,
    actorUserId: string | null,
    actorRoleCodes: ReadonlyArray<RoleCode>
  ): Promise<void> => {
    await withTenant(db, tenantId, async (tx) => {
      const current = await AvailabilityQuery.findExceptionById(tx, id);
      if (!current) throw new AppError('Exceção não encontrada', 404);
      assertCanManage(actorUserId, actorRoleCodes, current.userId);
      const deleted = await AvailabilityQuery.deleteException(tx, id);
      if (!deleted) throw new AppError('Exceção não encontrada', 404);
    });
  },

  // Free slots -------------------------------------------------------

  findFreeSlots: async (
    tenantId: string,
    query: FreeSlotsQuery
  ): Promise<FreeSlot[]> => {
    return withTenant(db, tenantId, async (tx) => {
      return computeFreeSlots(tx, {
        userId: query.userId,
        date: parseLocalDate(query.date),
        durationMinutes: query.durationMinutes,
      });
    });
  },
};

function isTimeOrdered(startTime: string, endTime: string): boolean {
  return toMinutes(endTime) > toMinutes(startTime);
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}

// YYYY-MM-DD → Date local na meia-noite (sem timezone shift que Date(string)
// faria em ISO date sem hora — interpretaria como UTC).
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m as number) - 1, d as number, 0, 0, 0, 0);
}
