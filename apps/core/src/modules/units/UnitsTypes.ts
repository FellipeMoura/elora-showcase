import { units, type InferSelectModel } from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type Unit = InferSelectModel<typeof units>;

export const unitsSortSpec = createSortSpec(
  {
    name: units.name,
    createdAt: units.createdAt,
    updatedAt: units.updatedAt,
  },
  { field: 'name', direction: 'asc' }
);

export const unitResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Unit');

export const createUnitSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'Sala 1' }),
  })
  .openapi('CreateUnitInput');

export type CreateUnitInput = z.infer<typeof createUnitSchema>;

export const updateUnitSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateUnitInput');

export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;

export const findUnitsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(50),
    q: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
  })
  .merge(sortQuerySchema(unitsSortSpec))
  .openapi('FindUnitsQuery');

export type FindUnitsQuery = z.infer<typeof findUnitsQuerySchema>;

export const unitIdParamSchema = z.object({
  id: z
    .string()
    .uuid('ID inválido')
    .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export type UnitIdParam = z.infer<typeof unitIdParamSchema>;
