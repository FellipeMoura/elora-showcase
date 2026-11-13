import { Router, type Router as ExpressRouter } from 'express';
import { MeController } from './MeController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { validateBody } from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  REQUIRES_AUTH,
  openApiRegistry,
} from '../../shared/openapi/index.js';
import { userPreferencesSchema } from '../users/UsersTypes.js';
import { meUpdatePreferencesSchema } from './MeTypes.js';

const TAG = 'Me';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);

// =====================================================================
// /me/* — endpoints "self-service" do usuário corrente. Sem permission
// check além de auth: cada usuário pode ler e modificar suas próprias
// preferências, sempre.
// =====================================================================

openApiRegistry.registerPath({
  method: 'get',
  path: '/me/preferences',
  tags: [TAG],
  summary: 'Lê as preferências do usuário corrente',
  security: REQUIRES_AUTH,
  responses: {
    200: {
      description: 'Preferências (objeto pode estar vazio se nada foi setado)',
      content: { 'application/json': { schema: userPreferencesSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.get('/me/preferences', MeController.getPreferences);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/me/preferences',
  tags: [TAG],
  summary: 'Atualiza preferências do usuário (merge parcial)',
  description:
    'Faz merge JSONB no campo `users.preferences`. Chaves não enviadas são ' +
    'preservadas; chaves enviadas com `null` ou valor novo sobrescrevem.',
  security: REQUIRES_AUTH,
  request: {
    body: {
      content: { 'application/json': { schema: meUpdatePreferencesSchema } },
    },
  },
  responses: {
    200: {
      description: 'Preferências atualizadas (objeto completo retornado)',
      content: { 'application/json': { schema: userPreferencesSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.patch(
  '/me/preferences',
  validateBody(meUpdatePreferencesSchema),
  MeController.updatePreferences
);

export default router;
