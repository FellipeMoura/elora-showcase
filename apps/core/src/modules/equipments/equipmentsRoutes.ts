import { Router, type Router as ExpressRouter } from 'express';
import { EquipmentsController } from './EquipmentsController.js';
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
  createEquipmentSchema,
  equipmentIdParamSchema,
  equipmentResponseSchema,
  findEquipmentsQuerySchema,
  updateEquipmentSchema,
} from './EquipmentsTypes.js';

const TAG = 'Equipments';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedEquipmentsSchema = paginatedSchema(
  equipmentResponseSchema,
  'PaginatedEquipments'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/equipments',
  tags: [TAG],
  summary: 'Lista equipamentos do tenant',
  security: REQUIRES_AUTH,
  request: { query: findEquipmentsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedEquipmentsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/equipments',
  requirePermission('equipments:read'),
  validateQuery(findEquipmentsQuerySchema),
  EquipmentsController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/equipments',
  tags: [TAG],
  summary: 'Cria equipamento',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createEquipmentSchema } } },
  },
  responses: {
    201: {
      description: 'Equipamento criado',
      content: { 'application/json': { schema: equipmentResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/equipments',
  requirePermission('equipments:write'),
  validateBody(createEquipmentSchema),
  EquipmentsController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/equipments/{id}',
  tags: [TAG],
  summary: 'Busca equipamento por ID',
  security: REQUIRES_AUTH,
  request: { params: equipmentIdParamSchema },
  responses: {
    200: {
      description: 'Equipamento encontrado',
      content: { 'application/json': { schema: equipmentResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/equipments/:id',
  requirePermission('equipments:read'),
  validateParams(equipmentIdParamSchema),
  EquipmentsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/equipments/{id}',
  tags: [TAG],
  summary: 'Atualiza equipamento (parcial)',
  security: REQUIRES_AUTH,
  request: {
    params: equipmentIdParamSchema,
    body: { content: { 'application/json': { schema: updateEquipmentSchema } } },
  },
  responses: {
    200: {
      description: 'Equipamento atualizado',
      content: { 'application/json': { schema: equipmentResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/equipments/:id',
  requirePermission('equipments:write'),
  validateParams(equipmentIdParamSchema),
  validateBody(updateEquipmentSchema),
  EquipmentsController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/equipments/{id}',
  tags: [TAG],
  summary:
    'Remove equipamento (hard delete). Appointments com FK SET NULL não bloqueiam.',
  security: REQUIRES_AUTH,
  request: { params: equipmentIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/equipments/:id',
  requirePermission('equipments:delete'),
  validateParams(equipmentIdParamSchema),
  EquipmentsController.remove
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/equipments/{id}/deactivate',
  tags: [TAG],
  summary: 'Desativa o equipamento (soft delete)',
  security: REQUIRES_AUTH,
  request: { params: equipmentIdParamSchema },
  responses: {
    200: {
      description: 'Equipamento desativado',
      content: { 'application/json': { schema: equipmentResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/equipments/:id/deactivate',
  requirePermission('equipments:write'),
  validateParams(equipmentIdParamSchema),
  EquipmentsController.deactivate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/equipments/{id}/activate',
  tags: [TAG],
  summary: 'Reativa o equipamento',
  security: REQUIRES_AUTH,
  request: { params: equipmentIdParamSchema },
  responses: {
    200: {
      description: 'Equipamento ativado',
      content: { 'application/json': { schema: equipmentResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/equipments/:id/activate',
  requirePermission('equipments:write'),
  validateParams(equipmentIdParamSchema),
  EquipmentsController.activate
);

export default router;
