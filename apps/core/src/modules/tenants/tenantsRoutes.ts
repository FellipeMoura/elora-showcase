import { Router, type Router as ExpressRouter } from 'express';
import multer from 'multer';
import { TenantsController } from './TenantsController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { loadUserRoles } from '../../shared/middleware/loadUserRoles.js';
import { requirePlatformAccess } from '../../shared/middleware/requirePlatformAccess.js';
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
  createTenantSchema,
  logoUrlResponseSchema,
  tenantIdParamSchema,
  tenantResponseSchema,
  tenantSummarySchema,
  updateTenantSchema,
  uploadLogoResponseSchema,
} from './TenantsTypes.js';

const TAG = 'Tenants';
const router: ExpressRouter = Router();

// memoryStorage: buffer direto pro MinIO, sem temp file no disco. 5MB é
// generoso pra logo (PNG bem otimizado fica < 100KB; margem cobre uploads
// sem otimização prévia). Validação de mimeType é feita no
// TenantLogoStorage (allow-list PNG/JPEG/WebP).
const uploadLogo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

router.use(ensureAuthenticated);
router.use(loadUserRoles);

const tenantsListSchema = z.array(tenantSummarySchema).openapi('TenantsList');

openApiRegistry.registerPath({
  method: 'get',
  path: '/tenants',
  tags: [TAG],
  summary: 'Lista tenants cadastrados (super-admin)',
  description:
    'Endpoint de super-admin — bloqueado pra qualquer tenant que não seja o platform. ' +
    'Usado pela UI de gerenciamento do catálogo de menus e da tela de tenants.',
  security: REQUIRES_AUTH,
  responses: {
    200: {
      description: 'Lista de tenants',
      content: { 'application/json': { schema: tenantsListSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get('/tenants', requirePlatformAccess, TenantsController.list);

openApiRegistry.registerPath({
  method: 'post',
  path: '/tenants',
  tags: [TAG],
  summary: 'Cria tenant (super-admin)',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createTenantSchema } } },
  },
  responses: {
    201: {
      description: 'Tenant criado',
      content: { 'application/json': { schema: tenantResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/tenants',
  requirePlatformAccess,
  validateBody(createTenantSchema),
  TenantsController.create
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/tenants/{id}',
  tags: [TAG],
  summary: 'Busca tenant por ID (super-admin)',
  security: REQUIRES_AUTH,
  request: { params: tenantIdParamSchema },
  responses: {
    200: {
      description: 'Tenant encontrado',
      content: { 'application/json': { schema: tenantResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/tenants/:id',
  requirePlatformAccess,
  validateParams(tenantIdParamSchema),
  TenantsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/tenants/{id}',
  tags: [TAG],
  summary:
    'Atualiza tenant (parcial). Slug é imutável — está embutido no subdomínio.',
  security: REQUIRES_AUTH,
  request: {
    params: tenantIdParamSchema,
    body: { content: { 'application/json': { schema: updateTenantSchema } } },
  },
  responses: {
    200: {
      description: 'Tenant atualizado',
      content: { 'application/json': { schema: tenantResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.patch(
  '/tenants/:id',
  requirePlatformAccess,
  validateParams(tenantIdParamSchema),
  validateBody(updateTenantSchema),
  TenantsController.update
);

// ---------- Logo ----------

openApiRegistry.registerPath({
  method: 'post',
  path: '/tenants/{id}/logo',
  tags: [TAG],
  summary: 'Upload de logo (super-admin)',
  description:
    'Persiste o arquivo no bucket de mídia (`elora-media`, prefixo ' +
    '`tenants/{tenantId}/logo.{ext}`) e grava o objectKey em ' +
    '`tenants.logo_url`. Aceita PNG, JPEG ou WebP. Limite de 5MB. ' +
    'Sobrescreve a versão anterior atomicamente.',
  security: REQUIRES_AUTH,
  request: {
    params: tenantIdParamSchema,
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            file: z.string().openapi({ format: 'binary' }),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Logo persistido',
      content: { 'application/json': { schema: uploadLogoResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.post(
  '/tenants/:id/logo',
  requirePlatformAccess,
  validateParams(tenantIdParamSchema),
  uploadLogo.single('file'),
  TenantsController.uploadLogo,
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/tenants/{id}/logo',
  tags: [TAG],
  summary: 'Remove logo do tenant (super-admin)',
  description:
    'Apaga o objeto no bucket (best-effort) e zera `tenants.logo_url`. ' +
    'Response é o tenant atualizado.',
  security: REQUIRES_AUTH,
  request: { params: tenantIdParamSchema },
  responses: {
    200: {
      description: 'Tenant atualizado',
      content: { 'application/json': { schema: tenantResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.delete(
  '/tenants/:id/logo',
  requirePlatformAccess,
  validateParams(tenantIdParamSchema),
  TenantsController.deleteLogo,
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/tenants/{id}/logo-url',
  tags: [TAG],
  summary: 'Presigned URL pra renderizar o logo do tenant',
  description:
    'Devolve URL temporária do bucket pra UI renderizar. Null se tenant ' +
    'sem logo persistido (UI cai no placeholder).',
  security: REQUIRES_AUTH,
  request: { params: tenantIdParamSchema },
  responses: {
    200: {
      description: 'URL gerada (ou null)',
      content: { 'application/json': { schema: logoUrlResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/tenants/:id/logo-url',
  requirePlatformAccess,
  validateParams(tenantIdParamSchema),
  TenantsController.getLogoUrl,
);

export default router;
