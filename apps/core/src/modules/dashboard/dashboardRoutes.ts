import { Router, type Router as ExpressRouter } from 'express';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { loadUserRoles } from '../../shared/middleware/loadUserRoles.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import { validateQuery } from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  REQUIRES_AUTH,
  openApiRegistry,
} from '../../shared/openapi/index.js';
import { DashboardController } from './DashboardController.js';
import {
  dashboardSummaryQuerySchema,
  dashboardSummaryResponseSchema,
} from './DashboardTypes.js';

const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const TAG_DASHBOARD = 'Dashboard';

openApiRegistry.registerPath({
  method: 'get',
  path: '/dashboard/summary',
  tags: [TAG_DASHBOARD],
  summary: 'Resumo agregado da home (todos os blocos num único JSON)',
  description:
    'Devolve KPIs (bloco A) + funil (B) + evolução (E) + distribuição (C) + ' +
    'listas operacionais (D) em uma só resposta. O filtro `period` aplica a ' +
    'todos os blocos exceto A3 (agendamentos de hoje) e bloco D (semântica ' +
    'fixa). Nesta fase só o bloco A vem preenchido — B/C/D/E retornam ' +
    'estruturas vazias enquanto são implementados.',
  security: REQUIRES_AUTH,
  request: { query: dashboardSummaryQuerySchema },
  responses: {
    200: {
      description: 'Resumo do dashboard',
      content: {
        'application/json': { schema: dashboardSummaryResponseSchema },
      },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    500: ERROR_RESPONSES[500],
  },
});

router.get(
  '/dashboard/summary',
  requirePermission('dashboard:read'),
  validateQuery(dashboardSummaryQuerySchema),
  DashboardController.summary,
);

export default router;
