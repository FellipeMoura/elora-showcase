import { Router, type Router as ExpressRouter } from 'express';
import { MessageTemplatesController } from './MessageTemplatesController.js';
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
  createTemplateSchema,
  findTemplatesQuerySchema,
  messageTemplateResponseSchema,
  templateIdParamSchema,
  updateTemplateSchema,
} from './MessageTemplatesTypes.js';

const TAG = 'Message Templates';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);

// Permissões granulares ('templates:read/write/delete') entram com o sistema
// compartilhado de permissions (mesmo TODO de whatsappChannels).

const paginatedTemplatesSchema = paginatedSchema(
  messageTemplateResponseSchema,
  'PaginatedMessageTemplates'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/message-templates',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Lista templates do tenant',
  request: { query: findTemplatesQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedTemplatesSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
  },
});

router.get(
  '/message-templates',
  validateQuery(findTemplatesQuerySchema),
  MessageTemplatesController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/message-templates',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Cria template de mensagem',
  request: {
    body: { content: { 'application/json': { schema: createTemplateSchema } } },
  },
  responses: {
    201: {
      description: 'Template criado',
      content: { 'application/json': { schema: messageTemplateResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/message-templates',
  requirePermission('chat:manage'),
  validateBody(createTemplateSchema),
  MessageTemplatesController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/message-templates/{id}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Busca template por ID',
  request: { params: templateIdParamSchema },
  responses: {
    200: {
      description: 'Template encontrado',
      content: { 'application/json': { schema: messageTemplateResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/message-templates/:id',
  validateParams(templateIdParamSchema),
  MessageTemplatesController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/message-templates/{id}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Atualiza template (parcial)',
  request: {
    params: templateIdParamSchema,
    body: { content: { 'application/json': { schema: updateTemplateSchema } } },
  },
  responses: {
    200: {
      description: 'Template atualizado',
      content: { 'application/json': { schema: messageTemplateResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/message-templates/:id',
  requirePermission('chat:manage'),
  validateParams(templateIdParamSchema),
  validateBody(updateTemplateSchema),
  MessageTemplatesController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/message-templates/{id}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Remove template (falha se em uso por automations)',
  request: { params: templateIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/message-templates/:id',
  requirePermission('chat:manage'),
  validateParams(templateIdParamSchema),
  MessageTemplatesController.remove
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/message-templates/{id}/deactivate',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Desativa o template',
  request: { params: templateIdParamSchema },
  responses: {
    200: {
      description: 'Template desativado',
      content: { 'application/json': { schema: messageTemplateResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/message-templates/:id/deactivate',
  requirePermission('chat:manage'),
  validateParams(templateIdParamSchema),
  MessageTemplatesController.deactivate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/message-templates/{id}/activate',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Reativa o template',
  request: { params: templateIdParamSchema },
  responses: {
    200: {
      description: 'Template ativado',
      content: { 'application/json': { schema: messageTemplateResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/message-templates/:id/activate',
  requirePermission('chat:manage'),
  validateParams(templateIdParamSchema),
  MessageTemplatesController.activate
);

export default router;
