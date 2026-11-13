import { Router, type Router as ExpressRouter } from 'express';
import { ClientFormsController } from './ClientFormsController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { loadUserRoles } from '../../shared/middleware/loadUserRoles.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import {
  validateBody,
  validateParams,
} from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  REQUIRES_AUTH,
  openApiRegistry,
} from '../../shared/openapi/index.js';
import { z } from '../../shared/openapi/registry.js';
import {
  clientFormIdParamSchema,
  clientFormResponseSchema,
  clientIdParamSchema,
  createClientFormSchema,
  evaluationIdParamSchema,
  formAnswerResponseSchema,
  upsertAnswersSchema,
} from './ClientFormsTypes.js';

const TAG = 'ClientForms';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const formsListSchema = z
  .object({ items: z.array(clientFormResponseSchema) })
  .openapi('ClientFormsList');

const formWithAnswersSchema = z
  .object({
    form: clientFormResponseSchema,
    answers: z.array(formAnswerResponseSchema),
  })
  .openapi('ClientFormWithAnswers');

const answersListSchema = z
  .object({ items: z.array(formAnswerResponseSchema) })
  .openapi('FormAnswersList');

// =====================================================================
// Coleção por cliente — histórico agregado (todas as fichas em todas as
// evaluations do cliente). Read-only.
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/clients/{clientId}/forms',
  tags: [TAG],
  summary:
    'Lista fichas do cliente (agregado, todas as evaluations). Pra criar ficha nova, use o endpoint por evaluation.',
  security: REQUIRES_AUTH,
  request: { params: clientIdParamSchema },
  responses: {
    200: {
      description: 'Lista de fichas',
      content: { 'application/json': { schema: formsListSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/clients/:clientId/forms',
  requirePermission('clientForms:read'),
  validateParams(clientIdParamSchema),
  ClientFormsController.listByClient
);

// =====================================================================
// Coleção por evaluation — fichas vivem ancoradas na avaliação. Cada
// evaluation tem seu próprio conjunto (1 ficha por template, máx).
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/evaluations/{evaluationId}/forms',
  tags: [TAG],
  summary: 'Lista fichas de uma avaliação',
  security: REQUIRES_AUTH,
  request: { params: evaluationIdParamSchema },
  responses: {
    200: {
      description: 'Lista de fichas',
      content: { 'application/json': { schema: formsListSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/evaluations/:evaluationId/forms',
  requirePermission('clientForms:read'),
  validateParams(evaluationIdParamSchema),
  ClientFormsController.listByEvaluation
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/evaluations/{evaluationId}/forms',
  tags: [TAG],
  summary:
    'Cria ficha pra avaliação (a partir de um template). Status inicial: draft. Cliente é derivado da evaluation.',
  security: REQUIRES_AUTH,
  request: {
    params: evaluationIdParamSchema,
    body: { content: { 'application/json': { schema: createClientFormSchema } } },
  },
  responses: {
    201: {
      description: 'Ficha criada',
      content: { 'application/json': { schema: clientFormResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/evaluations/:evaluationId/forms',
  requirePermission('clientForms:write'),
  validateParams(evaluationIdParamSchema),
  validateBody(createClientFormSchema),
  ClientFormsController.create
);

// =====================================================================
// Recurso ficha — acessada diretamente pelo ID
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/client-forms/{id}',
  tags: [TAG],
  summary: 'Busca ficha por ID (com respostas embedded)',
  security: REQUIRES_AUTH,
  request: { params: clientFormIdParamSchema },
  responses: {
    200: {
      description: 'Ficha encontrada',
      content: { 'application/json': { schema: formWithAnswersSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/client-forms/:id',
  requirePermission('clientForms:read'),
  validateParams(clientFormIdParamSchema),
  ClientFormsController.getById
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/client-forms/{id}/answers',
  tags: [TAG],
  summary:
    'Upsert em lote de respostas. Atualiza answer existente (por questionId) ou cria nova.',
  security: REQUIRES_AUTH,
  request: {
    params: clientFormIdParamSchema,
    body: { content: { 'application/json': { schema: upsertAnswersSchema } } },
  },
  responses: {
    200: {
      description: 'Respostas atualizadas',
      content: { 'application/json': { schema: answersListSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/client-forms/:id/answers',
  requirePermission('clientForms:write'),
  validateParams(clientFormIdParamSchema),
  validateBody(upsertAnswersSchema),
  ClientFormsController.upsertAnswers
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/client-forms/{id}/complete',
  tags: [TAG],
  summary:
    'Finaliza a ficha (status=completed). Valida que todas as required questions têm resposta. Emite journey_event form_completed na journey ativa do cliente.',
  security: REQUIRES_AUTH,
  request: { params: clientFormIdParamSchema },
  responses: {
    200: {
      description: 'Ficha finalizada',
      content: { 'application/json': { schema: clientFormResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/client-forms/:id/complete',
  requirePermission('clientForms:write'),
  validateParams(clientFormIdParamSchema),
  ClientFormsController.complete
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/client-forms/{id}/archive',
  tags: [TAG],
  summary: 'Arquiva a ficha (status=archived)',
  security: REQUIRES_AUTH,
  request: { params: clientFormIdParamSchema },
  responses: {
    200: {
      description: 'Ficha arquivada',
      content: { 'application/json': { schema: clientFormResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/client-forms/:id/archive',
  requirePermission('clientForms:write'),
  validateParams(clientFormIdParamSchema),
  ClientFormsController.archive
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/client-forms/{id}/reopen',
  tags: [TAG],
  summary: 'Reabre ficha arquivada (status → draft)',
  security: REQUIRES_AUTH,
  request: { params: clientFormIdParamSchema },
  responses: {
    200: {
      description: 'Ficha reaberta',
      content: { 'application/json': { schema: clientFormResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/client-forms/:id/reopen',
  requirePermission('clientForms:write'),
  validateParams(clientFormIdParamSchema),
  ClientFormsController.reopen
);

export default router;
