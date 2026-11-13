import {
  treatments,
  type InferSelectModel,
} from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type Treatment = InferSelectModel<typeof treatments>;

export const treatmentsSortSpec = createSortSpec(
  {
    createdAt: treatments.createdAt,
    updatedAt: treatments.updatedAt,
    startedAt: treatments.startedAt,
    completedAt: treatments.completedAt,
  },
  { field: 'createdAt', direction: 'desc' }
);

export const treatmentStatusValues = [
  'active',
  'completed',
  'abandoned',
  'manually_closed',
] as const;

export const treatmentResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    journeyId: z.string().uuid(),
    clientId: z.string().uuid(),
    name: z.string(),
    status: z.enum(treatmentStatusValues),
    startedAt: z.string().datetime().nullable(),
    completedAt: z.string().datetime().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Treatment');

// Lista paginada inclui dados denormalizados pra evitar N+1 no front:
// nome do cliente (JOIN clients) + contadores de sessões. Detalhe ainda
// devolve plain Treatment + sessions embedded — não há motivo pra repetir.
export const treatmentListItemSchema = treatmentResponseSchema
  .extend({
    clientName: z.string(),
    sessionsTotal: z.number().int().nonnegative(),
    sessionsDone: z.number().int().nonnegative(),
    sessionsPending: z.number().int().nonnegative(),
  })
  .openapi('TreatmentListItem');

export type TreatmentListItem = Treatment & {
  clientName: string;
  sessionsTotal: number;
  sessionsDone: number;
  sessionsPending: number;
};

export const updateTreatmentSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    notes: z.string().trim().max(20000).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateTreatmentInput');

export type UpdateTreatmentInput = z.infer<typeof updateTreatmentSchema>;

export const closeManuallySchema = z
  .object({
    reason: z.string().trim().max(500).nullable().optional(),
  })
  .openapi('CloseTreatmentManuallyInput');

export type CloseManuallyInput = z.infer<typeof closeManuallySchema>;

export const findTreatmentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    journeyId: z.string().uuid().optional(),
    clientId: z.string().uuid().optional(),
    status: z.enum(treatmentStatusValues).optional(),
  })
  .merge(sortQuerySchema(treatmentsSortSpec))
  .openapi('FindTreatmentsQuery');

export type FindTreatmentsQuery = z.infer<typeof findTreatmentsQuerySchema>;

export const treatmentIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export type TreatmentIdParam = z.infer<typeof treatmentIdParamSchema>;
