import { Router, type Router as ExpressRouter } from 'express';
import { ProceduresController } from './ProceduresController.js';
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
  createProcedureSchema,
  findProceduresQuerySchema,
  procedureIdParamSchema,
  procedureResponseSchema,
  updateProcedureSchema,
} from './ProceduresTypes.js';

const TAG = 'Procedures';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedProceduresSchema = paginatedSchema(
  procedureResponseSchema,
  'PaginatedProcedures'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/procedures',
  tags: [TAG],
  summary: 'Lista procedimentos do tenant',
  security: REQUIRES_AUTH,
  request: { query: findProceduresQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedProceduresSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/procedures',
  requirePermission('procedures:read'),
  validateQuery(findProceduresQuerySchema),
  ProceduresController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/procedures',
  tags: [TAG],
  summary: 'Cria procedimento',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createProcedureSchema } } },
  },
  responses: {
    201: {
      description: 'Procedimento criado',
      content: { 'application/json': { schema: procedureResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/procedures',
  requirePermission('procedures:write'),
  validateBody(createProcedureSchema),
  ProceduresController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/procedures/{id}',
  tags: [TAG],
  summary: 'Busca procedimento por ID',
  security: REQUIRES_AUTH,
  request: { params: procedureIdParamSchema },
  responses: {
    200: {
      description: 'Procedimento encontrado',
      content: { 'application/json': { schema: procedureResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/procedures/:id',
  requirePermission('procedures:read'),
  validateParams(procedureIdParamSchema),
  ProceduresController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/procedures/{id}',
  tags: [TAG],
  summary: 'Atualiza procedimento (parcial)',
  security: REQUIRES_AUTH,
  request: {
    params: procedureIdParamSchema,
    body: { content: { 'application/json': { schema: updateProcedureSchema } } },
  },
  responses: {
    200: {
      description: 'Procedimento atualizado',
      content: { 'application/json': { schema: procedureResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/procedures/:id',
  requirePermission('procedures:write'),
  validateParams(procedureIdParamSchema),
  validateBody(updateProcedureSchema),
  ProceduresController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/procedures/{id}',
  tags: [TAG],
  summary:
    'Remove procedimento (hard delete). Falha em 409 se houver vínculos — desativar é o caminho usual.',
  security: REQUIRES_AUTH,
  request: { params: procedureIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/procedures/:id',
  requirePermission('procedures:delete'),
  validateParams(procedureIdParamSchema),
  ProceduresController.remove
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/procedures/{id}/deactivate',
  tags: [TAG],
  summary: 'Desativa o procedimento (soft delete)',
  security: REQUIRES_AUTH,
  request: { params: procedureIdParamSchema },
  responses: {
    200: {
      description: 'Procedimento desativado',
      content: { 'application/json': { schema: procedureResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/procedures/:id/deactivate',
  requirePermission('procedures:write'),
  validateParams(procedureIdParamSchema),
  ProceduresController.deactivate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/procedures/{id}/activate',
  tags: [TAG],
  summary: 'Reativa o procedimento',
  security: REQUIRES_AUTH,
  request: { params: procedureIdParamSchema },
  responses: {
    200: {
      description: 'Procedimento ativado',
      content: { 'application/json': { schema: procedureResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/procedures/:id/activate',
  requirePermission('procedures:write'),
  validateParams(procedureIdParamSchema),
  ProceduresController.activate
);

export default router;
