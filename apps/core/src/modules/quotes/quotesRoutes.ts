import { Router, type Router as ExpressRouter } from 'express';
import { QuotesController } from './QuotesController.js';
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
  closeSaleSchema,
  createQuoteItemSchema,
  createQuoteSchema,
  findQuotesQuerySchema,
  quoteIdParamSchema,
  quoteItemIdParamSchema,
  quoteItemResponseSchema,
  quoteListItemSchema,
  quoteResponseSchema,
  updateQuoteItemSchema,
  updateQuoteSchema,
} from './QuotesTypes.js';
import {
  paymentResponseSchema,
  saleItemResponseSchema,
  saleResponseSchema,
} from '../sales/SalesTypes.js';

const TAG = 'Quotes';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedQuotesSchema = paginatedSchema(
  quoteListItemSchema,
  'PaginatedQuotes'
);

const quoteWithItemsSchema = z
  .object({
    quote: quoteResponseSchema,
    items: z.array(quoteItemResponseSchema),
  })
  .openapi('QuoteWithItems');

const itemListSchema = z
  .object({ items: z.array(quoteItemResponseSchema) })
  .openapi('QuoteItemsList');

const itemMutationResponseSchema = z
  .object({
    item: quoteItemResponseSchema,
    quote: quoteResponseSchema,
  })
  .openapi('QuoteItemMutationResponse');

const itemRemovalResponseSchema = z
  .object({ quote: quoteResponseSchema })
  .openapi('QuoteItemRemovalResponse');

const closeSaleResponseSchema = z
  .object({
    quote: quoteResponseSchema,
    sale: saleResponseSchema,
    items: z.array(saleItemResponseSchema),
    payments: z.array(paymentResponseSchema),
    procedureSessionIds: z.array(z.string().uuid()),
  })
  .openapi('CloseSaleResponse');

