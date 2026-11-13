import { Router, type Router as ExpressRouter } from 'express';
import { CashierController } from './CashierController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { loadUserRoles } from '../../shared/middleware/loadUserRoles.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import {
  validateQuery,
} from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  REQUIRES_AUTH,
  openApiRegistry,
  paginatedSchema,
} from '../../shared/openapi/index.js';
import {
  cashierEntrySchema,
  cashierSummarySchema,
  cashierSummaryQuerySchema,
  findCashierEntriesQuerySchema,
} from './CashierTypes.js';

const TAG = 'Cashier';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedCashierEntriesSchema = paginatedSchema(
  cashierEntrySchema,
  'PaginatedCashierEntries'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/cashier/entries',
  tags: [TAG],
  summary:
    'Lista entradas de caixa (parcelas recebidas) no range. Default = dia corrente.',
  description:
    'View operacional dos `payments` com status=paid. Não há entidade ' +
    '"sessão de caixa" no MVP — só leitura. Ordem: paid_at DESC.',
  security: REQUIRES_AUTH,
  request: { query: findCashierEntriesQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: {
        'application/json': { schema: paginatedCashierEntriesSchema },
      },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/cashier/entries',
  requirePermission('cashier:read'),
  validateQuery(findCashierEntriesQuerySchema),
  CashierController.entries
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/cashier/summary',
  tags: [TAG],
  summary:
    'Total recebido + breakdown por método no range. Default = dia corrente.',
  security: REQUIRES_AUTH,
  request: { query: cashierSummaryQuerySchema },
  responses: {
    200: {
      description: 'Resumo agregado',
      content: { 'application/json': { schema: cashierSummarySchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/cashier/summary',
  requirePermission('cashier:read'),
  validateQuery(cashierSummaryQuerySchema),
  CashierController.summary
);

export default router;
