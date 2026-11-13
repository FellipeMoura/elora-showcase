import { Router, type Router as ExpressRouter } from 'express';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { loadUserRoles } from '../../shared/middleware/loadUserRoles.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import { validateBody } from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  REQUIRES_AUTH,
  openApiRegistry,
} from '../../shared/openapi/index.js';
import { PushSubscriptionsController } from './PushSubscriptionsController.js';
import {
  registerPushSubscriptionSchema,
  unregisterPushSubscriptionSchema,
  vapidPublicKeyResponseSchema,
} from './PushSubscriptionsTypes.js';

const TAG = 'Push';
const router: ExpressRouter = Router();

// =====================================================================
// /push/* — assinaturas Web Push do aparelho do usuário corrente. Hoje o
// único push é mensagem nova do chat, então exige `chat:use`. O DELETE
// fica fora do requirePermission: quem perdeu o acesso ao chat ainda
// precisa conseguir desligar o aparelho (logout).
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/push/vapid-public-key',
  tags: [TAG],
  summary: 'Chave pública VAPID pro pushManager.subscribe()',
  security: REQUIRES_AUTH,
  responses: {
    200: {
      description: 'Chave pública (base64url)',
      content: { 'application/json': { schema: vapidPublicKeyResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/push/vapid-public-key',
  ensureAuthenticated,
  loadUserRoles,
  requirePermission('chat:use'),
  PushSubscriptionsController.getPublicKey
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/push/subscriptions',
  tags: [TAG],
  summary: 'Registra (ou reassume) a assinatura push deste aparelho',
  description:
    'Body = `PushSubscription.toJSON()`. Upsert por endpoint: o mesmo aparelho ' +
    'logado por outro usuário do tenant passa a notificar o novo usuário.',
  security: REQUIRES_AUTH,
  request: {
    body: {
      content: { 'application/json': { schema: registerPushSubscriptionSchema } },
    },
  },
  responses: {
    204: { description: 'Assinatura registrada' },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.post(
  '/push/subscriptions',
  ensureAuthenticated,
  loadUserRoles,
  requirePermission('chat:use'),
  validateBody(registerPushSubscriptionSchema),
  PushSubscriptionsController.register
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/push/subscriptions',
  tags: [TAG],
  summary: 'Remove a assinatura push deste aparelho (logout / desativar)',
  security: REQUIRES_AUTH,
  request: {
    body: {
      content: { 'application/json': { schema: unregisterPushSubscriptionSchema } },
    },
  },
  responses: {
    204: { description: 'Removida (idempotente)' },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
  },
});

router.delete(
  '/push/subscriptions',
  ensureAuthenticated,
  validateBody(unregisterPushSubscriptionSchema),
  PushSubscriptionsController.unregister
);

export default router;
