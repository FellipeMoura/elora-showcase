import { Router, type Router as ExpressRouter } from 'express';
import { UsersController } from './UsersController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
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
import {
  createUserSchema,
  findUsersQuerySchema,
  setUserGroupsSchema,
  updateUserSchema,
  userIdParamSchema,
  userWithGroupsSchema,
} from './UsersTypes.js';

const TAG = 'Users';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);

const paginatedUsersSchema = paginatedSchema(userWithGroupsSchema, 'PaginatedUsers');

openApiRegistry.registerPath({
  method: 'get',
  path: '/users',
  tags: [TAG],
  summary: 'Lista usuários do tenant',
  security: REQUIRES_AUTH,
  request: { query: findUsersQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedUsersSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
  },
});

router.get('/users', validateQuery(findUsersQuerySchema), UsersController.find);

openApiRegistry.registerPath({
  method: 'post',
  path: '/users',
  tags: [TAG],
  summary: 'Cria um usuário',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createUserSchema } } },
  },
  responses: {
    201: {
      description: 'Usuário criado',
      content: { 'application/json': { schema: userWithGroupsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    409: ERROR_RESPONSES[409],
  },
});

router.post('/users', validateBody(createUserSchema), UsersController.create);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/users/{id}',
  tags: [TAG],
  summary: 'Atualiza usuário (parcial)',
  security: REQUIRES_AUTH,
  request: {
    params: userIdParamSchema,
    body: { content: { 'application/json': { schema: updateUserSchema } } },
  },
  responses: {
    200: {
      description: 'Usuário atualizado',
      content: { 'application/json': { schema: userWithGroupsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/users/:id',
  validateParams(userIdParamSchema),
  validateBody(updateUserSchema),
  UsersController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/users/{id}',
  tags: [TAG],
  summary: 'Remove usuário',
  security: REQUIRES_AUTH,
  request: { params: userIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/users/:id',
  validateParams(userIdParamSchema),
  UsersController.remove
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/users/{id}/deactivate',
  tags: [TAG],
  summary: 'Desativa o usuário',
  security: REQUIRES_AUTH,
  request: { params: userIdParamSchema },
  responses: {
    200: {
      description: 'Usuário desativado',
      content: { 'application/json': { schema: userWithGroupsSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/users/:id/deactivate',
  validateParams(userIdParamSchema),
  UsersController.deactivate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/users/{id}/activate',
  tags: [TAG],
  summary: 'Reativa o usuário',
  security: REQUIRES_AUTH,
  request: { params: userIdParamSchema },
  responses: {
    200: {
      description: 'Usuário ativado',
      content: { 'application/json': { schema: userWithGroupsSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/users/:id/activate',
  validateParams(userIdParamSchema),
  UsersController.activate
);

openApiRegistry.registerPath({
  method: 'put',
  path: '/users/{id}/groups',
  tags: [TAG],
  summary: 'Substitui a lista de grupos do usuário (set idempotente)',
  description:
    'Tenant-scoped. Backend faz diff: insere os grupos que faltam, ' +
    'remove os ausentes. Valida que todos os IDs existem no catálogo global.',
  security: REQUIRES_AUTH,
  request: {
    params: userIdParamSchema,
    body: { content: { 'application/json': { schema: setUserGroupsSchema } } },
  },
  responses: {
    200: {
      description: 'Usuário com grupos atualizados',
      content: { 'application/json': { schema: userWithGroupsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.put(
  '/users/:id/groups',
  validateParams(userIdParamSchema),
  validateBody(setUserGroupsSchema),
  UsersController.setGroups
);

export default router;
