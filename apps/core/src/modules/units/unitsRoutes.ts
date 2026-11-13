import { Router, type Router as ExpressRouter } from 'express';
import { UnitsController } from './UnitsController.js';
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
  createUnitSchema,
  findUnitsQuerySchema,
  unitIdParamSchema,
  unitResponseSchema,
  updateUnitSchema,
} from './UnitsTypes.js';

const TAG = 'Units';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedUnitsSchema = paginatedSchema(unitResponseSchema, 'PaginatedUnits');

openApiRegistry.registerPath({
  method: 'get',
  path: '/units',
  tags: [TAG],
  summary: 'Lista salas do tenant',
  security: REQUIRES_AUTH,
  request: { query: findUnitsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedUnitsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/units',
  requirePermission('units:read'),
  validateQuery(findUnitsQuerySchema),
  UnitsController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/units',
  tags: [TAG],
  summary: 'Cria sala',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createUnitSchema } } },
  },
  responses: {
    201: {
      description: 'Sala criada',
      content: { 'application/json': { schema: unitResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/units',
  requirePermission('units:write'),
  validateBody(createUnitSchema),
  UnitsController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/units/{id}',
  tags: [TAG],
  summary: 'Busca sala por ID',
  security: REQUIRES_AUTH,
  request: { params: unitIdParamSchema },
  responses: {
    200: {
      description: 'Sala encontrada',
      content: { 'application/json': { schema: unitResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/units/:id',
  requirePermission('units:read'),
  validateParams(unitIdParamSchema),
  UnitsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/units/{id}',
  tags: [TAG],
  summary: 'Atualiza sala (parcial)',
  security: REQUIRES_AUTH,
  request: {
    params: unitIdParamSchema,
    body: { content: { 'application/json': { schema: updateUnitSchema } } },
  },
  responses: {
    200: {
      description: 'Sala atualizada',
      content: { 'application/json': { schema: unitResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/units/:id',
  requirePermission('units:write'),
  validateParams(unitIdParamSchema),
  validateBody(updateUnitSchema),
  UnitsController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/units/{id}',
  tags: [TAG],
  summary:
    'Remove sala (hard delete). Falha em 409 se houver agendamentos vinculados — desativar é o caminho usual.',
  security: REQUIRES_AUTH,
  request: { params: unitIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/units/:id',
  requirePermission('units:delete'),
  validateParams(unitIdParamSchema),
  UnitsController.remove
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/units/{id}/deactivate',
  tags: [TAG],
  summary: 'Desativa a sala (soft delete)',
  security: REQUIRES_AUTH,
  request: { params: unitIdParamSchema },
  responses: {
    200: {
      description: 'Sala desativada',
      content: { 'application/json': { schema: unitResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/units/:id/deactivate',
  requirePermission('units:write'),
  validateParams(unitIdParamSchema),
  UnitsController.deactivate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/units/{id}/activate',
  tags: [TAG],
  summary: 'Reativa a sala',
  security: REQUIRES_AUTH,
  request: { params: unitIdParamSchema },
  responses: {
    200: {
      description: 'Sala ativada',
      content: { 'application/json': { schema: unitResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/units/:id/activate',
  requirePermission('units:write'),
  validateParams(unitIdParamSchema),
  UnitsController.activate
);

export default router;
