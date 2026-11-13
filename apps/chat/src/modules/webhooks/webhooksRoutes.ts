import { Router, type Router as ExpressRouter } from 'express';
import { validateParams } from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  openApiRegistry,
} from '../../shared/openapi/index.js';
import { WebhooksController } from './WebhooksController.js';
import {
  mockWebhookBodySchema,
  webhookChannelParamSchema,
  webhookQueuedResponseSchema,
} from './WebhooksTypes.js';

// Webhook é rota PÚBLICA — não passa por tenantContextMiddleware
// (provider não conhece subdomínio). Tenant é resolvido pelo Controller
// via SECURITY DEFINER function (resolve_channel_tenant).
//
// Evolution v2 envia eventos via POST com body JSON. GET reservado pra
// futura integração que precise de "challenge" (verificação inicial de URL).
const router: ExpressRouter = Router();

openApiRegistry.registerPath({
  method: 'post',
  path: '/webhook/whatsapp/{channelId}',
  tags: ['Webhooks'],
  summary: 'Webhook genérico de WhatsApp (qualquer provider)',
  description:
    'Endpoint público. Resolve tenant via channelId, valida assinatura ' +
    '(adapter-specific), enfileira o payload no BullMQ e responde rápido. ' +
    'O shape do body varia por provider — o exemplo aqui mostra o formato ' +
    'aceito pelo MockAdapter (dev/CI).',
  request: {
    params: webhookChannelParamSchema,
    body: {
      content: { 'application/json': { schema: mockWebhookBodySchema } },
    },
  },
  responses: {
    200: {
      description: 'Enfileirado pra processamento',
      content: { 'application/json': { schema: webhookQueuedResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    410: ERROR_RESPONSES[410],
  },
});

router.post(
  '/webhook/whatsapp/:channelId',
  validateParams(webhookChannelParamSchema),
  WebhooksController.whatsapp
);

export default router;
