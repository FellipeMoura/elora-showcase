import type { InferSelectModel, groups } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';
import { ROLE_CODES } from '../../shared/permissions/permissions.js';

export type Group = InferSelectModel<typeof groups>;

export const groupResponseSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    roleCode: z.enum(ROLE_CODES),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Group');

export const createGroupSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'Recepcionistas' }),
    description: z.string().trim().max(1000).optional(),
    roleCode: z.enum(ROLE_CODES).openapi({ example: 'reception' }),
  })
  .openapi('CreateGroupInput');

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

// Update aceita explicit null em description pra "limpar" o campo;
// undefined significa "não mexer".
export const updateGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    roleCode: z.enum(ROLE_CODES).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateGroupInput');

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const findGroupsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(20).openapi({ example: 20 }),
    q: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
    roleCode: z.enum(ROLE_CODES).optional(),
  })
  .openapi('FindGroupsQuery');

export type FindGroupsQuery = z.infer<typeof findGroupsQuerySchema>;

export const groupIdParamSchema = z.object({
  id: z.string().uuid('ID inválido').openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export const addMemberSchema = z
  .object({
    userId: z.string().uuid('userId inválido'),
  })
  .openapi('AddGroupMemberInput');

export type AddMemberInput = z.infer<typeof addMemberSchema>;

export const memberParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
  userId: z.string().uuid('userId inválido'),
});

// Resposta de listMembers: array de PublicUser. Importar de UsersTypes.
// Como o schema é simples, declaramos localmente em vez de criar dependência.
export const groupMemberSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    username: z.string(),
    email: z.string().email().nullable(),
    name: z.string(),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('GroupMember');
