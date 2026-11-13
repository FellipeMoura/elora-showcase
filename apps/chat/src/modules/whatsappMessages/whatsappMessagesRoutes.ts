import { Router, type Router as ExpressRouter } from 'express';
import { WhatsappMessagesController } from './WhatsappMessagesController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import { validateParams } from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  openApiRegistry,
  REQUIRES_AUTH,
} from '../../shared/openapi/index.js';
import {
  whatsappMessageIdParamSchema,
  whatsappMessageResponseSchema,
} from './WhatsappMessagesTypes.js';

const TAG = 'WhatsApp Messages';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);

openApiRegistry.registerPath({
  method: 'get',
  path: '/whatsapp/messages/{id}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Busca mensagem WhatsApp (transport layer) por ID',
  description:
    'Retorna a mensagem da camada de transporte WhatsApp — payload bruto, status do provider, ' +
    'external_id. Pra mensagem domain (com journey_id, body, etc), use GET /conversations/:id/messages.',
  request: { params: whatsappMessageIdParamSchema },
  responses: {
    200: {
      description: 'Mensagem encontrada',
      content: { 'application/json': { schema: whatsappMessageResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/whatsapp/messages/:id',
  requirePermission('chat:manage'),
  validateParams(whatsappMessageIdParamSchema),
  WhatsappMessagesController.getById
);

export default router;
