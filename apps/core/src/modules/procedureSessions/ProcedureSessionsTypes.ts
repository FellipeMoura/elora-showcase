import {
  procedureSessions,
  type InferSelectModel,
} from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type ProcedureSession = InferSelectModel<typeof procedureSessions>;

export const procedureSessionsSortSpec = createSortSpec(
  {
    createdAt: procedureSessions.createdAt,
    updatedAt: procedureSessions.updatedAt,
    executedAt: procedureSessions.executedAt,
  },
  { field: 'createdAt', direction: 'desc' }
);

export const procedureSessionStatusValues = [
  'pending',
  'signed',
  'done',
  'cancelled',
] as const;

export const procedureSessionResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    clientId: z.string().uuid(),
    procedureId: z.string().uuid(),
    status: z.enum(procedureSessionStatusValues),
    executedAt: z.string().datetime().nullable(),
    executedByUserId: z.string().uuid().nullable(),
    evolutionNotes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ProcedureSession');

export const updateProcedureSessionSchema = z
  .object({
    evolutionNotes: z.string().trim().max(20000).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateProcedureSessionInput');

export type UpdateProcedureSessionInput = z.infer<
  typeof updateProcedureSessionSchema
>;

// Schema do POST /procedure-sessions/:id/evolve — `evolutionNotes`
// obrigatório (nota da aplicadora não pode ser vazia no fluxo normal).
// Override administrativo `markDoneManual` aceita sessão sem nota e tem
// endpoint próprio (`/done`).
export const evolveProcedureSessionSchema = z
  .object({
    evolutionNotes: z
      .string()
      .trim()
      .min(1, 'Observação clínica obrigatória')
      .max(20000),
  })
  .openapi('EvolveProcedureSessionInput');

export type EvolveProcedureSessionInput = z.infer<
  typeof evolveProcedureSessionSchema
>;

export const findProcedureSessionsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(50),
    clientId: z.string().uuid().optional(),
    procedureId: z.string().uuid().optional(),
    treatmentId: z.string().uuid().optional(),
    status: z.enum(procedureSessionStatusValues).optional(),
  })
  .merge(sortQuerySchema(procedureSessionsSortSpec))
  .openapi('FindProcedureSessionsQuery');

export type FindProcedureSessionsQuery = z.infer<
  typeof findProcedureSessionsQuerySchema
>;

export const procedureSessionIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export type ProcedureSessionIdParam = z.infer<
  typeof procedureSessionIdParamSchema
>;
