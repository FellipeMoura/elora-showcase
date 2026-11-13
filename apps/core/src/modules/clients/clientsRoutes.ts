import { Router, type Router as ExpressRouter } from 'express';
import { ClientsController } from './ClientsController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { loadUserRoles } from '../../shared/middleware/loadUserRoles.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
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
  checkClientQuerySchema,
  checkClientResponseSchema,
  clientIdParamSchema,
  clientResponseSchema,
  createClientSchema,
  findClientsQuerySchema,
  updateClientSchema,
} from './ClientsTypes.js';

const TAG = 'Clients';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedClientsSchema = paginatedSchema(clientResponseSchema, 'PaginatedClients');

openApiRegistry.registerPath({
  method: 'get',
  path: '/clients',
  tags: [TAG],
  summary: 'Lista clientes do tenant',
  security: REQUIRES_AUTH,
  request: { query: findClientsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedClientsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/clients',
  requirePermission('clients:read'),
  validateQuery(findClientsQuerySchema),
  ClientsController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/clients',
  tags: [TAG],
  summary: 'Cria cliente',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createClientSchema } } },
  },
  responses: {
    201: {
      description: 'Cliente criado',
      content: { 'application/json': { schema: clientResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/clients',
  requirePermission('clients:write'),
  validateBody(createClientSchema),
  ClientsController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/clients/check',
  tags: [TAG],
  summary: 'Verifica se telefone já tem cliente cadastrado no tenant',
  description:
    'Usado pelo cadastro pra dar feedback em tempo real — número já ' +
    'cadastrado bloqueia submit. Não retorna 404; ausência é resposta ' +
    'válida com `exists=false`.',
  security: REQUIRES_AUTH,
  request: { query: checkClientQuerySchema },
  responses: {
    200: {
      description: 'Resultado da verificação',
      content: { 'application/json': { schema: checkClientResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

// ATENÇÃO: registrar `/clients/check` ANTES de `/clients/:id` — Express
// faz match por ordem e ":id" capturaria "check" se viesse antes.
router.get(
  '/clients/check',
  requirePermission('clients:read'),
  validateQuery(checkClientQuerySchema),
  ClientsController.checkByPhone,
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/clients/{id}',
  tags: [TAG],
  summary: 'Busca cliente por ID',
  security: REQUIRES_AUTH,
  request: { params: clientIdParamSchema },
  responses: {
    200: {
      description: 'Cliente encontrado',
      content: { 'application/json': { schema: clientResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/clients/:id',
  requirePermission('clients:read'),
  validateParams(clientIdParamSchema),
  ClientsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/clients/{id}',
  tags: [TAG],
  summary: 'Atualiza cliente (parcial)',
  security: REQUIRES_AUTH,
  request: {
    params: clientIdParamSchema,
    body: { content: { 'application/json': { schema: updateClientSchema } } },
  },
  responses: {
    200: {
      description: 'Cliente atualizado',
      content: { 'application/json': { schema: clientResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/clients/:id',
  requirePermission('clients:write'),
  validateParams(clientIdParamSchema),
  validateBody(updateClientSchema),
  ClientsController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/clients/{id}',
  tags: [TAG],
  summary: 'Remove cliente (hard delete). Falha em 409 se houver vínculos — desativar é o caminho usual.',
  security: REQUIRES_AUTH,
  request: { params: clientIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/clients/:id',
  requirePermission('clients:delete'),
  validateParams(clientIdParamSchema),
  ClientsController.remove
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/clients/{id}/deactivate',
  tags: [TAG],
  summary: 'Desativa o cliente (soft delete)',
  security: REQUIRES_AUTH,
  request: { params: clientIdParamSchema },
  responses: {
    200: {
      description: 'Cliente desativado',
      content: { 'application/json': { schema: clientResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/clients/:id/deactivate',
  requirePermission('clients:write'),
  validateParams(clientIdParamSchema),
  ClientsController.deactivate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/clients/{id}/activate',
  tags: [TAG],
  summary: 'Reativa o cliente',
  security: REQUIRES_AUTH,
  request: { params: clientIdParamSchema },
  responses: {
    200: {
      description: 'Cliente ativado',
      content: { 'application/json': { schema: clientResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/clients/:id/activate',
  requirePermission('clients:write'),
  validateParams(clientIdParamSchema),
  ClientsController.activate
);

export default router;
