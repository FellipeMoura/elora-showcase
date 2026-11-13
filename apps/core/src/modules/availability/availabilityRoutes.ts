import { Router, type Router as ExpressRouter } from 'express';
import { AvailabilityController } from './AvailabilityController.js';
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
} from '../../shared/openapi/index.js';
import { z } from '../../shared/openapi/registry.js';
import {
  createExceptionSchema,
  createScheduleSchema,
  exceptionIdParamSchema,
  findExceptionsQuerySchema,
  findSchedulesQuerySchema,
  freeSlotResponseSchema,
  freeSlotsListSchema,
  freeSlotsQuerySchema,
  professionalScheduleResponseSchema,
  scheduleExceptionResponseSchema,
  scheduleIdParamSchema,
  updateExceptionSchema,
  updateScheduleSchema,
} from './AvailabilityTypes.js';

const TAG = 'Availability';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const schedulesListSchema = z
  .object({ items: z.array(professionalScheduleResponseSchema) })
  .openapi('ProfessionalSchedulesList');

const exceptionsListSchema = z
  .object({ items: z.array(scheduleExceptionResponseSchema) })
  .openapi('ScheduleExceptionsList');

// =====================================================================
// Schedules
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/availability/schedules',
  tags: [TAG],
  summary:
    'Lista janelas semanais de disponibilidade. Filtros opcionais por userId e/ou dayOfWeek.',
  security: REQUIRES_AUTH,
  request: { query: findSchedulesQuerySchema },
  responses: {
    200: {
      description: 'Lista',
      content: { 'application/json': { schema: schedulesListSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/availability/schedules',
  requirePermission('availability:read'),
  validateQuery(findSchedulesQuerySchema),
  AvailabilityController.findSchedules
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/availability/schedules',
  tags: [TAG],
  summary:
    'Cria janela semanal. admin/manager podem agir em qualquer userId; professional só no próprio userId.',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createScheduleSchema } } },
  },
  responses: {
    201: {
      description: 'Janela criada',
      content: { 'application/json': { schema: professionalScheduleResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.post(
  '/availability/schedules',
  requirePermission('availability:write'),
  validateBody(createScheduleSchema),
  AvailabilityController.createSchedule
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/availability/schedules/{id}',
  tags: [TAG],
  summary: 'Atualiza janela. Self-edit pra professional; admin/manager qualquer.',
  security: REQUIRES_AUTH,
  request: {
    params: scheduleIdParamSchema,
    body: { content: { 'application/json': { schema: updateScheduleSchema } } },
  },
  responses: {
    200: {
      description: 'Janela atualizada',
      content: { 'application/json': { schema: professionalScheduleResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.patch(
  '/availability/schedules/:id',
  requirePermission('availability:write'),
  validateParams(scheduleIdParamSchema),
  validateBody(updateScheduleSchema),
  AvailabilityController.updateSchedule
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/availability/schedules/{id}',
  tags: [TAG],
  summary: 'Remove janela. Self-edit pra professional; admin/manager qualquer.',
  security: REQUIRES_AUTH,
  request: { params: scheduleIdParamSchema },
  responses: {
    204: { description: 'Removida' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.delete(
  '/availability/schedules/:id',
  requirePermission('availability:write'),
  validateParams(scheduleIdParamSchema),
  AvailabilityController.deleteSchedule
);

// =====================================================================
// Exceptions
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/availability/exceptions',
  tags: [TAG],
  summary:
    'Lista exceções (férias, treinamento, etc). Filtros opcionais: userId, range from/to.',
  security: REQUIRES_AUTH,
  request: { query: findExceptionsQuerySchema },
  responses: {
    200: {
      description: 'Lista',
      content: { 'application/json': { schema: exceptionsListSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/availability/exceptions',
  requirePermission('availability:read'),
  validateQuery(findExceptionsQuerySchema),
  AvailabilityController.findExceptions
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/availability/exceptions',
  tags: [TAG],
  summary:
    'Cria exceção de disponibilidade. admin/manager podem agir em qualquer userId; professional só no próprio.',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createExceptionSchema } } },
  },
  responses: {
    201: {
      description: 'Exceção criada',
      content: { 'application/json': { schema: scheduleExceptionResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.post(
  '/availability/exceptions',
  requirePermission('availability:write'),
  validateBody(createExceptionSchema),
  AvailabilityController.createException
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/availability/exceptions/{id}',
  tags: [TAG],
  summary: 'Atualiza exceção. Self-edit pra professional; admin/manager qualquer.',
  security: REQUIRES_AUTH,
  request: {
    params: exceptionIdParamSchema,
    body: { content: { 'application/json': { schema: updateExceptionSchema } } },
  },
  responses: {
    200: {
      description: 'Exceção atualizada',
      content: { 'application/json': { schema: scheduleExceptionResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.patch(
  '/availability/exceptions/:id',
  requirePermission('availability:write'),
  validateParams(exceptionIdParamSchema),
  validateBody(updateExceptionSchema),
  AvailabilityController.updateException
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/availability/exceptions/{id}',
  tags: [TAG],
  summary: 'Remove exceção. Self-edit pra professional; admin/manager qualquer.',
  security: REQUIRES_AUTH,
  request: { params: exceptionIdParamSchema },
  responses: {
    204: { description: 'Removida' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.delete(
  '/availability/exceptions/:id',
  requirePermission('availability:write'),
  validateParams(exceptionIdParamSchema),
  AvailabilityController.deleteException
);

// =====================================================================
// Free slots
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/availability/free-slots',
  tags: [TAG],
  summary:
    'Calcula slots livres pra (user, date, durationMinutes). Aplica: janelas semanais vigentes + subtrai appointments ativos + subtrai exceções. Step do slot = durationMinutes.',
  security: REQUIRES_AUTH,
  request: { query: freeSlotsQuerySchema },
  responses: {
    200: {
      description: 'Slots livres ordenados por startAt asc',
      content: { 'application/json': { schema: freeSlotsListSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/availability/free-slots',
  requirePermission('availability:read'),
  validateQuery(freeSlotsQuerySchema),
  AvailabilityController.findFreeSlots
);

void freeSlotResponseSchema; // garante registro no OpenAPI

export default router;
