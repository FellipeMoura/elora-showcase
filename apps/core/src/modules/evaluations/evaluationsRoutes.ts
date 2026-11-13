import { Router, type Router as ExpressRouter } from 'express';
import { EvaluationsController } from './EvaluationsController.js';
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
  createEvaluationSchema,
  evaluationIdParamSchema,
  evaluationListItemSchema,
  evaluationResponseSchema,
  findEvaluationsQuerySchema,
  updateEvaluationSchema,
} from './EvaluationsTypes.js';

const TAG = 'Evaluations';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

// Listagem carrega join com cliente + appointment (latest não-cancelado).
// Endpoints unitários (GET /:id, POST, PATCH, /cancel) seguem usando o shape
// nu de evaluationResponseSchema.
const paginatedSchemaForList = paginatedSchema(
  evaluationListItemSchema,
  'PaginatedEvaluations'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/evaluations',
  tags: [TAG],
  summary:
    'Lista avaliações. Avaliação é entidade clínica (separada do slot da agenda).',
  security: REQUIRES_AUTH,
  request: { query: findEvaluationsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedSchemaForList } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/evaluations',
  requirePermission('evaluations:read'),
  validateQuery(findEvaluationsQuerySchema),
  EvaluationsController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/evaluations',
  tags: [TAG],
  summary:
    'Cria avaliação clínica standalone (sem appointment). Status inicial: pending. Quando o flow começa pelo agendamento, a evaluation é criada inline em /appointments e este endpoint não é necessário.',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createEvaluationSchema } } },
  },
  responses: {
    201: {
      description: 'Avaliação criada',
      content: { 'application/json': { schema: evaluationResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/evaluations',
  requirePermission('evaluations:write'),
  validateBody(createEvaluationSchema),
  EvaluationsController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/evaluations/{id}',
  tags: [TAG],
  summary: 'Busca avaliação por ID',
  security: REQUIRES_AUTH,
  request: { params: evaluationIdParamSchema },
  responses: {
    200: {
      description: 'Avaliação encontrada',
      content: { 'application/json': { schema: evaluationResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/evaluations/:id',
  requirePermission('evaluations:read'),
  validateParams(evaluationIdParamSchema),
  EvaluationsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/evaluations/{id}',
  tags: [TAG],
  summary:
    'Atualiza kind e/ou observações gerais. Permitido em qualquer status — edição clínica é livre pós-finalização.',
  security: REQUIRES_AUTH,
  request: {
    params: evaluationIdParamSchema,
    body: { content: { 'application/json': { schema: updateEvaluationSchema } } },
  },
  responses: {
    200: {
      description: 'Avaliação atualizada',
      content: { 'application/json': { schema: evaluationResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.patch(
  '/evaluations/:id',
  requirePermission('evaluations:write'),
  validateParams(evaluationIdParamSchema),
  validateBody(updateEvaluationSchema),
  EvaluationsController.update
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/evaluations/{id}/cancel',
  tags: [TAG],
  summary:
    'Cancela avaliação (status=cancelled). Só permitido se status atual=pending. Cancelamento do appointment associado deve ser feito separadamente.',
  security: REQUIRES_AUTH,
  request: { params: evaluationIdParamSchema },
  responses: {
    200: {
      description: 'Avaliação cancelada',
      content: { 'application/json': { schema: evaluationResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/evaluations/:id/cancel',
  requirePermission('evaluations:write'),
  validateParams(evaluationIdParamSchema),
  EvaluationsController.cancel
);

export default router;
