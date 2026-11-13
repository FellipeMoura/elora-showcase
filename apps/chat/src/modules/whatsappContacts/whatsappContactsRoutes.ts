import { Router, type Router as ExpressRouter } from 'express';
import { WhatsappContactsController } from './WhatsappContactsController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  openApiRegistry,
  paginatedSchema,
  REQUIRES_AUTH,
} from '../../shared/openapi/index.js';
import { z } from '../../shared/openapi/registry.js';
import {
  checkNumberQuerySchema,
  checkNumberResponseSchema,
  contactIdParamSchema,
  findContactsQuerySchema,
  updateContactSchema,
  whatsappContactResponseSchema,
} from './WhatsappContactsTypes.js';

const profilePictureUrlResponseSchema = z
  .object({
    url: z.string().url().nullable().openapi({
      description: 'Presigned URL pra exibir o avatar. Null se contato sem foto.',
    }),
    expiresInSec: z.number().int().positive(),
  })
  .openapi('ProfilePictureUrlResponse');

const TAG = 'WhatsApp Contacts';
const router: ExpressRouter = Router();

router.use(ensureAuthenticated);

const paginatedContactsSchema = paginatedSchema(
  whatsappContactResponseSchema,
  'PaginatedWhatsappContacts'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/whatsapp/contacts',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Lista contatos WhatsApp do tenant',
  request: { query: findContactsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedContactsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
  },
});

router.get(
  '/whatsapp/contacts',
  requirePermission('chat:manage'),
  validateQuery(findContactsQuerySchema),
  WhatsappContactsController.find
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/whatsapp/contacts/{id}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Busca contato WhatsApp por ID',
  request: { params: contactIdParamSchema },
  responses: {
    200: {
      description: 'Contato encontrado',
      content: { 'application/json': { schema: whatsappContactResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/whatsapp/contacts/:id',
  validateParams(contactIdParamSchema),
  WhatsappContactsController.getById
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/whatsapp/contacts/{id}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Atualiza contato (link com client, opt-in manual, profile name)',
  request: {
    params: contactIdParamSchema,
    body: { content: { 'application/json': { schema: updateContactSchema } } },
  },
  responses: {
    200: {
      description: 'Contato atualizado',
      content: { 'application/json': { schema: whatsappContactResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.patch(
  '/whatsapp/contacts/:id',
  validateParams(contactIdParamSchema),
  validateBody(updateContactSchema),
  WhatsappContactsController.update
);

// ---------- Profile picture ----------

openApiRegistry.registerPath({
  method: 'post',
  path: '/whatsapp/contacts/{id}/refresh-profile-picture',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Re-fetch da foto de perfil do contato (Evolution → MinIO)',
  description:
    'Dispara getProfilePicture no provider, baixa o arquivo e re-uploada ' +
    'no MinIO. Sobrescreve a foto anterior. Quando o contato não tem foto, ' +
    'o campo profilePictureUrl fica null. Chamada manual — refresh ' +
    'automático ocorre apenas no first-inbound (opt-in implícito).',
  request: { params: contactIdParamSchema },
  responses: {
    200: {
      description: 'Contato com foto atualizada (ou limpa)',
      content: { 'application/json': { schema: whatsappContactResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    502: ERROR_RESPONSES[400],
  },
});

router.post(
  '/whatsapp/contacts/:id/refresh-profile-picture',
  validateParams(contactIdParamSchema),
  WhatsappContactsController.refreshProfilePicture,
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/whatsapp/contacts/{id}/profile-picture-url',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Presigned URL pra renderizar o avatar do contato',
  description:
    'Devolve URL temporária do MinIO pra UI renderizar o avatar. Null se ' +
    'contato sem foto persistida (frontend mostra avatar default).',
  request: { params: contactIdParamSchema },
  responses: {
    200: {
      description: 'URL gerada (ou null)',
      content: { 'application/json': { schema: profilePictureUrlResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/whatsapp/contacts/:id/profile-picture-url',
  validateParams(contactIdParamSchema),
  WhatsappContactsController.getProfilePictureUrl,
);

// ---------- Number check (sem contato) ----------

openApiRegistry.registerPath({
  method: 'get',
  path: '/whatsapp/numbers/check',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Verifica se número responde no WhatsApp via canal default do tenant',
  description:
    'Usado pelo cadastro de cliente/lead pra dar feedback em tempo real ' +
    '(verde quando há WhatsApp, amarelo quando não). Cross-tenant a chamada ' +
    'usa o canal active+open primeiro disponível. Retorna onWhatsApp=false ' +
    'com reason quando tenant não tem canal ou provider falhou — UX trata ' +
    'como warning, não bloqueia cadastro.',
  request: { query: checkNumberQuerySchema },
  responses: {
    200: {
      description: 'Resultado da verificação',
      content: { 'application/json': { schema: checkNumberResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
  },
});

router.get(
  '/whatsapp/numbers/check',
  validateQuery(checkNumberQuerySchema),
  WhatsappContactsController.checkNumber,
);

// Sem POST e DELETE no admin: contatos nascem via webhook (inbound) e
// removê-los apaga histórico de mensagens em cascata. Caso precise, fazer
// via SQL direto + audit.

export default router;