// =====================================================================
// Quotes (CRUD)
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/quotes',
  tags: [TAG],
  summary: 'Lista orçamentos do tenant',
  security: REQUIRES_AUTH,
  request: { query: findQuotesQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedQuotesSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/quotes',
  requirePermission('quotes:read'),
  validateQuery(findQuotesQuerySchema),
  QuotesController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/quotes',
  tags: [TAG],
  summary: 'Cria orçamento (status inicial: draft). Emite quote_created.',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createQuoteSchema } } },
  },
  responses: {
    201: {
      description: 'Orçamento criado',
      content: { 'application/json': { schema: quoteResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/quotes',
  requirePermission('quotes:write'),
  validateBody(createQuoteSchema),
  QuotesController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/quotes/{id}',
  tags: [TAG],
  summary: 'Busca orçamento com itens embedded',
  security: REQUIRES_AUTH,
  request: { params: quoteIdParamSchema },
  responses: {
    200: {
      description: 'Encontrado',
      content: { 'application/json': { schema: quoteWithItemsSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/quotes/:id',
  requirePermission('quotes:read'),
  validateParams(quoteIdParamSchema),
  QuotesController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/quotes/{id}',
  tags: [TAG],
  summary: 'Atualiza orçamento (somente em draft)',
  security: REQUIRES_AUTH,
  request: {
    params: quoteIdParamSchema,
    body: { content: { 'application/json': { schema: updateQuoteSchema } } },
  },
  responses: {
    200: {
      description: 'Orçamento atualizado',
      content: { 'application/json': { schema: quoteResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/quotes/:id',
  requirePermission('quotes:write'),
  validateParams(quoteIdParamSchema),
  validateBody(updateQuoteSchema),
  QuotesController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/quotes/{id}',
  tags: [TAG],
  summary: 'Remove orçamento (somente em draft)',
  security: REQUIRES_AUTH,
  request: { params: quoteIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/quotes/:id',
  requirePermission('quotes:delete'),
  validateParams(quoteIdParamSchema),
  QuotesController.remove
);

// =====================================================================
// Items (sub-recurso)
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/quotes/{id}/items',
  tags: [TAG],
  summary: 'Lista itens do orçamento',
  security: REQUIRES_AUTH,
  request: { params: quoteIdParamSchema },
  responses: {
    200: {
      description: 'Itens',
      content: { 'application/json': { schema: itemListSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/quotes/:id/items',
  requirePermission('quotes:read'),
  validateParams(quoteIdParamSchema),
  QuotesController.listItems
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/quotes/{id}/items',
  tags: [TAG],
  summary: 'Adiciona item ao orçamento (somente em draft). Recalcula totalAmount.',
  security: REQUIRES_AUTH,
  request: {
    params: quoteIdParamSchema,
    body: { content: { 'application/json': { schema: createQuoteItemSchema } } },
  },
  responses: {
    201: {
      description: 'Item criado + quote atualizado',
      content: { 'application/json': { schema: itemMutationResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/quotes/:id/items',
  requirePermission('quotes:write'),
  validateParams(quoteIdParamSchema),
  validateBody(createQuoteItemSchema),
  QuotesController.createItem
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/quotes/{id}/items/{itemId}',
  tags: [TAG],
  summary: 'Atualiza item do orçamento (somente em draft). Recalcula totalAmount.',
  security: REQUIRES_AUTH,
  request: {
    params: quoteItemIdParamSchema,
    body: { content: { 'application/json': { schema: updateQuoteItemSchema } } },
  },
  responses: {
    200: {
      description: 'Item atualizado + quote atualizado',
      content: { 'application/json': { schema: itemMutationResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/quotes/:id/items/:itemId',
  requirePermission('quotes:write'),
  validateParams(quoteItemIdParamSchema),
  validateBody(updateQuoteItemSchema),
  QuotesController.updateItem
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/quotes/{id}/items/{itemId}',
  tags: [TAG],
  summary: 'Remove item do orçamento (somente em draft). Recalcula totalAmount.',
  security: REQUIRES_AUTH,
  request: { params: quoteItemIdParamSchema },
  responses: {
    200: {
      description: 'Item removido + quote atualizado',
      content: { 'application/json': { schema: itemRemovalResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/quotes/:id/items/:itemId',
  requirePermission('quotes:write'),
  validateParams(quoteItemIdParamSchema),
  QuotesController.removeItem
);

// =====================================================================
// Transições
// =====================================================================

openApiRegistry.registerPath({
  method: 'post',
  path: '/quotes/{id}/send',
  tags: [TAG],
  summary:
    'Envia o orçamento (draft → sent). Não muda stage da journey — a transição lead/evaluation → sale acontece no fechamento (closeSale, quando o cliente aceita).',
  security: REQUIRES_AUTH,
  request: { params: quoteIdParamSchema },
  responses: {
    200: {
      description: 'Orçamento enviado',
      content: { 'application/json': { schema: quoteResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/quotes/:id/send',
  requirePermission('quotes:write'),
  validateParams(quoteIdParamSchema),
  QuotesController.send
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/quotes/{id}/close-sale',
  tags: [TAG],
  summary:
    'Fecha a venda (sent → accepted). Cria sale + sale_items + payments + procedure_sessions só pros items selecionados. Items não selecionados ficam apenas no histórico do quote. Emite sale_closed. Journey segue em sale até 1ª presença.',
  security: REQUIRES_AUTH,
  request: {
    params: quoteIdParamSchema,
    body: { content: { 'application/json': { schema: closeSaleSchema } } },
  },
  responses: {
    200: {
      description: 'Venda fechada',
      content: { 'application/json': { schema: closeSaleResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/quotes/:id/close-sale',
  requirePermission('quotes:write'),
  validateParams(quoteIdParamSchema),
  validateBody(closeSaleSchema),
  QuotesController.closeSale
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/quotes/{id}/revert-to-draft',
  tags: [TAG],
  summary:
    'Reverte orçamento enviado para rascunho (sent → draft). Permite editar itens e condições. Limpa sentAt e emite quote_reverted_to_draft.',
  security: REQUIRES_AUTH,
  request: { params: quoteIdParamSchema },
  responses: {
    200: {
      description: 'Orçamento revertido para rascunho',
      content: { 'application/json': { schema: quoteResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/quotes/:id/revert-to-draft',
  requirePermission('quotes:write'),
  validateParams(quoteIdParamSchema),
  QuotesController.revertToDraft
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/quotes/{id}/reject',
  tags: [TAG],
  summary: 'Recusa o orçamento (sent → rejected)',
  security: REQUIRES_AUTH,
  request: { params: quoteIdParamSchema },
  responses: {
    200: {
      description: 'Orçamento recusado',
      content: { 'application/json': { schema: quoteResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/quotes/:id/reject',
  requirePermission('quotes:write'),
  validateParams(quoteIdParamSchema),
  QuotesController.reject
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/quotes/{id}/expire',
  tags: [TAG],
  summary:
    'Marca orçamento como expirado (sent → expired). Só permitido após validUntil.',
  security: REQUIRES_AUTH,
  request: { params: quoteIdParamSchema },
  responses: {
    200: {
      description: 'Orçamento expirado',
      content: { 'application/json': { schema: quoteResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/quotes/:id/expire',
  requirePermission('quotes:write'),
  validateParams(quoteIdParamSchema),
  QuotesController.expire
);

export default router;
