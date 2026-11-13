import { Router, type Router as ExpressRouter } from 'express';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { loadUserRoles } from '../../shared/middleware/loadUserRoles.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import { validateParams } from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  REQUIRES_AUTH,
  openApiRegistry,
} from '../../shared/openapi/index.js';
import { z } from '../../shared/openapi/registry.js';
import { ReportsController } from './ReportsController.js';
import {
  reportResponseSchema,
  reportSlugParamSchema,
  runReportBodySchema,
  runReportResponseSchema,
} from './ReportsTypes.js';

const TAG = 'Reports';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const reportListResponseSchema = z
  .object({ items: z.array(reportResponseSchema) })
  .openapi('ReportList');

// ---- GET /reports ----
openApiRegistry.registerPath({
  method: 'get',
  path: '/reports',
  tags: [TAG],
  summary: 'Lista relatórios visíveis ao usuário autenticado',
  description:
    'Filtra por report_tenants (tenant atual) + report_groups (grupos do user). ' +
    'Cruza com o registry em código pra remover slugs órfãos.',
  security: REQUIRES_AUTH,
  responses: {
    200: {
      description: 'Lista de relatórios',
      content: { 'application/json': { schema: reportListResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/reports',
  requirePermission('reports:read'),
  ReportsController.listVisible
);

// ---- GET /reports/:slug ----
openApiRegistry.registerPath({
  method: 'get',
  path: '/reports/{slug}',
  tags: [TAG],
  summary: 'Metadata do relatório (nome, descrição, categoria)',
  description:
    'Só retorna se o user enxerga o relatório (mesma matriz de GET /reports). ' +
    'Sem paramsSchema serializado por ora — frontend usa form hardcoded por slug.',
  security: REQUIRES_AUTH,
  request: { params: reportSlugParamSchema },
  responses: {
    200: {
      description: 'Metadata do relatório',
      content: { 'application/json': { schema: reportResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/reports/:slug',
  requirePermission('reports:read'),
  validateParams(reportSlugParamSchema),
  ReportsController.getDetail
);

// ---- POST /reports/:slug/run ----
openApiRegistry.registerPath({
  method: 'post',
  path: '/reports/{slug}/run',
  tags: [TAG],
  summary: 'Executa o relatório',
  description:
    'Valida params via paramsSchema do handler (Zod). Shape do body varia ' +
    'por slug — ver paramsSchema de cada handler em modules/reports/handlers/. ' +
    'Resposta: { meta: { generatedAt, tenantId, userId, slug }, data: ... }. ' +
    '`data` varia por slug; renderer dedicado no frontend conhece o shape.',
  security: REQUIRES_AUTH,
  request: {
    params: reportSlugParamSchema,
    body: { content: { 'application/json': { schema: runReportBodySchema } } },
  },
  responses: {
    200: {
      description: 'Resultado do relatório',
      content: { 'application/json': { schema: runReportResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.post(
  '/reports/:slug/run',
  requirePermission('reports:read'),
  validateParams(reportSlugParamSchema),
  ReportsController.run
);

export default router;
