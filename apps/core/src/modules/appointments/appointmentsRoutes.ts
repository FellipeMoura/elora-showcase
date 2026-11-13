import { Router, type Router as ExpressRouter } from 'express';
import { AppointmentsController } from './AppointmentsController.js';
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
  appointmentIdParamSchema,
  appointmentResponseSchema,
  createAppointmentSchema,
  findAppointmentsQuerySchema,
  updateAppointmentSchema,
} from './AppointmentsTypes.js';

const TAG = 'Appointments';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedSchemaForList = paginatedSchema(
  appointmentResponseSchema,
  'PaginatedAppointments'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/appointments',
  tags: [TAG],
  summary:
    'Lista agendamentos (filtros: kind, journey, cliente, profissional, unidade, equipamento, status, range de data).',
  security: REQUIRES_AUTH,
  request: { query: findAppointmentsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedSchemaForList } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/appointments',
  requirePermission('appointments:read'),
  validateQuery(findAppointmentsQuerySchema),
  AppointmentsController.find
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/appointments',
  tags: [TAG],
  summary:
    'Cria agendamento. Body é discriminated union por kind: evaluation cria a entity inline; procedure exige procedureSessionId já existente.',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createAppointmentSchema } } },
  },
  responses: {
    201: {
      description: 'Agendamento criado',
      content: { 'application/json': { schema: appointmentResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/appointments',
  requirePermission('appointments:write'),
  validateBody(createAppointmentSchema),
  AppointmentsController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/appointments/{id}',
  tags: [TAG],
  summary: 'Busca agendamento por ID',
  security: REQUIRES_AUTH,
  request: { params: appointmentIdParamSchema },
  responses: {
    200: {
      description: 'Agendamento encontrado',
      content: { 'application/json': { schema: appointmentResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/appointments/:id',
  requirePermission('appointments:read'),
  validateParams(appointmentIdParamSchema),
  AppointmentsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/appointments/{id}',
  tags: [TAG],
  summary:
    'Reagenda / edita campos do slot. Permitido só em status=scheduled/confirmed. Pra trocar kind ou linkagem, cancele e crie novo.',
  security: REQUIRES_AUTH,
  request: {
    params: appointmentIdParamSchema,
    body: { content: { 'application/json': { schema: updateAppointmentSchema } } },
  },
  responses: {
    200: {
      description: 'Agendamento atualizado',
      content: { 'application/json': { schema: appointmentResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/appointments/:id',
  requirePermission('appointments:write'),
  validateParams(appointmentIdParamSchema),
  validateBody(updateAppointmentSchema),
  AppointmentsController.update
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/appointments/{id}/confirm',
  tags: [TAG],
  summary: 'Confirma slot (scheduled → confirmed)',
  security: REQUIRES_AUTH,
  request: { params: appointmentIdParamSchema },
  responses: {
    200: {
      description: 'Confirmado',
      content: { 'application/json': { schema: appointmentResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/appointments/:id/confirm',
  requirePermission('appointments:write'),
  validateParams(appointmentIdParamSchema),
  AppointmentsController.confirm
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/appointments/{id}/attend',
  tags: [TAG],
  summary:
    'Marca presença (status=attended). Dispara cascata: kind=evaluation → evaluation.status=performed + journey_event evaluation_done + transition lead→evaluation se aplicável. kind=procedure → session.status=done + treatment criado/linkado + auto-complete check.',
  security: REQUIRES_AUTH,
  request: { params: appointmentIdParamSchema },
  responses: {
    200: {
      description: 'Presença registrada',
      content: { 'application/json': { schema: appointmentResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/appointments/:id/attend',
  requirePermission('appointments:write'),
  validateParams(appointmentIdParamSchema),
  AppointmentsController.attend
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/appointments/{id}/no-show',
  tags: [TAG],
  summary:
    'Marca como no_show. Libera a sessão/avaliação pra reagendamento (não muda status da entity).',
  security: REQUIRES_AUTH,
  request: { params: appointmentIdParamSchema },
  responses: {
    200: {
      description: 'No-show registrado',
      content: { 'application/json': { schema: appointmentResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/appointments/:id/no-show',
  requirePermission('appointments:write'),
  validateParams(appointmentIdParamSchema),
  AppointmentsController.noShow
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/appointments/{id}/cancel',
  tags: [TAG],
  summary:
    'Cancela o slot. Não muda status da evaluation/session associada — pra cancelar essas, use os endpoints específicos.',
  security: REQUIRES_AUTH,
  request: { params: appointmentIdParamSchema },
  responses: {
    200: {
      description: 'Cancelado',
      content: { 'application/json': { schema: appointmentResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/appointments/:id/cancel',
  requirePermission('appointments:write'),
  validateParams(appointmentIdParamSchema),
  AppointmentsController.cancel
);

export default router;
