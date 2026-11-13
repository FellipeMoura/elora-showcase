import { Router, type Router as ExpressRouter } from 'express';
import { AuthController } from './AuthController.js';
import {
  loginResponseSchema,
  loginSchema,
  meResponseSchema,
} from './AuthTypes.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { validateBody } from '../../shared/middleware/validate.js';
import { loginRateLimit } from '../../shared/middleware/loginRateLimit.js';
import {
  ERROR_RESPONSES,
  REQUIRES_AUTH,
  openApiRegistry,
} from '../../shared/openapi/index.js';

// =====================================================================
// OpenAPI: tag "Auth". Login é rota pública (sem security); /me e /logout
// exigem auth via cookie OU bearer (declarado em REQUIRES_AUTH).
//
// Fluxo no Postman:
// 1. POST /auth/login com username+password → response setta cookie httpOnly
//    `elora_token`. Postman cookie jar salva automaticamente.
// 2. Qualquer endpoint subsequente com security funciona — cookie é
//    enviado pelo cookie jar.
// 3. Tenant: cada request precisa do header `Host` apontando pra um
//    subdomínio válido (ex: `clinica-a.localhost:5501`). Configure o
//    Host header em "Headers" das requests autenticadas no Postman.
// =====================================================================
const TAG = 'Auth';
const router: ExpressRouter = Router();

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/login',
  tags: [TAG],
  summary: 'Login por username + senha',
  description:
    'Recebe username e senha do tenant (subdomínio). Em sucesso: setta cookie ' +
    'httpOnly `elora_token` e retorna `user`. Cookie jar do Postman captura ' +
    'sozinho — requests seguintes ficam autenticados.',
  request: {
    body: {
      content: { 'application/json': { schema: loginSchema } },
    },
  },
  responses: {
    200: {
      description: 'Login bem-sucedido',
      content: { 'application/json': { schema: loginResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    429: ERROR_RESPONSES[429],
  },
});

router.post(
  '/auth/login',
  loginRateLimit,
  validateBody(loginSchema),
  AuthController.login
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/auth/me',
  tags: [TAG],
  summary: 'Retorna o usuário autenticado',
  security: REQUIRES_AUTH,
  responses: {
    200: {
      description: 'Dados do usuário logado',
      content: { 'application/json': { schema: meResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get('/auth/me', ensureAuthenticated, AuthController.me);

openApiRegistry.registerPath({
  method: 'post',
  path: '/auth/logout',
  tags: [TAG],
  summary: 'Encerra a sessão (limpa o cookie elora_token)',
  description:
    'Cookie httpOnly só pode ser limpo pelo servidor — esse endpoint emite o ' +
    '`Set-Cookie` com expiração imediata. Responde 204 sem body.',
  security: REQUIRES_AUTH,
  responses: {
    204: { description: 'Logout efetuado' },
    401: ERROR_RESPONSES[401],
  },
});

router.post('/auth/logout', ensureAuthenticated, AuthController.logout);

export default router;
