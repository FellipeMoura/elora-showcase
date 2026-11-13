import { Router, type Router as ExpressRouter } from 'express';
import { MenusController } from './MenusController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { loadUserRoles } from '../../shared/middleware/loadUserRoles.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import { requirePlatformAccess } from '../../shared/middleware/requirePlatformAccess.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  REQUIRES_AUTH,
  openApiRegistry,
  paginatedSchema,
} from '../../shared/openapi/index.js';
import { z } from '../../shared/openapi/registry.js';
import { groupResponseSchema } from '../groups/GroupsTypes.js';
import {
  attachGroupSchema,
  attachTenantSchema,
  createMenuSchema,
  findMenusQuerySchema,
  menuGroupParamSchema,
  menuIdParamSchema,
  menuNodeSchema,
  menuResponseSchema,
  menuTenantParamSchema,
  menuTenantResponseSchema,
  setMenuGroupsSchema,
  setMenuTenantsSchema,
  updateMenuSchema,
} from './MenusTypes.js';

const TAG = 'Menus';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedMenusSchema = paginatedSchema(menuResponseSchema, 'PaginatedMenus');
const menuTreeSchema = z.array(menuNodeSchema).openapi('MenuTree');
const menuGroupsListSchema = z.array(groupResponseSchema).openapi('MenuGroupsList');
const menuTenantsListSchema = z.array(menuTenantResponseSchema).openapi('MenuTenantsList');

// Sidebar do usuário logado — sem requirePermission (todo user autenticado vê o seu).
openApiRegistry.registerPath({
  method: 'get',
  path: '/menus/visible',
  tags: [TAG],
  summary: 'Árvore de menus visíveis pro usuário autenticado',
  description: 'Filtra por grupos que o usuário pertence + menu_groups. Usado no sidebar.',
  security: REQUIRES_AUTH,
  responses: {
    200: {
      description: 'Árvore de menus',
      content: { 'application/json': { schema: menuTreeSchema } },
    },
    401: ERROR_RESPONSES[401],
  },
});

router.get('/menus/visible', MenusController.getVisibleTree);

