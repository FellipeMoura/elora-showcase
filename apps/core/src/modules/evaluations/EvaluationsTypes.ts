import { evaluations, type InferSelectModel } from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type Evaluation = InferSelectModel<typeof evaluations>;

export const evaluationsSortSpec = createSortSpec(
  {
    createdAt: evaluations.createdAt,
    updatedAt: evaluations.updatedAt,
    performedAt: evaluations.performedAt,
  },
  { field: 'createdAt', direction: 'desc' }
);

export const evaluationStatusValues = ['pending', 'performed', 'cancelled'] as const;
export const evaluationKindValues = ['initial', 'reevaluation', 'return'] as const;
export const appointmentStatusValues = [
  'scheduled',
  'confirmed',
  'attended',
  'no_show',
  'cancelled',
] as const;

export const evaluationResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    journeyId: z.string().uuid(),
    clientId: z.string().uuid(),
    kind: z.enum(evaluationKindValues),
    status: z.enum(evaluationStatusValues),
    performedAt: z.string().datetime().nullable(),
    performedByUserId: z.string().uuid().nullable(),
    generalNotes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Evaluation');

// Listagem (GET /evaluations) carrega join com cliente + appointment associado
// (latest não-cancelado). Espelha o que o frontend monta no EvaluationsSection
// do ClientDetail — backend faz a mesclagem pra evitar N+1 no client.
export const evaluationListItemSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    journeyId: z.string().uuid(),
    clientId: z.string().uuid(),
    kind: z.enum(evaluationKindValues),
    status: z.enum(evaluationStatusValues),
    performedAt: z.string().datetime().nullable(),
    performedByUserId: z.string().uuid().nullable(),
    generalNotes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    clientName: z.string(),
    clientPhoneE164: z.string(),
    appointmentId: z.string().uuid().nullable(),
    appointmentStatus: z.enum(appointmentStatusValues).nullable(),
    appointmentScheduledAt: z.string().datetime().nullable(),
  })
  .openapi('EvaluationListItem');

export type EvaluationListItem = z.infer<typeof evaluationListItemSchema>;

// Criação standalone — desacoplada do agendamento. Usada quando staff cria
// a entidade clínica direto (walk-in, retroativa, ou pra preencher fichas
// antes do appointment existir). Status inicial é sempre `pending`.
// Quando o flow começa pelo agendamento, `AppointmentsService.create` cria
// a evaluation inline e este endpoint não é chamado.
export const createEvaluationSchema = z
  .object({
    journeyId: z.string().uuid('journeyId inválido'),
    kind: z.enum(evaluationKindValues).default('initial'),
    generalNotes: z.string().trim().max(20000).nullable().optional(),
  })
  .openapi('CreateEvaluationInput');

export type CreateEvaluationInput = z.infer<typeof createEvaluationSchema>;

// PATCH só edita campos descritivos. Status é alterado por endpoints
// dedicados (/cancel) ou cascata do appointments service (perform).
export const updateEvaluationSchema = z
  .object({
    kind: z.enum(evaluationKindValues).optional(),
    generalNotes: z.string().trim().max(20000).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateEvaluationInput');

export type UpdateEvaluationInput = z.infer<typeof updateEvaluationSchema>;

export const findEvaluationsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    journeyId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    status: z.enum(evaluationStatusValues).optional(),
    kind: z.enum(evaluationKindValues).optional(),
    // Busca textual em client.name + client.phoneE164.
    q: z.string().trim().min(1).optional(),
  })
  .merge(sortQuerySchema(evaluationsSortSpec))
  .openapi('FindEvaluationsQuery');

export type FindEvaluationsQuery = z.infer<typeof findEvaluationsQuerySchema>;

export const evaluationIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export type EvaluationIdParam = z.infer<typeof evaluationIdParamSchema>;
