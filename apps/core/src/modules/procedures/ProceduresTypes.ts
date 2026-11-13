import { procedures, type InferSelectModel } from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type Procedure = InferSelectModel<typeof procedures>;

export const proceduresSortSpec = createSortSpec(
  {
    name: procedures.name,
    defaultSessions: procedures.defaultSessions,
    defaultPrice: procedures.defaultPrice,
    createdAt: procedures.createdAt,
    updatedAt: procedures.updatedAt,
  },
  { field: 'name', direction: 'asc' }
);

// Preço aceito como número em centavos não — usamos decimal "9999.99".
// Zod recebe number do JSON; Query converte pra string antes do insert porque
// Drizzle decimal é string no driver. Limite alinhado ao precision do schema
// (decimal(12,2) → até 9_999_999_999.99).
const priceSchema = z
  .number()
  .nonnegative('Preço não pode ser negativo')
  .max(9_999_999_999.99, 'Preço excede o limite')
  .refine((v) => Number.isFinite(v) && Math.round(v * 100) === v * 100, {
    message: 'Preço deve ter no máximo 2 casas decimais',
  });

// Cor pro card na agenda — formato '#RRGGBB' (case-insensitive). Reject
// inválido cedo na borda HTTP.
const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor deve estar em formato #RRGGBB');

export const procedureResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    defaultSessions: z.number().int(),
    defaultPrice: z.string().nullable().openapi({ example: '450.00' }),
    color: z.string().nullable().openapi({ example: '#4f46e5' }),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Procedure');

export const createProcedureSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'Laser axila' }),
    description: z.string().trim().max(5000).nullable().optional(),
    defaultSessions: z
      .number()
      .int()
      .min(1, 'Mínimo de 1 sessão')
      .max(999)
      .default(1),
    defaultPrice: priceSchema.nullable().optional(),
    color: hexColorSchema.nullable().optional(),
  })
  .openapi('CreateProcedureInput');

export type CreateProcedureInput = z.infer<typeof createProcedureSchema>;

export const updateProcedureSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    defaultSessions: z.number().int().min(1).max(999).optional(),
    defaultPrice: priceSchema.nullable().optional(),
    color: hexColorSchema.nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateProcedureInput');

export type UpdateProcedureInput = z.infer<typeof updateProcedureSchema>;

export const findProceduresQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    q: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
  })
  .merge(sortQuerySchema(proceduresSortSpec))
  .openapi('FindProceduresQuery');

export type FindProceduresQuery = z.infer<typeof findProceduresQuerySchema>;

export const procedureIdParamSchema = z.object({
  id: z
    .string()
    .uuid('ID inválido')
    .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export type ProcedureIdParam = z.infer<typeof procedureIdParamSchema>;