openApiRegistry.registerPath({
  method: 'get',
  path: '/menus/tree',
  tags: [TAG],
  summary: 'Árvore completa de menus (admin)',
  security: REQUIRES_AUTH,
  responses: {
    200: {
      description: 'Árvore completa, sem filtro de visibilidade',
      content: { 'application/json': { schema: menuTreeSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/menus/tree',
  requirePermission('menus:read'),
  requirePlatformAccess,
  MenusController.getTree
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/menus',
  tags: [TAG],
  summary: 'Lista plana paginada de menus',
  security: REQUIRES_AUTH,
  request: { query: findMenusQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedMenusSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/menus',
  requirePermission('menus:read'),
  requirePlatformAccess,
  validateQuery(findMenusQuerySchema),
  MenusController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/menus',
  tags: [TAG],
  summary: 'Cria menu (item ou nó pai)',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createMenuSchema } } },
  },
  responses: {
    201: {
      description: 'Menu criado',
      content: { 'application/json': { schema: menuResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.post(
  '/menus',
  requirePermission('menus:write'),
  requirePlatformAccess,
  validateBody(createMenuSchema),
  MenusController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/menus/{id}',
  tags: [TAG],
  summary: 'Busca menu por ID',
  security: REQUIRES_AUTH,
  request: { params: menuIdParamSchema },
  responses: {
    200: {
      description: 'Menu encontrado',
      content: { 'application/json': { schema: menuResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/menus/:id',
  requirePermission('menus:read'),
  requirePlatformAccess,
  validateParams(menuIdParamSchema),
  MenusController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/menus/{id}',
  tags: [TAG],
  summary: 'Atualiza menu (parcial)',
  security: REQUIRES_AUTH,
  request: {
    params: menuIdParamSchema,
    body: { content: { 'application/json': { schema: updateMenuSchema } } },
  },
  responses: {
    200: {
      description: 'Menu atualizado',
      content: { 'application/json': { schema: menuResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.patch(
  '/menus/:id',
  requirePermission('menus:write'),
  requirePlatformAccess,
  validateParams(menuIdParamSchema),
  validateBody(updateMenuSchema),
  MenusController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/menus/{id}',
  tags: [TAG],
  summary: 'Remove menu (cascade nos filhos)',
  security: REQUIRES_AUTH,
  request: { params: menuIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.delete(
  '/menus/:id',
  requirePermission('menus:delete'),
  requirePlatformAccess,
  validateParams(menuIdParamSchema),
  MenusController.remove
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/menus/{id}/deactivate',
  tags: [TAG],
  summary: 'Desativa menu',
  security: REQUIRES_AUTH,
  request: { params: menuIdParamSchema },
  responses: {
    200: {
      description: 'Menu desativado',
      content: { 'application/json': { schema: menuResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/menus/:id/deactivate',
  requirePermission('menus:write'),
  requirePlatformAccess,
  validateParams(menuIdParamSchema),
  MenusController.deactivate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/menus/{id}/activate',
  tags: [TAG],
  summary: 'Reativa menu',
  security: REQUIRES_AUTH,
  request: { params: menuIdParamSchema },
  responses: {
    200: {
      description: 'Menu ativado',
      content: { 'application/json': { schema: menuResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/menus/:id/activate',
  requirePermission('menus:write'),
  requirePlatformAccess,
  validateParams(menuIdParamSchema),
  MenusController.activate
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/menus/{id}/groups',
  tags: [TAG],
  summary: 'Lista grupos que enxergam o menu',
  security: REQUIRES_AUTH,
  request: { params: menuIdParamSchema },
  responses: {
    200: {
      description: 'Lista de grupos',
      content: { 'application/json': { schema: menuGroupsListSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/menus/:id/groups',
  requirePermission('menus:read'),
  requirePlatformAccess,
  validateParams(menuIdParamSchema),
  MenusController.listGroups
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/menus/{id}/groups',
  tags: [TAG],
  summary: 'Dá visibilidade do menu pra um grupo',
  security: REQUIRES_AUTH,
  request: {
    params: menuIdParamSchema,
    body: { content: { 'application/json': { schema: attachGroupSchema } } },
  },
  responses: {
    204: { description: 'Vinculado' },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/menus/:id/groups',
  requirePermission('menus:write'),
  requirePlatformAccess,
  validateParams(menuIdParamSchema),
  validateBody(attachGroupSchema),
  MenusController.attachGroup
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/menus/{id}/groups/{groupId}',
  tags: [TAG],
  summary: 'Tira visibilidade do menu pra um grupo',
  security: REQUIRES_AUTH,
  request: { params: menuGroupParamSchema },
  responses: {
    204: { description: 'Desvinculado' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.delete(
  '/menus/:id/groups/:groupId',
  requirePermission('menus:write'),
  requirePlatformAccess,
  validateParams(menuGroupParamSchema),
  MenusController.detachGroup
);

openApiRegistry.registerPath({
  method: 'put',
  path: '/menus/{id}/groups',
  tags: [TAG],
  summary: 'Substitui a lista de grupos que veem o menu (super-admin)',
  description:
    'GLOBAL. Recebe a lista completa de groupIds que devem ficar vinculados ' +
    'ao menu. Backend faz diff (insere os que faltam, remove os ausentes) ' +
    'em uma transação. Restrito à equipe Elora.',
  security: REQUIRES_AUTH,
  request: {
    params: menuIdParamSchema,
    body: { content: { 'application/json': { schema: setMenuGroupsSchema } } },
  },
  responses: {
    204: { description: 'Lista atualizada' },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.put(
  '/menus/:id/groups',
  requirePermission('menus:write'),
  requirePlatformAccess,
  validateParams(menuIdParamSchema),
  validateBody(setMenuGroupsSchema),
  MenusController.setGroups
);

// ---- Vínculo menu ↔ tenant (catálogo global) ----
// TODO: quando o conceito de super-admin existir, trocar `menus:write` por
// gate super-admin — qualquer admin de tenant ainda pode habilitar/desabilitar
// menu globalmente. Ver permissions.ts.

openApiRegistry.registerPath({
  method: 'get',
  path: '/menus/{id}/tenants',
  tags: [TAG],
  summary: 'Lista tenants que enxergam o menu',
  security: REQUIRES_AUTH,
  request: { params: menuIdParamSchema },
  responses: {
    200: {
      description: 'Lista de tenants vinculados',
      content: { 'application/json': { schema: menuTenantsListSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/menus/:id/tenants',
  requirePermission('menus:read'),
  requirePlatformAccess,
  validateParams(menuIdParamSchema),
  MenusController.listTenants
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/menus/{id}/tenants',
  tags: [TAG],
  summary: 'Habilita o menu pra um tenant',
  security: REQUIRES_AUTH,
  request: {
    params: menuIdParamSchema,
    body: { content: { 'application/json': { schema: attachTenantSchema } } },
  },
  responses: {
    204: { description: 'Vinculado' },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/menus/:id/tenants',
  requirePermission('menus:write'),
  requirePlatformAccess,
  validateParams(menuIdParamSchema),
  validateBody(attachTenantSchema),
  MenusController.attachTenant
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/menus/{id}/tenants/{tenantId}',
  tags: [TAG],
  summary: 'Desabilita o menu pra um tenant',
  security: REQUIRES_AUTH,
  request: { params: menuTenantParamSchema },
  responses: {
    204: { description: 'Desvinculado' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.delete(
  '/menus/:id/tenants/:tenantId',
  requirePermission('menus:write'),
  requirePlatformAccess,
  validateParams(menuTenantParamSchema),
  MenusController.detachTenant
);

openApiRegistry.registerPath({
  method: 'put',
  path: '/menus/{id}/tenants',
  tags: [TAG],
  summary: 'Substitui a lista de tenants vinculados ao menu (set idempotente)',
  description:
    'Recebe a lista completa de tenantIds que devem ficar vinculados. ' +
    'Backend remove os ausentes e insere os novos em uma transação.',
  security: REQUIRES_AUTH,
  request: {
    params: menuIdParamSchema,
    body: { content: { 'application/json': { schema: setMenuTenantsSchema } } },
  },
  responses: {
    204: { description: 'Lista atualizada' },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.put(
  '/menus/:id/tenants',
  requirePermission('menus:write'),
  requirePlatformAccess,
  validateParams(menuIdParamSchema),
  validateBody(setMenuTenantsSchema),
  MenusController.setTenants
);

export default router;
