import { Router, type Router as ExpressRouter } from 'express';
import { validateBody, validateParams } from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  openApiRegistry,
} from '../../shared/openapi/index.js';
import { AttendanceController } from './AttendanceController.js';
import {
  publicAttendancePreviewResponseSchema,
  publicTokenParamSchema,
  signAttendanceBodySchema,
  signAttendanceResponseSchema,
  verifyAttendanceBodySchema,
  verifyAttendanceResponseSchema,
} from './AttendanceTypes.js';

// =====================================================================
// Rotas PÚBLICAS — sem ensureAuthenticated, sem tenantContextMiddleware.
// Acessadas pelo cliente via signUrl (browser sem login). Tenant é
// resolvido internamente pelo service a partir do token (single-use,
// rate-limited, expiração 48h).
// =====================================================================

const TAG = 'Session Attendance (Public)';
const router: ExpressRouter = Router();

openApiRegistry.registerPath({
  method: 'get',
  path: '/public/session-attendance/{token}',
  tags: [TAG],
  summary:
    'Preview pro cliente (nome curto, clínica, procedimentos do dia). Sem auth.',
  request: { params: publicTokenParamSchema },
  responses: {
    200: {
      description: 'Preview do link',
      content: {
        'application/json': { schema: publicAttendancePreviewResponseSchema },
      },
    },
    400: ERROR_RESPONSES[400],
    404: ERROR_RESPONSES[404],
    410: {
      description: 'Link expirado ou já utilizado',
      content: { 'application/json': { schema: ERROR_RESPONSES[404].content['application/json'].schema } },
    },
  },
});

router.get(
  '/public/session-attendance/:token',
  validateParams(publicTokenParamSchema),
  AttendanceController.publicPreview
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/public/session-attendance/{token}/verify',
  tags: [TAG],
  summary:
    'Confirma identidade (CPF + nascimento). 3 tentativas → link invalidado.',
  request: {
    params: publicTokenParamSchema,
    body: { content: { 'application/json': { schema: verifyAttendanceBodySchema } } },
  },
  responses: {
    200: {
      description: 'Identidade confirmada — emite sub-token de assinatura',
      content: {
        'application/json': { schema: verifyAttendanceResponseSchema },
      },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    410: {
      description: 'Link expirado, invalidado ou já utilizado',
      content: { 'application/json': { schema: ERROR_RESPONSES[404].content['application/json'].schema } },
    },
  },
});

router.post(
  '/public/session-attendance/:token/verify',
  validateParams(publicTokenParamSchema),
  validateBody(verifyAttendanceBodySchema),
  AttendanceController.publicVerify
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/public/session-attendance/{token}/sign',
  tags: [TAG],
  summary:
    'Submete foto + assinatura. Requer header X-Verify-Token (vindo do verify).',
  description:
    'Persiste foto (WebP) e assinatura (SVG) no MinIO/R2, cria attendance ' +
    'record, marca sessões cobertas como signed e appointments como attended ' +
    'numa transação atômica. Consome o token (single-use).',
  request: {
    params: publicTokenParamSchema,
    body: { content: { 'application/json': { schema: signAttendanceBodySchema } } },
  },
  responses: {
    200: {
      description: 'Presença registrada',
      content: {
        'application/json': { schema: signAttendanceResponseSchema },
      },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    410: {
      description: 'Link expirado ou já utilizado',
      content: { 'application/json': { schema: ERROR_RESPONSES[404].content['application/json'].schema } },
    },
    503: ERROR_RESPONSES[503],
  },
});

router.post(
  '/public/session-attendance/:token/sign',
  validateParams(publicTokenParamSchema),
  validateBody(signAttendanceBodySchema),
  AttendanceController.publicSign
);

export default router;
