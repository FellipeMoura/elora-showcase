import { Router, type Router as ExpressRouter } from 'express';
import { GroupsController } from './GroupsController.js';
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
import {
  addMemberSchema,
  createGroupSchema,
  findGroupsQuerySchema,
  groupIdParamSchema,
  groupMemberSchema,
  groupResponseSchema,
  memberParamSchema,
  updateGroupSchema,
} from './GroupsTypes.js';

const TAG = 'Groups';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedGroupsSchema = paginatedSchema(groupResponseSchema, 'PaginatedGroups');
const groupMembersListSchema = z.array(groupMemberSchema).openapi('GroupMembersList');

// Catálogo de grupos é GLOBAL (1:1 com role_code). CRUD restrito à equipe
// Elora (requirePlatformAccess). Tenants leem pra membership e UI; nunca
// criam/editam/deletam grupos.

openApiRegistry.registerPath({
  method: 'get',
  path: '/groups',
  tags: [TAG],
  summary: 'Lista grupos globais',
  security: REQUIRES_AUTH,
  request: { query: findGroupsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedGroupsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/groups',
  requirePermission('groups:read'),
  validateQuery(findGroupsQuerySchema),
  GroupsController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/groups',
  tags: [TAG],
  summary: 'Cria grupo',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createGroupSchema } } },
  },
  responses: {
    201: {
      description: 'Grupo criado',
      content: { 'application/json': { schema: groupResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/groups',
  requirePermission('groups:write'),
  requirePlatformAccess,
  validateBody(createGroupSchema),
  GroupsController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/groups/{id}',
  tags: [TAG],
  summary: 'Busca grupo por ID',
  security: REQUIRES_AUTH,
  request: { params: groupIdParamSchema },
  responses: {
    200: {
      description: 'Grupo encontrado',
      content: { 'application/json': { schema: groupResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/groups/:id',
  requirePermission('groups:read'),
  validateParams(groupIdParamSchema),
  GroupsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/groups/{id}',
  tags: [TAG],
  summary: 'Atualiza grupo (parcial)',
  security: REQUIRES_AUTH,
  request: {
    params: groupIdParamSchema,
    body: { content: { 'application/json': { schema: updateGroupSchema } } },
  },
  responses: {
    200: {
      description: 'Grupo atualizado',
      content: { 'application/json': { schema: groupResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/groups/:id',
  requirePermission('groups:write'),
  requirePlatformAccess,
  validateParams(groupIdParamSchema),
  validateBody(updateGroupSchema),
  GroupsController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/groups/{id}',
  tags: [TAG],
  summary: 'Remove grupo',
  security: REQUIRES_AUTH,
  request: { params: groupIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/groups/:id',
  requirePermission('groups:delete'),
  requirePlatformAccess,
  validateParams(groupIdParamSchema),
  GroupsController.remove
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/groups/{id}/deactivate',
  tags: [TAG],
  summary: 'Desativa grupo',
  security: REQUIRES_AUTH,
  request: { params: groupIdParamSchema },
  responses: {
    200: {
      description: 'Grupo desativado',
      content: { 'application/json': { schema: groupResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/groups/:id/deactivate',
  requirePermission('groups:write'),
  requirePlatformAccess,
  validateParams(groupIdParamSchema),
  GroupsController.deactivate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/groups/{id}/activate',
  tags: [TAG],
  summary: 'Reativa grupo',
  security: REQUIRES_AUTH,
  request: { params: groupIdParamSchema },
  responses: {
    200: {
      description: 'Grupo ativado',
      content: { 'application/json': { schema: groupResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/groups/:id/activate',
  requirePermission('groups:write'),
  requirePlatformAccess,
  validateParams(groupIdParamSchema),
  GroupsController.activate
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/groups/{id}/members',
  tags: [TAG],
  summary: 'Lista membros do grupo',
  security: REQUIRES_AUTH,
  request: { params: groupIdParamSchema },
  responses: {
    200: {
      description: 'Lista de usuários membros',
      content: { 'application/json': { schema: groupMembersListSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/groups/:id/members',
  requirePermission('groups:read'),
  validateParams(groupIdParamSchema),
  GroupsController.listMembers
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/groups/{id}/members',
  tags: [TAG],
  summary: 'Adiciona usuário ao grupo',
  security: REQUIRES_AUTH,
  request: {
    params: groupIdParamSchema,
    body: { content: { 'application/json': { schema: addMemberSchema } } },
  },
  responses: {
    204: { description: 'Adicionado' },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/groups/:id/members',
  requirePermission('groups:write'),
  validateParams(groupIdParamSchema),
  validateBody(addMemberSchema),
  GroupsController.addMember
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/groups/{id}/members/{userId}',
  tags: [TAG],
  summary: 'Remove usuário do grupo',
  security: REQUIRES_AUTH,
  request: { params: memberParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.delete(
  '/groups/:id/members/:userId',
  requirePermission('groups:write'),
  validateParams(memberParamSchema),
  GroupsController.removeMember
);

export default router;
