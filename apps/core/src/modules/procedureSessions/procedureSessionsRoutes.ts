import { Router, type Router as ExpressRouter } from 'express';
import { ProcedureSessionsController } from './ProcedureSessionsController.js';
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
  evolveProcedureSessionSchema,
  findProcedureSessionsQuerySchema,
  procedureSessionIdParamSchema,
  procedureSessionResponseSchema,
  updateProcedureSessionSchema,
} from './ProcedureSessionsTypes.js';

const TAG = 'ProcedureSessions';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const paginatedSchemaForList = paginatedSchema(
  procedureSessionResponseSchema,
  'PaginatedProcedureSessions'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/procedure-sessions',
  tags: [TAG],
  summary:
    'Lista sessões. Filtros: clientId, procedureId, treatmentId (via treatment_procedures), status.',
  security: REQUIRES_AUTH,
  request: { query: findProcedureSessionsQuerySchema },
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
  '/procedure-sessions',
  requirePermission('procedureSessions:read'),
  validateQuery(findProcedureSessionsQuerySchema),
  ProcedureSessionsController.find
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/procedure-sessions/{id}',
  tags: [TAG],
  summary: 'Busca sessão por ID',
  security: REQUIRES_AUTH,
  request: { params: procedureSessionIdParamSchema },
  responses: {
    200: {
      description: 'Sessão encontrada',
      content: { 'application/json': { schema: procedureSessionResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/procedure-sessions/:id',
  requirePermission('procedureSessions:read'),
  validateParams(procedureSessionIdParamSchema),
  ProcedureSessionsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/procedure-sessions/{id}',
  tags: [TAG],
  summary:
    'Atualiza observações clínicas (evolutionNotes). Permitido em qualquer status — edição clínica é livre pós-finalização.',
  security: REQUIRES_AUTH,
  request: {
    params: procedureSessionIdParamSchema,
    body: {
      content: { 'application/json': { schema: updateProcedureSessionSchema } },
    },
  },
  responses: {
    200: {
      description: 'Sessão atualizada',
      content: { 'application/json': { schema: procedureSessionResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.patch(
  '/procedure-sessions/:id',
  requirePermission('procedureSessions:write'),
  validateParams(procedureSessionIdParamSchema),
  validateBody(updateProcedureSessionSchema),
  ProcedureSessionsController.updateNotes
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/procedure-sessions/{id}/cancel',
  tags: [TAG],
  summary:
    'Cancela sessão (status=cancelled). Cancelled conta como "fora de pending" — dispara auto-complete check no treatment associado.',
  security: REQUIRES_AUTH,
  request: { params: procedureSessionIdParamSchema },
  responses: {
    200: {
      description: 'Sessão cancelada',
      content: { 'application/json': { schema: procedureSessionResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/procedure-sessions/:id/cancel',
  requirePermission('procedureSessions:write'),
  validateParams(procedureSessionIdParamSchema),
  ProcedureSessionsController.cancel
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/procedure-sessions/{id}/evolve',
  tags: [TAG],
  summary:
    'Encerra a evolução clínica: sessão `signed` → `done` com observações da aplicadora. Requer capacidade `canApplyProcedures`. Dispara auto-complete do treatment quando for a última sessão.',
  security: REQUIRES_AUTH,
  request: {
    params: procedureSessionIdParamSchema,
    body: {
      content: { 'application/json': { schema: evolveProcedureSessionSchema } },
    },
  },
  responses: {
    200: {
      description: 'Sessão evoluída',
      content: { 'application/json': { schema: procedureSessionResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/procedure-sessions/:id/evolve',
  requirePermission('procedureSessions:write'),
  validateParams(procedureSessionIdParamSchema),
  validateBody(evolveProcedureSessionSchema),
  ProcedureSessionsController.evolve
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/procedure-sessions/{id}/done',
  tags: [TAG],
  summary:
    'Override administrativo: marca sessão como done sem passar por `signed` nem exigir nota. Uso restrito (legacy/import/correção). Dispara auto-complete check.',
  security: REQUIRES_AUTH,
  request: { params: procedureSessionIdParamSchema },
  responses: {
    200: {
      description: 'Sessão marcada como done',
      content: { 'application/json': { schema: procedureSessionResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/procedure-sessions/:id/done',
  requirePermission('procedureSessions:delete'),
  validateParams(procedureSessionIdParamSchema),
  ProcedureSessionsController.markDoneManual
);

export default router;
