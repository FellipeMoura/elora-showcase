import { Router, type Router as ExpressRouter } from 'express';
import { JourneysController } from './JourneysController.js';
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
  createJourneySchema,
  findJourneyEventsQuerySchema,
  findJourneysQuerySchema,
  journeyEventResponseSchema,
  journeyIdParamSchema,
  journeyResponseSchema,
  markLostSchema,
} from './JourneysTypes.js';

const TAG = 'Journeys';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedJourneysSchema = paginatedSchema(
  journeyResponseSchema,
  'PaginatedJourneys'
);
const paginatedJourneyEventsSchema = paginatedSchema(
  journeyEventResponseSchema,
  'PaginatedJourneyEvents'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/journeys',
  tags: [TAG],
  summary: 'Lista jornadas (filtros por stage/status/source/cliente)',
  security: REQUIRES_AUTH,
  request: { query: findJourneysQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedJourneysSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/journeys',
  requirePermission('journeys:read'),
  validateQuery(findJourneysQuerySchema),
  JourneysController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/journeys',
  tags: [TAG],
  summary:
    'Cria jornada manualmente (lead). Falha 409 se cliente já tem jornada ativa.',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createJourneySchema } } },
  },
  responses: {
    201: {
      description: 'Jornada criada',
      content: { 'application/json': { schema: journeyResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/journeys',
  requirePermission('journeys:write'),
  validateBody(createJourneySchema),
  JourneysController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/journeys/{id}',
  tags: [TAG],
  summary: 'Busca jornada por ID',
  security: REQUIRES_AUTH,
  request: { params: journeyIdParamSchema },
  responses: {
    200: {
      description: 'Jornada encontrada',
      content: { 'application/json': { schema: journeyResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/journeys/:id',
  requirePermission('journeys:read'),
  validateParams(journeyIdParamSchema),
  JourneysController.getById
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/journeys/{id}/won',
  tags: [TAG],
  summary: 'Marca jornada como ganha (selo final). Só permitido em stage=result.',
  security: REQUIRES_AUTH,
  request: { params: journeyIdParamSchema },
  responses: {
    200: {
      description: 'Jornada marcada como ganha',
      content: { 'application/json': { schema: journeyResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/journeys/:id/won',
  requirePermission('journeys:write'),
  validateParams(journeyIdParamSchema),
  JourneysController.markWon
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/journeys/{id}/lost',
  tags: [TAG],
  summary: 'Marca jornada como perdida (reason obrigatório).',
  security: REQUIRES_AUTH,
  request: {
    params: journeyIdParamSchema,
    body: { content: { 'application/json': { schema: markLostSchema } } },
  },
  responses: {
    200: {
      description: 'Jornada marcada como perdida',
      content: { 'application/json': { schema: journeyResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/journeys/:id/lost',
  requirePermission('journeys:write'),
  validateParams(journeyIdParamSchema),
  validateBody(markLostSchema),
  JourneysController.markLost
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/journeys/{id}/events',
  tags: [TAG],
  summary:
    'Lista audit trail da jornada (journey_events). Ordenado por created_at desc.',
  security: REQUIRES_AUTH,
  request: {
    params: journeyIdParamSchema,
    query: findJourneyEventsQuerySchema,
  },
  responses: {
    200: {
      description: 'Lista paginada de eventos',
      content: {
        'application/json': { schema: paginatedJourneyEventsSchema },
      },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/journeys/:id/events',
  requirePermission('journeys:read'),
  validateParams(journeyIdParamSchema),
  validateQuery(findJourneyEventsQuerySchema),
  JourneysController.findEvents
);

export default router;
