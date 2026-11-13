import { appointments, type InferSelectModel } from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';
import { evaluationKindValues } from '../evaluations/EvaluationsTypes.js';

export type Appointment = InferSelectModel<typeof appointments>;

export const appointmentsSortSpec = createSortSpec(
  {
    scheduledAt: appointments.scheduledAt,
    createdAt: appointments.createdAt,
    updatedAt: appointments.updatedAt,
  },
  { field: 'scheduledAt', direction: 'asc' }
);

export const appointmentStatusValues = [
  'scheduled',
  'confirmed',
  'attended',
  'no_show',
  'cancelled',
] as const;

export const appointmentKindValues = ['evaluation', 'procedure'] as const;

export const appointmentResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    journeyId: z.string().uuid(),
    clientId: z.string().uuid(),
    kind: z.enum(appointmentKindValues),
    evaluationId: z.string().uuid().nullable(),
    procedureSessionId: z.string().uuid().nullable(),
    professionalId: z.string().uuid().nullable(),
    unitId: z.string().uuid().nullable(),
    equipmentId: z.string().uuid().nullable(),
    scheduledAt: z.string().datetime(),
    durationMinutes: z.number().int(),
    status: z.enum(appointmentStatusValues),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Appointment');

// Discriminated union — kind decide quais campos extras são obrigatórios.
// CHECK constraint no DB garante consistência se algo escapar.
export const createAppointmentSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('evaluation'),
      journeyId: z.string().uuid('journeyId inválido'),
      professionalId: z.string().uuid().nullable().optional(),
      unitId: z.string().uuid().nullable().optional(),
      scheduledAt: z
        .string()
        .datetime({ message: 'scheduledAt deve ser ISO 8601' })
        .openapi({ example: '2026-06-12T14:30:00.000Z' }),
      durationMinutes: z.number().int().min(5).max(480).default(30),
      notes: z.string().trim().max(5000).nullable().optional(),
      // Cria a evaluation inline — appointment de avaliação sempre traz
      // o tipo da avaliação. Atomic: criação dos 2 rows numa transação.
      evaluation: z.object({
        kind: z.enum(evaluationKindValues).default('initial'),
      }),
    }),
    z.object({
      kind: z.literal('procedure'),
      journeyId: z.string().uuid('journeyId inválido'),
      // procedure_sessions criadas em quotes.closeSale — caller escolhe
      // qual sessão pendente desse cliente vai pra esse slot.
      procedureSessionId: z.string().uuid('procedureSessionId inválido'),
      professionalId: z.string().uuid().nullable().optional(),
      unitId: z.string().uuid().nullable().optional(),
      equipmentId: z.string().uuid().nullable().optional(),
      scheduledAt: z
        .string()
        .datetime({ message: 'scheduledAt deve ser ISO 8601' }),
      durationMinutes: z.number().int().min(5).max(480).default(60),
      notes: z.string().trim().max(5000).nullable().optional(),
    }),
  ])
  .openapi('CreateAppointmentInput');

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;

// PATCH só mexe em campos do SLOT — kind/evaluationId/procedureSessionId
// não mudam pós-criação (pra trocar, cancele e crie novo appointment).
export const updateAppointmentSchema = z
  .object({
    professionalId: z.string().uuid().nullable().optional(),
    unitId: z.string().uuid().nullable().optional(),
    equipmentId: z.string().uuid().nullable().optional(),
    scheduledAt: z.string().datetime().optional(),
    durationMinutes: z.number().int().min(5).max(480).optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateAppointmentInput');

export type UpdateAppointmentInput = z.infer<typeof updateAppointmentSchema>;

export const findAppointmentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(50),
    kind: z.enum(appointmentKindValues).optional(),
    journeyId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    professionalId: z.string().uuid().optional(),
    unitId: z.string().uuid().optional(),
    equipmentId: z.string().uuid().optional(),
    status: z.enum(appointmentStatusValues).optional(),
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
  })
  .merge(sortQuerySchema(appointmentsSortSpec))
  .openapi('FindAppointmentsQuery');

export type FindAppointmentsQuery = z.infer<typeof findAppointmentsQuerySchema>;

export const appointmentIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export type AppointmentIdParam = z.infer<typeof appointmentIdParamSchema>;
