import { Router, type Router as ExpressRouter } from 'express';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { loadUserRoles } from '../../shared/middleware/loadUserRoles.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import { validateParams } from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  REQUIRES_AUTH,
  openApiRegistry,
} from '../../shared/openapi/index.js';
import { AttendanceController } from './AttendanceController.js';
import {
  appointmentIdParamSchema,
  attendanceDetailsResponseSchema,
  attendanceLinkResponseSchema,
} from './AttendanceTypes.js';

// =====================================================================
// Rotas autenticadas (montadas em tenantRoutes). Endpoint que o operador
// usa pra gerar o link de presença a partir do popover da agenda. Rotas
// públicas (sem JWT) ficam em publicAttendanceRoutes.ts.
// =====================================================================

const TAG = 'Session Attendance';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

openApiRegistry.registerPath({
  method: 'post',
  path: '/appointments/{id}/attendance/link',
  tags: [TAG],
  summary:
    'Gera link público pro cliente assinar presença. Cobre TODAS as sessões pendentes do cliente no dia.',
  description:
    'Idempotente: reusa token vivo cobrindo o mesmo set de sessões. Se o ' +
    'set mudou (novo agendamento entrou no dia), invalida o token anterior ' +
    'e emite um novo. O escopo é snapshotado no momento da emissão — sessões ' +
    'adicionadas depois NÃO são cobertas e precisam de novo link.',
  security: REQUIRES_AUTH,
  request: { params: appointmentIdParamSchema },
  responses: {
    200: {
      description: 'Link gerado (ou reutilizado)',
      content: { 'application/json': { schema: attendanceLinkResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/appointments/:id/attendance/link',
  requirePermission('procedureSessionAttendances:write'),
  validateParams(appointmentIdParamSchema),
  AttendanceController.generateLink
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/appointments/{id}/attendance',
  tags: [TAG],
  summary:
    'Detalhes da assinatura (foto + assinatura SVG) registrada para a sessão deste agendamento.',
  description:
    'Resolve a assinatura via session_id do appointment. Devolve SVG inline ' +
    'e foto como data URL base64 (objetos pequenos, sem precisar presigned). ' +
    '404 se ainda não há assinatura para a sessão.',
  security: REQUIRES_AUTH,
  request: { params: appointmentIdParamSchema },
  responses: {
    200: {
      description: 'Assinatura encontrada',
      content: { 'application/json': { schema: attendanceDetailsResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    503: ERROR_RESPONSES[503],
  },
});

router.get(
  '/appointments/:id/attendance',
  requirePermission('procedureSessionAttendances:read'),
  validateParams(appointmentIdParamSchema),
  AttendanceController.getForAppointment
);

export default router;
