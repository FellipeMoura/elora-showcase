import { Router, type Router as ExpressRouter } from 'express';
import { LeadsController } from './LeadsController.js';
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
  createLeadSchema,
  findLeadsQuerySchema,
  leadCardSchema,
  leadDetailSchema,
  leadIdParamSchema,
  leadsBoardResponseSchema,
  leadsCountsResponseSchema,
  markLeadLostSchema,
  updateLeadSubstageSchema,
} from './LeadsTypes.js';

const TAG = 'Leads';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedLeadsSchema = paginatedSchema(leadCardSchema, 'PaginatedLeads');

// =====================================================================
// GET /leads/board — kanban
// =====================================================================
openApiRegistry.registerPath({
  method: 'get',
  path: '/leads/board',
  tags: [TAG],
  summary:
    'Kanban de leads — uma página de cada coluna (substage) + totals agregados.',
  security: REQUIRES_AUTH,
  request: { query: findLeadsQuerySchema },
  responses: {
    200: {
      description: 'Board com colunas + totais',
      content: { 'application/json': { schema: leadsBoardResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/leads/board',
  requirePermission('journeys:read'),
  validateQuery(findLeadsQuerySchema),
  LeadsController.board
);

// =====================================================================
// GET /leads/counts — só totais por substage
// =====================================================================
openApiRegistry.registerPath({
  method: 'get',
  path: '/leads/counts',
  tags: [TAG],
  summary: 'Totais agregados por substage (badges, indicadores).',
  security: REQUIRES_AUTH,
  request: { query: findLeadsQuerySchema },
  responses: {
    200: {
      description: 'Totais por substage',
      content: { 'application/json': { schema: leadsCountsResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/leads/counts',
  requirePermission('journeys:read'),
  validateQuery(findLeadsQuerySchema),
  LeadsController.counts
);

// =====================================================================
// GET /leads — flat list com filtros e paginação
// =====================================================================
openApiRegistry.registerPath({
  method: 'get',
  path: '/leads',
  tags: [TAG],
  summary:
    'Lista plana de leads (filtros: substage, source, ageMin/Max, channelId, search).',
  security: REQUIRES_AUTH,
  request: { query: findLeadsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedLeadsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/leads',
  requirePermission('journeys:read'),
  validateQuery(findLeadsQuerySchema),
  LeadsController.find
);

// =====================================================================
// POST /leads — criação manual
// =====================================================================
openApiRegistry.registerPath({
  method: 'post',
  path: '/leads',
  tags: [TAG],
  summary:
    'Cria lead manualmente (recepcionista). Falha 409 se cliente já tem jornada ativa.',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createLeadSchema } } },
  },
  responses: {
    201: {
      description: 'Lead criado',
      content: { 'application/json': { schema: leadDetailSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/leads',
  requirePermission('journeys:write'),
  validateBody(createLeadSchema),
  LeadsController.create
);

// =====================================================================
// GET /leads/:id — detalhe enriquecido
// =====================================================================
openApiRegistry.registerPath({
  method: 'get',
  path: '/leads/{id}',
  tags: [TAG],
  summary:
    'Detalhe enriquecido do lead (cliente, conversação, próximo appointment, último quote).',
  security: REQUIRES_AUTH,
  request: { params: leadIdParamSchema },
  responses: {
    200: {
      description: 'Lead encontrado',
      content: { 'application/json': { schema: leadDetailSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/leads/:id',
  requirePermission('journeys:read'),
  validateParams(leadIdParamSchema),
  LeadsController.getById
);

// =====================================================================
// PUT /leads/:id/substage — override manual
// =====================================================================
openApiRegistry.registerPath({
  method: 'put',
  path: '/leads/{id}/substage',
  tags: [TAG],
  summary:
    'Override manual do substage (admin/debug). Cascata posterior pode reescrever.',
  security: REQUIRES_AUTH,
  request: {
    params: leadIdParamSchema,
    body: { content: { 'application/json': { schema: updateLeadSubstageSchema } } },
  },
  responses: {
    200: {
      description: 'Substage atualizado',
      content: { 'application/json': { schema: leadDetailSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.put(
  '/leads/:id/substage',
  requirePermission('journeys:write'),
  validateParams(leadIdParamSchema),
  validateBody(updateLeadSubstageSchema),
  LeadsController.setSubstage
);

// =====================================================================
// POST /leads/:id/recompute-substage — força recompute
// =====================================================================
openApiRegistry.registerPath({
  method: 'post',
  path: '/leads/{id}/recompute-substage',
  tags: [TAG],
  summary:
    'Recalcula substage inspecionando messages/appointments/quotes (debug tool).',
  security: REQUIRES_AUTH,
  request: { params: leadIdParamSchema },
  responses: {
    200: {
      description: 'Substage recomputado',
      content: { 'application/json': { schema: leadDetailSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.post(
  '/leads/:id/recompute-substage',
  requirePermission('journeys:write'),
  validateParams(leadIdParamSchema),
  LeadsController.recomputeSubstage
);

// =====================================================================
// POST /leads/:id/recycle — recepcionista retoma cliente perdido
// =====================================================================
openApiRegistry.registerPath({
  method: 'post',
  path: '/leads/{id}/recycle',
  tags: [TAG],
  summary:
    'Cria journey nova a partir de uma perdida (recepcionista retoma com nova proposta). Falha 409 se journey atual não está lost ou cliente já tem ativa.',
  security: REQUIRES_AUTH,
  request: { params: leadIdParamSchema },
  responses: {
    201: {
      description: 'Journey reciclada criada (source=recycling)',
      content: { 'application/json': { schema: leadDetailSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/leads/:id/recycle',
  requirePermission('journeys:write'),
  validateParams(leadIdParamSchema),
  LeadsController.recycle
);

// =====================================================================
// POST /leads/:id/mark-lost — proxy pra journeys/:id/lost
// =====================================================================
openApiRegistry.registerPath({
  method: 'post',
  path: '/leads/{id}/mark-lost',
  tags: [TAG],
  summary: 'Marca lead como perdido. Falha 409 se jornada já avançou de lead.',
  security: REQUIRES_AUTH,
  request: {
    params: leadIdParamSchema,
    body: { content: { 'application/json': { schema: markLeadLostSchema } } },
  },
  responses: {
    200: {
      description: 'Lead marcado como perdido',
      content: { 'application/json': { schema: leadDetailSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/leads/:id/mark-lost',
  requirePermission('journeys:write'),
  validateParams(leadIdParamSchema),
  validateBody(markLeadLostSchema),
  LeadsController.markLost
);

export default router;
