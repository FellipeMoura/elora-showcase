import { Router, type Router as ExpressRouter } from 'express';
import { ConversationTagsController } from './ConversationTagsController.js';
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
import {
  conversationTagIdParamSchema,
  conversationTagResponseSchema,
  createConversationTagSchema,
  findConversationTagsQuerySchema,
  replaceConversationTagsResponseSchema,
  replaceConversationTagsSchema,
  updateConversationTagSchema,
} from './ConversationTagsTypes.js';

const TAG = 'Conversation Tags';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedConversationTagsSchema = paginatedSchema(
  conversationTagResponseSchema,
  'PaginatedConversationTags'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/conversation-tags',
  tags: [TAG],
  summary:
    'Lista tags do catálogo do tenant. Aplicáveis a conversations via assignments (humano via UI ou agente IA via tool).',
  security: REQUIRES_AUTH,
  request: { query: findConversationTagsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedConversationTagsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/conversation-tags',
  requirePermission('conversationTags:read'),
  validateQuery(findConversationTagsQuerySchema),
  ConversationTagsController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/conversation-tags',
  tags: [TAG],
  summary: 'Cria tag de conversa',
  description:
    'Tags com `agentInstruction` preenchido viram disponíveis pro agente IA. ' +
    'Sem instrução, a tag fica restrita a uso humano via UI.',
  security: REQUIRES_AUTH,
  request: {
    body: {
      content: { 'application/json': { schema: createConversationTagSchema } },
    },
  },
  responses: {
    201: {
      description: 'Tag criada',
      content: { 'application/json': { schema: conversationTagResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/conversation-tags',
  requirePermission('conversationTags:write'),
  validateBody(createConversationTagSchema),
  ConversationTagsController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/conversation-tags/{id}',
  tags: [TAG],
  summary: 'Busca tag por ID',
  security: REQUIRES_AUTH,
  request: { params: conversationTagIdParamSchema },
  responses: {
    200: {
      description: 'Tag encontrada',
      content: { 'application/json': { schema: conversationTagResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/conversation-tags/:id',
  requirePermission('conversationTags:read'),
  validateParams(conversationTagIdParamSchema),
  ConversationTagsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/conversation-tags/{id}',
  tags: [TAG],
  summary: 'Atualiza tag (parcial). agentInstruction=null limpa a instrução.',
  security: REQUIRES_AUTH,
  request: {
    params: conversationTagIdParamSchema,
    body: {
      content: { 'application/json': { schema: updateConversationTagSchema } },
    },
  },
  responses: {
    200: {
      description: 'Tag atualizada',
      content: { 'application/json': { schema: conversationTagResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/conversation-tags/:id',
  requirePermission('conversationTags:write'),
  validateParams(conversationTagIdParamSchema),
  validateBody(updateConversationTagSchema),
  ConversationTagsController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/conversation-tags/{id}',
  tags: [TAG],
  summary:
    'Remove tag (hard delete). Cascateia assignments — perde histórico. Desativar é o caminho usual.',
  security: REQUIRES_AUTH,
  request: { params: conversationTagIdParamSchema },
  responses: {
    204: { description: 'Removida' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/conversation-tags/:id',
  requirePermission('conversationTags:delete'),
  validateParams(conversationTagIdParamSchema),
  ConversationTagsController.remove
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/conversation-tags/{id}/deactivate',
  tags: [TAG],
  summary: 'Desativa a tag (soft delete) — mantém assignments mas some dos pickers',
  security: REQUIRES_AUTH,
  request: { params: conversationTagIdParamSchema },
  responses: {
    200: {
      description: 'Tag desativada',
      content: { 'application/json': { schema: conversationTagResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/conversation-tags/:id/deactivate',
  requirePermission('conversationTags:write'),
  validateParams(conversationTagIdParamSchema),
  ConversationTagsController.deactivate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/conversation-tags/{id}/activate',
  tags: [TAG],
  summary: 'Reativa a tag',
  security: REQUIRES_AUTH,
  request: { params: conversationTagIdParamSchema },
  responses: {
    200: {
      description: 'Tag ativada',
      content: { 'application/json': { schema: conversationTagResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/conversation-tags/:id/activate',
  requirePermission('conversationTags:write'),
  validateParams(conversationTagIdParamSchema),
  ConversationTagsController.activate
);

// ---- Assignments ----
openApiRegistry.registerPath({
  method: 'post',
  path: '/conversation-tags/assignments',
  tags: [TAG],
  summary: 'Aplica conjunto de tags a uma conversa (REPLACE — substitui o conjunto anterior)',
  description:
    'Endpoint usado pelo apps/agent (após classificação via tool tagConversation) ' +
    'e futuramente pela UI humana. Conjunto inteiro é substituído — pra remover ' +
    'uma tag, mande o array sem ela. `agentTurnId` preenchido = procedência IA; ' +
    'omitido/null = humano. Publica evento socket `conversation.tags_updated`.',
  security: REQUIRES_AUTH,
  request: {
    body: {
      content: { 'application/json': { schema: replaceConversationTagsSchema } },
    },
  },
  responses: {
    200: {
      description: 'Tags aplicadas',
      content: {
        'application/json': { schema: replaceConversationTagsResponseSchema },
      },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.post(
  '/conversation-tags/assignments',
  requirePermission('conversationTags:write'),
  validateBody(replaceConversationTagsSchema),
  ConversationTagsController.replaceAssignments,
);

export default router;
