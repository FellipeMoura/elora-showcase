import { Router, type Router as ExpressRouter } from 'express';
import { WhatsappChannelsController } from './WhatsappChannelsController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  openApiRegistry,
  paginatedSchema,
  REQUIRES_AUTH,
} from '../../shared/openapi/index.js';
import {
  channelConnectionStateResponseSchema,
  channelIdParamSchema,
  channelQrCodeResponseSchema,
  createChannelSchema,
  findChannelsQuerySchema,
  purgeChannelConversationsResponseSchema,
  updateChannelSchema,
  whatsappChannelResponseSchema,
} from './WhatsappChannelsTypes.js';

const router: ExpressRouter = Router();

router.use(ensureAuthenticated);

// Permissões granulares ('whatsapp:channels:read/write/delete') entram quando
// o sistema de permissions for compartilhado entre core e chat. Por enquanto,
// qualquer usuário autenticado do tenant pode gerenciar canais. TODO.

// =====================================================================
// OpenAPI: tag única "WhatsApp Channels" agrupa estes endpoints em uma
// pasta no Postman. `registerPath` declara request/response shapes — o
// Controller continua sendo a única fonte de comportamento.
// =====================================================================
const TAG = 'WhatsApp Channels';

const paginatedChannelsSchema = paginatedSchema(
  whatsappChannelResponseSchema,
  'PaginatedWhatsappChannels'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/whatsapp/channels',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Lista canais WhatsApp do tenant',
  request: { query: findChannelsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedChannelsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
  },
});

router.get(
  '/whatsapp/channels',
  validateQuery(findChannelsQuerySchema),
  WhatsappChannelsController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/whatsapp/channels',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Cria um canal WhatsApp',
  request: {
    body: {
      content: { 'application/json': { schema: createChannelSchema } },
    },
  },
  responses: {
    201: {
      description: 'Canal criado',
      content: { 'application/json': { schema: whatsappChannelResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/whatsapp/channels',
  requirePermission('chat:manage'),
  validateBody(createChannelSchema),
  WhatsappChannelsController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/whatsapp/channels/{id}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Busca canal por ID',
  request: { params: channelIdParamSchema },
  responses: {
    200: {
      description: 'Canal encontrado',
      content: { 'application/json': { schema: whatsappChannelResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/whatsapp/channels/:id',
  validateParams(channelIdParamSchema),
  WhatsappChannelsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/whatsapp/channels/{id}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Atualiza dados do canal (parcial)',
  request: {
    params: channelIdParamSchema,
    body: {
      content: { 'application/json': { schema: updateChannelSchema } },
    },
  },
  responses: {
    200: {
      description: 'Canal atualizado',
      content: { 'application/json': { schema: whatsappChannelResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/whatsapp/channels/:id',
  requirePermission('chat:manage'),
  validateParams(channelIdParamSchema),
  validateBody(updateChannelSchema),
  WhatsappChannelsController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/whatsapp/channels/{id}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Remove canal (falha se houver contatos/conversas vinculados)',
  request: { params: channelIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/whatsapp/channels/:id',
  requirePermission('chat:manage'),
  validateParams(channelIdParamSchema),
  WhatsappChannelsController.remove
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/whatsapp/channels/{id}/deactivate',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Desativa o canal sem removê-lo',
  request: { params: channelIdParamSchema },
  responses: {
    200: {
      description: 'Canal desativado',
      content: { 'application/json': { schema: whatsappChannelResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/whatsapp/channels/:id/deactivate',
  requirePermission('chat:manage'),
  validateParams(channelIdParamSchema),
  WhatsappChannelsController.deactivate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/whatsapp/channels/{id}/activate',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Reativa o canal',
  request: { params: channelIdParamSchema },
  responses: {
    200: {
      description: 'Canal ativado',
      content: { 'application/json': { schema: whatsappChannelResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/whatsapp/channels/:id/activate',
  requirePermission('chat:manage'),
  validateParams(channelIdParamSchema),
  WhatsappChannelsController.activate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/whatsapp/channels/{id}/purge-conversations',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Exclui (hard delete) todas as conversas e contatos do canal',
  description:
    'Apaga conversas, mensagens, contatos e mensagens transport do canal. ' +
    'O canal e sua conexão permanecem. Irreversível — pensado pra resetar o tenant demo.',
  request: { params: channelIdParamSchema },
  responses: {
    200: {
      description: 'Quantidades excluídas',
      content: {
        'application/json': { schema: purgeChannelConversationsResponseSchema },
      },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.post(
  '/whatsapp/channels/:id/purge-conversations',
  requirePermission('chat:manage'),
  validateParams(channelIdParamSchema),
  WhatsappChannelsController.purgeConversations
);

// ===================================================================
// Provisionamento Evolution
// ===================================================================

openApiRegistry.registerPath({
  method: 'post',
  path: '/whatsapp/channels/{id}/provision',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Cria instância no Evolution e grava credenciais no canal',
  description:
    'Idempotente. Se o canal já tem `provider_config.instanceName/apiKey/webhookToken`, ' +
    'retorna sem reprovisionar. Falha 409 se canal é mock. Configura webhook com ' +
    'Bearer token (validado pelo EvolutionAdapter.verifyWebhook).',
  request: { params: channelIdParamSchema },
  responses: {
    200: {
      description: 'Canal provisionado (provider_config preenchido)',
      content: { 'application/json': { schema: whatsappChannelResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
    502: ERROR_RESPONSES[500],
  },
});

router.post(
  '/whatsapp/channels/:id/provision',
  requirePermission('chat:manage'),
  validateParams(channelIdParamSchema),
  WhatsappChannelsController.provision
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/whatsapp/channels/{id}/qr',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Retorna QR code base64 da instância pareando',
  description:
    'Frontend renderiza o `base64` como `<img src>` pro admin escanear no app ' +
    'do WhatsApp. `base64=null` quando a instância já está conectada — consulte ' +
    '/connection-state pra confirmar.',
  request: { params: channelIdParamSchema },
  responses: {
    200: {
      description: 'QR atual ou null se conectado',
      content: { 'application/json': { schema: channelQrCodeResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
    502: ERROR_RESPONSES[500],
  },
});

router.get(
  '/whatsapp/channels/:id/qr',
  requirePermission('chat:manage'),
  validateParams(channelIdParamSchema),
  WhatsappChannelsController.getQrCode
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/whatsapp/channels/{id}/connection-state',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Estado atual da sessão WhatsApp (open/connecting/closed)',
  description:
    'Canais mock retornam sempre `open`. Canais Evolution não-provisionados ' +
    'retornam `closed` com motivo no `raw.reason`.',
  request: { params: channelIdParamSchema },
  responses: {
    200: {
      description: 'Estado atual da conexão',
      content: { 'application/json': { schema: channelConnectionStateResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    502: ERROR_RESPONSES[500],
  },
});

router.get(
  '/whatsapp/channels/:id/connection-state',
  validateParams(channelIdParamSchema),
  WhatsappChannelsController.getConnectionState
);

export default router;
