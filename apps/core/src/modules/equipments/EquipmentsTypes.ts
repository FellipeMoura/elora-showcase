import { equipments, type InferSelectModel } from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type Equipment = InferSelectModel<typeof equipments>;

export const equipmentsSortSpec = createSortSpec(
  {
    name: equipments.name,
    createdAt: equipments.createdAt,
    updatedAt: equipments.updatedAt,
  },
  { field: 'name', direction: 'asc' }
);

export const equipmentResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Equipment');

export const createEquipmentSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'Laser Soprano' }),
  })
  .openapi('CreateEquipmentInput');

export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;

export const updateEquipmentSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateEquipmentInput');

export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>;

export const findEquipmentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(50),
    q: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
  })
  .merge(sortQuerySchema(equipmentsSortSpec))
  .openapi('FindEquipmentsQuery');

export type FindEquipmentsQuery = z.infer<typeof findEquipmentsQuerySchema>;

export const equipmentIdParamSchema = z.object({
  id: z
    .string()
    .uuid('ID inválido')
    .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export type EquipmentIdParam = z.infer<typeof equipmentIdParamSchema>;
