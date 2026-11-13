import { Router, type Router as ExpressRouter } from 'express';
import { ConversationsController } from './ConversationsController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
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
  conversationIdParamSchema,
  conversationResponseSchema,
  conversationWithClientResponseSchema,
  findConversationsQuerySchema,
  findOrCreateConversationSchema,
} from './ConversationsTypes.js';

const TAG = 'Conversations';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);

const paginatedConversationsSchema = paginatedSchema(
  conversationWithClientResponseSchema,
  'PaginatedConversations'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/conversations',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Lista conversas do tenant (com dados do cliente embedded)',
  request: { query: findConversationsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada — mais recentes primeiro (por lastMessageAt)',
      content: { 'application/json': { schema: paginatedConversationsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
  },
});

router.get(
  '/conversations',
  validateQuery(findConversationsQuerySchema),
  ConversationsController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/conversations',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Find or create — abre conversa pro cliente (idempotente)',
  description:
    'Cria a conversation se cliente ainda não tem; caso contrário retorna a ' +
    'existente. Útil pra UI "abrir chat com cliente" antes de qualquer inbound.',
  request: {
    body: { content: { 'application/json': { schema: findOrCreateConversationSchema } } },
  },
  responses: {
    200: {
      description: 'Conversation existente ou recém-criada',
      content: { 'application/json': { schema: conversationResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.post(
  '/conversations',
  validateBody(findOrCreateConversationSchema),
  ConversationsController.findOrCreate
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/conversations/{id}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Busca conversation por ID (com cliente embedded)',
  request: { params: conversationIdParamSchema },
  responses: {
    200: {
      description: 'Conversation encontrada',
      content: { 'application/json': { schema: conversationWithClientResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/conversations/:id',
  validateParams(conversationIdParamSchema),
  ConversationsController.getById
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/conversations/{id}/mark-seen',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Marca conversa como vista pelo staff (zera unreadCount)',
  description:
    'Atualiza `conversations.last_staff_seen_at = NOW()`. V1: semântica global — ' +
    'qualquer staff abrir zera o unread pra todos os usuários do tenant. Per-user ' +
    'tracking fica como evolução futura. Idempotente.',
  request: { params: conversationIdParamSchema },
  responses: {
    204: { description: 'Conversa marcada como vista' },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.post(
  '/conversations/:id/mark-seen',
  validateParams(conversationIdParamSchema),
  ConversationsController.markSeen
);

export default router;
