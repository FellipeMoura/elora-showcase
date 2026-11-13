import { Router, type Router as ExpressRouter } from 'express';
import { SalesController } from './SalesController.js';
import { ContractsController } from '../contracts/ContractsController.js';
import {
  generateConsentTermsResponseSchema,
  saleIdParamSchema as consentTermsSaleIdParamSchema,
} from '../contracts/ContractsTypes.js';
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
  findSalesQuerySchema,
  markPaymentPaidSchema,
  paymentIdParamSchema,
  paymentResponseSchema,
  saleIdParamSchema,
  saleListItemSchema,
  saleResponseSchema,
  saleWithDetailsSchema,
  updatePaymentSchema,
} from './SalesTypes.js';

const TAG = 'Sales';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedSalesSchema = paginatedSchema(saleListItemSchema, 'PaginatedSales');

const paymentMutationResponseSchema = z
  .object({
    payment: paymentResponseSchema,
    sale: saleResponseSchema,
  })
  .openapi('PaymentMutationResponse');

// =====================================================================
// Sales
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/sales',
  tags: [TAG],
  summary: 'Lista vendas fechadas do tenant',
  security: REQUIRES_AUTH,
  request: { query: findSalesQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedSalesSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/sales',
  requirePermission('sales:read'),
  validateQuery(findSalesQuerySchema),
  SalesController.find
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/sales/{id}',
  tags: [TAG],
  summary: 'Detalhe da venda (sale + items + parcelas)',
  security: REQUIRES_AUTH,
  request: { params: saleIdParamSchema },
  responses: {
    200: {
      description: 'Encontrada',
      content: { 'application/json': { schema: saleWithDetailsSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/sales/:id',
  requirePermission('sales:read'),
  validateParams(saleIdParamSchema),
  SalesController.getById
);

// =====================================================================
// Payments (parcelas)
// =====================================================================

openApiRegistry.registerPath({
  method: 'post',
  path: '/sales/{id}/payments/{paymentId}/mark-paid',
  tags: [TAG],
  summary:
    'Marca parcela como paga. Recalcula paid_amount + status da venda. Se todas parcelas pagas, sale.status → paid.',
  security: REQUIRES_AUTH,
  request: {
    params: paymentIdParamSchema,
    body: { content: { 'application/json': { schema: markPaymentPaidSchema } } },
  },
  responses: {
    200: {
      description: 'Parcela marcada como paga',
      content: { 'application/json': { schema: paymentMutationResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/sales/:id/payments/:paymentId/mark-paid',
  requirePermission('sales:write'),
  validateParams(paymentIdParamSchema),
  validateBody(markPaymentPaidSchema),
  SalesController.markPaymentPaid
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/sales/{id}/payments/{paymentId}',
  tags: [TAG],
  summary: 'Edita parcela pendente (amount, dueDate, paymentMethod, notes)',
  security: REQUIRES_AUTH,
  request: {
    params: paymentIdParamSchema,
    body: { content: { 'application/json': { schema: updatePaymentSchema } } },
  },
  responses: {
    200: {
      description: 'Parcela atualizada',
      content: { 'application/json': { schema: paymentMutationResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/sales/:id/payments/:paymentId',
  requirePermission('sales:write'),
  validateParams(paymentIdParamSchema),
  validateBody(updatePaymentSchema),
  SalesController.updatePayment
);

// =====================================================================
// Contratos da venda (Fase 7) — bulk de termos de consentimento.
// Rota mora aqui por convenção REST (recurso aninhado em /sales/:saleId),
// mas o controller é do domínio de contratos.
// =====================================================================

openApiRegistry.registerPath({
  method: 'post',
  path: '/sales/{saleId}/contracts/consent-terms',
  tags: [TAG],
  summary: 'Gera os termos de consentimento pendentes da venda',
  description:
    'Pra cada template de termo que cobre algum procedimento da venda e ainda ' +
    'não tem termo ativo, cria o contrato na ZapSign. Idempotente: termos já ' +
    'gerados são pulados sem custo (pré-check). Dedup por template (2 ' +
    'procedimentos no mesmo template = 1 termo). Erro de provider num template ' +
    'não aborta os demais — vai pra `skipped`.',
  security: REQUIRES_AUTH,
  request: { params: consentTermsSaleIdParamSchema },
  responses: {
    200: {
      description: 'Resumo: termos criados + pulados',
      content: { 'application/json': { schema: generateConsentTermsResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.post(
  '/sales/:saleId/contracts/consent-terms',
  requirePermission('contracts:write'),
  validateParams(consentTermsSaleIdParamSchema),
  ContractsController.generateConsentTermsForSale
);

export default router;
