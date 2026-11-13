import { Router, type Router as ExpressRouter } from 'express';
import { FormTemplatesController } from './FormTemplatesController.js';
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
  createFormQuestionSchema,
  createFormTemplateSchema,
  findFormTemplatesQuerySchema,
  formQuestionIdParamSchema,
  formQuestionResponseSchema,
  formTemplateIdParamSchema,
  formTemplateResponseSchema,
  updateFormQuestionSchema,
  updateFormTemplateSchema,
} from './FormTemplatesTypes.js';

const TAG = 'FormTemplates';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedTemplatesSchema = paginatedSchema(
  formTemplateResponseSchema,
  'PaginatedFormTemplates'
);

// Lista de perguntas — não usamos paginatedSchema porque perguntas vêm
// todas de uma vez (catálogo curto). Schema simples { items: [...] }.
const questionsListSchema = z
  .object({
    items: z.array(formQuestionResponseSchema),
  })
  .openapi('FormQuestionsList');

// =====================================================================
// Templates
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/form-templates',
  tags: [TAG],
  summary: 'Lista templates de ficha do tenant',
  security: REQUIRES_AUTH,
  request: { query: findFormTemplatesQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedTemplatesSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/form-templates',
  requirePermission('formTemplates:read'),
  validateQuery(findFormTemplatesQuerySchema),
  FormTemplatesController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/form-templates',
  tags: [TAG],
  summary: 'Cria template de ficha',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createFormTemplateSchema } } },
  },
  responses: {
    201: {
      description: 'Template criado',
      content: { 'application/json': { schema: formTemplateResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/form-templates',
  requirePermission('formTemplates:write'),
  validateBody(createFormTemplateSchema),
  FormTemplatesController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/form-templates/{id}',
  tags: [TAG],
  summary: 'Busca template por ID',
  security: REQUIRES_AUTH,
  request: { params: formTemplateIdParamSchema },
  responses: {
    200: {
      description: 'Template encontrado',
      content: { 'application/json': { schema: formTemplateResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/form-templates/:id',
  requirePermission('formTemplates:read'),
  validateParams(formTemplateIdParamSchema),
  FormTemplatesController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/form-templates/{id}',
  tags: [TAG],
  summary: 'Atualiza template (parcial)',
  security: REQUIRES_AUTH,
  request: {
    params: formTemplateIdParamSchema,
    body: { content: { 'application/json': { schema: updateFormTemplateSchema } } },
  },
  responses: {
    200: {
      description: 'Template atualizado',
      content: { 'application/json': { schema: formTemplateResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/form-templates/:id',
  requirePermission('formTemplates:write'),
  validateParams(formTemplateIdParamSchema),
  validateBody(updateFormTemplateSchema),
  FormTemplatesController.update
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/form-templates/{id}',
  tags: [TAG],
  summary:
    'Remove template (hard delete). Falha 409 se houver fichas preenchidas — desativar é o caminho usual.',
  security: REQUIRES_AUTH,
  request: { params: formTemplateIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/form-templates/:id',
  requirePermission('formTemplates:delete'),
  validateParams(formTemplateIdParamSchema),
  FormTemplatesController.remove
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/form-templates/{id}/deactivate',
  tags: [TAG],
  summary: 'Desativa o template',
  security: REQUIRES_AUTH,
  request: { params: formTemplateIdParamSchema },
  responses: {
    200: {
      description: 'Template desativado',
      content: { 'application/json': { schema: formTemplateResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/form-templates/:id/deactivate',
  requirePermission('formTemplates:write'),
  validateParams(formTemplateIdParamSchema),
  FormTemplatesController.deactivate
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/form-templates/{id}/activate',
  tags: [TAG],
  summary: 'Reativa o template',
  security: REQUIRES_AUTH,
  request: { params: formTemplateIdParamSchema },
  responses: {
    200: {
      description: 'Template ativado',
      content: { 'application/json': { schema: formTemplateResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/form-templates/:id/activate',
  requirePermission('formTemplates:write'),
  validateParams(formTemplateIdParamSchema),
  FormTemplatesController.activate
);

// =====================================================================
// Questions (sub-recurso)
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/form-templates/{id}/questions',
  tags: [TAG],
  summary: 'Lista perguntas do template (ordenadas por position, asc)',
  security: REQUIRES_AUTH,
  request: { params: formTemplateIdParamSchema },
  responses: {
    200: {
      description: 'Lista de perguntas',
      content: { 'application/json': { schema: questionsListSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/form-templates/:id/questions',
  requirePermission('formTemplates:read'),
  validateParams(formTemplateIdParamSchema),
  FormTemplatesController.listQuestions
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/form-templates/{id}/questions',
  tags: [TAG],
  summary: 'Adiciona pergunta ao template',
  security: REQUIRES_AUTH,
  request: {
    params: formTemplateIdParamSchema,
    body: { content: { 'application/json': { schema: createFormQuestionSchema } } },
  },
  responses: {
    201: {
      description: 'Pergunta criada',
      content: { 'application/json': { schema: formQuestionResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.post(
  '/form-templates/:id/questions',
  requirePermission('formTemplates:write'),
  validateParams(formTemplateIdParamSchema),
  validateBody(createFormQuestionSchema),
  FormTemplatesController.createQuestion
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/form-templates/{id}/questions/{questionId}',
  tags: [TAG],
  summary: 'Atualiza pergunta',
  security: REQUIRES_AUTH,
  request: {
    params: formQuestionIdParamSchema,
    body: { content: { 'application/json': { schema: updateFormQuestionSchema } } },
  },
  responses: {
    200: {
      description: 'Pergunta atualizada',
      content: { 'application/json': { schema: formQuestionResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.patch(
  '/form-templates/:id/questions/:questionId',
  requirePermission('formTemplates:write'),
  validateParams(formQuestionIdParamSchema),
  validateBody(updateFormQuestionSchema),
  FormTemplatesController.updateQuestion
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/form-templates/{id}/questions/{questionId}',
  tags: [TAG],
  summary:
    'Remove pergunta do template. Apaga form_answers vinculadas via cascade.',
  security: REQUIRES_AUTH,
  request: { params: formQuestionIdParamSchema },
  responses: {
    204: { description: 'Removida' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.delete(
  '/form-templates/:id/questions/:questionId',
  requirePermission('formTemplates:delete'),
  validateParams(formQuestionIdParamSchema),
  FormTemplatesController.removeQuestion
);

export default router;
