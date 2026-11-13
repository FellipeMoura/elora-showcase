import { Router, type Router as ExpressRouter } from 'express';
import { TreatmentsController } from './TreatmentsController.js';
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
import { z } from '../../shared/openapi/registry.js';
import {
  closeManuallySchema,
  findTreatmentsQuerySchema,
  treatmentIdParamSchema,
  treatmentListItemSchema,
  treatmentResponseSchema,
  updateTreatmentSchema,
} from './TreatmentsTypes.js';
import { procedureSessionResponseSchema } from '../procedureSessions/ProcedureSessionsTypes.js';

const TAG = 'Treatments';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedTreatmentsSchema = paginatedSchema(
  treatmentListItemSchema,
  'PaginatedTreatments'
);

const treatmentWithSessionsSchema = z
  .object({
    treatment: treatmentResponseSchema,
    sessions: z.array(procedureSessionResponseSchema),
  })
  .openapi('TreatmentWithSessions');

openApiRegistry.registerPath({
  method: 'get',
  path: '/treatments',
  tags: [TAG],
  summary: 'Lista tratamentos do tenant (filtros: journey, cliente, status)',
  security: REQUIRES_AUTH,
  request: { query: findTreatmentsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedTreatmentsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/treatments',
  requirePermission('treatments:read'),
  validateQuery(findTreatmentsQuerySchema),
  TreatmentsController.find
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/treatments/{id}',
  tags: [TAG],
  summary: 'Busca tratamento com sessões embedded',
  security: REQUIRES_AUTH,
  request: { params: treatmentIdParamSchema },
  responses: {
    200: {
      description: 'Tratamento encontrado',
      content: {
        'application/json': { schema: treatmentWithSessionsSchema },
      },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/treatments/:id',
  requirePermission('treatments:read'),
  validateParams(treatmentIdParamSchema),
  TreatmentsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/treatments/{id}',
  tags: [TAG],
  summary:
    'Atualiza nome e/ou observações do treatment. Permitido em qualquer status — edição clínica é livre pós-finalização.',
  security: REQUIRES_AUTH,
  request: {
    params: treatmentIdParamSchema,
    body: { content: { 'application/json': { schema: updateTreatmentSchema } } },
  },
  responses: {
    200: {
      description: 'Tratamento atualizado',
      content: { 'application/json': { schema: treatmentResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.patch(
  '/treatments/:id',
  requirePermission('treatments:write'),
  validateParams(treatmentIdParamSchema),
  validateBody(updateTreatmentSchema),
  TreatmentsController.update
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/treatments/{id}/close-manually',
  tags: [TAG],
  summary:
    'Fecha treatment manualmente (active → manually_closed). Emite treatment_manually_closed; pode cascatear journey treatment → result se for o último ativo.',
  security: REQUIRES_AUTH,
  request: {
    params: treatmentIdParamSchema,
    body: { content: { 'application/json': { schema: closeManuallySchema } } },
  },
  responses: {
    200: {
      description: 'Tratamento fechado manualmente',
      content: { 'application/json': { schema: treatmentResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/treatments/:id/close-manually',
  requirePermission('treatments:write'),
  validateParams(treatmentIdParamSchema),
  validateBody(closeManuallySchema),
  TreatmentsController.closeManually
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/treatments/{id}/reopen',
  tags: [TAG],
  summary:
    'Reabre treatment completed/manually_closed → active. Se journey está em result, volta automaticamente pra treatment.',
  security: REQUIRES_AUTH,
  request: { params: treatmentIdParamSchema },
  responses: {
    200: {
      description: 'Tratamento reaberto',
      content: { 'application/json': { schema: treatmentResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/treatments/:id/reopen',
  requirePermission('treatments:write'),
  validateParams(treatmentIdParamSchema),
  TreatmentsController.reopen
);

export default router;
