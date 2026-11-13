import {
  professionalSchedules,
  scheduleExceptions,
  type InferSelectModel,
} from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type ProfessionalSchedule = InferSelectModel<typeof professionalSchedules>;
export type ScheduleException = InferSelectModel<typeof scheduleExceptions>;

export const weekdayValues = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;

export const scheduleExceptionKindValues = [
  'vacation',
  'sick',
  'training',
  'holiday',
  'other',
] as const;

const timeStringSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/, 'Hora deve estar em HH:MM');

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar em YYYY-MM-DD');

// =====================================================================
// professional_schedules
// =====================================================================

export const professionalScheduleResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    userId: z.string().uuid(),
    dayOfWeek: z.enum(weekdayValues),
    startTime: z.string(),
    endTime: z.string(),
    effectiveFrom: z.string(),
    effectiveTo: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ProfessionalSchedule');

export const createScheduleSchema = z
  .object({
    userId: z.string().uuid('userId inválido'),
    dayOfWeek: z.enum(weekdayValues),
    startTime: timeStringSchema.openapi({ example: '08:00' }),
    endTime: timeStringSchema.openapi({ example: '12:00' }),
    effectiveFrom: isoDateSchema.optional(),
    effectiveTo: isoDateSchema.nullable().optional(),
  })
  .refine(
    (data) => timeToMinutes(data.endTime) > timeToMinutes(data.startTime),
    {
      message: 'endTime deve ser maior que startTime',
      path: ['endTime'],
    }
  )
  .openapi('CreateScheduleInput');

export type CreateScheduleInput = z.infer<typeof createScheduleSchema>;

export const updateScheduleSchema = z
  .object({
    startTime: timeStringSchema.optional(),
    endTime: timeStringSchema.optional(),
    effectiveFrom: isoDateSchema.optional(),
    effectiveTo: isoDateSchema.nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateScheduleInput');

export type UpdateScheduleInput = z.infer<typeof updateScheduleSchema>;

export const findSchedulesQuerySchema = z
  .object({
    userId: z.string().uuid().optional(),
    dayOfWeek: z.enum(weekdayValues).optional(),
  })
  .openapi('FindSchedulesQuery');

export type FindSchedulesQuery = z.infer<typeof findSchedulesQuerySchema>;

// =====================================================================
// schedule_exceptions
// =====================================================================

export const scheduleExceptionResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    userId: z.string().uuid(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    kind: z.enum(scheduleExceptionKindValues),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ScheduleException');

export const createExceptionSchema = z
  .object({
    userId: z.string().uuid('userId inválido'),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    kind: z.enum(scheduleExceptionKindValues).default('other'),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((data) => new Date(data.endAt) > new Date(data.startAt), {
    message: 'endAt deve ser maior que startAt',
    path: ['endAt'],
  })
  .openapi('CreateScheduleExceptionInput');

export type CreateExceptionInput = z.infer<typeof createExceptionSchema>;

export const updateExceptionSchema = z
  .object({
    startAt: z.string().datetime().optional(),
    endAt: z.string().datetime().optional(),
    kind: z.enum(scheduleExceptionKindValues).optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateScheduleExceptionInput');

export type UpdateExceptionInput = z.infer<typeof updateExceptionSchema>;

export const findExceptionsQuerySchema = z
  .object({
    userId: z.string().uuid().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .openapi('FindScheduleExceptionsQuery');

export type FindExceptionsQuery = z.infer<typeof findExceptionsQuerySchema>;

// =====================================================================
// Free slots
// =====================================================================

export const freeSlotsQuerySchema = z
  .object({
    userId: z.string().uuid('userId inválido'),
    date: isoDateSchema.openapi({ example: '2026-06-15' }),
    durationMinutes: z.coerce.number().int().min(5).max(480),
  })
  .openapi('FreeSlotsQuery');

export type FreeSlotsQuery = z.infer<typeof freeSlotsQuerySchema>;

export const freeSlotResponseSchema = z
  .object({
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
  })
  .openapi('FreeSlot');

export const freeSlotsListSchema = z
  .object({ items: z.array(freeSlotResponseSchema) })
  .openapi('FreeSlotsList');

// =====================================================================
// Params
// =====================================================================

export const scheduleIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export const exceptionIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

// =====================================================================
// Util compartilhado pelo schema acima (refine)
// =====================================================================

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':');
  return Number(h) * 60 + Number(m);
}
