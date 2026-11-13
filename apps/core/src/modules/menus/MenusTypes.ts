import type { InferSelectModel, menus } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type Menu = InferSelectModel<typeof menus>;

// Nó da árvore de menus — adiciona `children` recursivo ao shape do Menu.
export interface MenuNode extends Menu {
  children: MenuNode[];
}

// Regex simples pra hex CSS (`#RGB`, `#RRGGBB`, `#RRGGBBAA`). Aceita também
// vazio/null via `.nullable().optional()` — quem valida é o schema abaixo.
// Serve tanto pra input (create/update) quanto pra sanity check no response.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export const menuResponseSchema = z
  .object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    label: z.string(),
    icon: z.string().nullable(),
    color: z.string().nullable(),
    path: z.string().nullable(),
    position: z.number().int(),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Menu');

// MenuNode response — schema OpenAPI declarado SEM recursão tipada.
//
// Por quê: @asteasolutions/zod-to-openapi 7.x não consegue gerar OpenAPI 3.0
// pra schemas Zod recursivos via z.lazy (issue conhecida — `ZodLazy` quebra
// o walker mesmo com refId nomeado). Como compromise, declaramos children
// como `array de objetos com schema livre` e descrevemos a recursão em
// prose. Frontend tipa o nó recursivo via interface TypeScript abaixo.
//
// Quando subirmos pra Zod v4 + zod-to-openapi 8.x, dá pra voltar à recursão
// tipada — JSON Schema 2020-12 (que 3.1 usa) tem $dynamicRef que resolve isso.
export const menuNodeSchema = menuResponseSchema
  .extend({
    children: z
      .array(z.record(z.unknown()))
      .openapi({
        description:
          'Filhos da subárvore. Cada item é recursivamente um MenuNode (mesmo ' +
          'shape do nó pai). OpenAPI 3.0 não consegue expressar isso de forma ' +
          'tipada em z.lazy — frontend deriva do TypeScript.',
      }),
  })
  .openapi('MenuNode');

export const createMenuSchema = z
  .object({
    parentId: z
      .string()
      .uuid('parentId inválido')
      .nullable()
      .optional()
      .openapi({ description: 'null pra raiz; uuid pra filho.' }),
    label: z.string().trim().min(1, 'Label obrigatório').max(255).openapi({ example: 'Clientes' }),
    icon: z.string().trim().max(64).nullable().optional().openapi({ example: 'users' }),
    color: z
      .string()
      .trim()
      .max(32)
      .regex(HEX_COLOR, 'Cor precisa ser hex (#RGB, #RRGGBB ou #RRGGBBAA)')
      .nullable()
      .optional()
      .openapi({ example: '#ef4444', description: 'Hex CSS pra cor do ícone na sidebar.' }),
    path: z.string().trim().max(512).nullable().optional().openapi({ example: '/clients' }),
    position: z.coerce.number().int().min(0).default(0),
  })
  .openapi('CreateMenuInput');

export type CreateMenuInput = z.infer<typeof createMenuSchema>;

export const updateMenuSchema = z
  .object({
    parentId: z.string().uuid().nullable().optional(),
    label: z.string().trim().min(1).max(255).optional(),
    icon: z.string().trim().max(64).nullable().optional(),
    color: z
      .string()
      .trim()
      .max(32)
      .regex(HEX_COLOR, 'Cor precisa ser hex (#RGB, #RRGGBB ou #RRGGBBAA)')
      .nullable()
      .optional(),
    path: z.string().trim().max(512).nullable().optional(),
    position: z.coerce.number().int().min(0).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateMenuInput');

export type UpdateMenuInput = z.infer<typeof updateMenuSchema>;

export const findMenusQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(20).openapi({ example: 20 }),
    q: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
  })
  .openapi('FindMenusQuery');

export type FindMenusQuery = z.infer<typeof findMenusQuerySchema>;

export const menuIdParamSchema = z.object({
  id: z.string().uuid('ID inválido').openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export const attachGroupSchema = z
  .object({
    groupId: z.string().uuid('groupId inválido'),
  })
  .openapi('AttachMenuGroupInput');

export type AttachGroupInput = z.infer<typeof attachGroupSchema>;

export const menuGroupParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
  groupId: z.string().uuid('groupId inválido'),
});

// Vínculo menu ↔ tenant (catálogo global -> tenants habilitados)
export const attachTenantSchema = z
  .object({
    tenantId: z.string().uuid('tenantId inválido'),
  })
  .openapi('AttachMenuTenantInput');

export type AttachTenantInput = z.infer<typeof attachTenantSchema>;

export const menuTenantParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
  tenantId: z.string().uuid('tenantId inválido'),
});

// Tenant resumido pra resposta de "tenants vinculados a um menu".
export const menuTenantResponseSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    linkedAt: z.string().datetime(),
  })
  .openapi('MenuTenant');

// Set idempotente da lista de tenants vinculados ao menu. Backend faz o
// diff: insere os que faltam, remove os que não vieram.
export const setMenuTenantsSchema = z
  .object({
    tenantIds: z
      .array(z.string().uuid('tenantId inválido'))
      .openapi({ description: 'Lista exata de tenants que devem ficar vinculados.' }),
  })
  .openapi('SetMenuTenantsInput');

export type SetMenuTenantsInput = z.infer<typeof setMenuTenantsSchema>;

// Set idempotente da lista de grupos do tenant que veem o menu. Tenant-scoped.
export const setMenuGroupsSchema = z
  .object({
    groupIds: z
      .array(z.string().uuid('groupId inválido'))
      .openapi({ description: 'Lista exata de grupos do tenant que devem ver este menu.' }),
  })
  .openapi('SetMenuGroupsInput');

export type SetMenuGroupsInput = z.infer<typeof setMenuGroupsSchema>;
