import { Router, type Router as ExpressRouter } from 'express';
import multer from 'multer';
import { MessagesController } from './MessagesController.js';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
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
  conversationIdParamSchema,
  editMessageSchema,
  findMessagesQuerySchema,
  mediaUrlResponseSchema,
  messageIdParamSchema,
  messageResponseSchema,
  postInternalNoteSchema,
  sendMessageSchema,
  uploadMediaResponseSchema,
} from './MessagesTypes.js';

const TAG = 'Messages';
const router: ExpressRouter = Router();

// Limite generoso pra WhatsApp (~16MB hard cap real); 20MB cobre margem.
// memoryStorage: Buffer fica em RAM, é repassado direto pro MinIO sem temp
// file. Custo é manter o arquivo em memória até o handler responder — ok
// pros tamanhos esperados.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

router.use(ensureAuthenticated);

const paginatedMessagesSchema = paginatedSchema(messageResponseSchema, 'PaginatedMessages');

openApiRegistry.registerPath({
  method: 'get',
  path: '/conversations/{conversationId}/messages',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Lista mensagens da conversation (paginação reversa)',
  request: {
    params: conversationIdParamSchema,
    query: findMessagesQuerySchema,
  },
  responses: {
    200: {
      description: 'Lista paginada — mais recentes primeiro',
      content: { 'application/json': { schema: paginatedMessagesSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/conversations/:conversationId/messages',
  validateParams(conversationIdParamSchema),
  validateQuery(findMessagesQuerySchema),
  MessagesController.list
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/conversations/{conversationId}/notes',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Anotação interna entre staff (não vai pro WhatsApp)',
  request: {
    params: conversationIdParamSchema,
    body: { content: { 'application/json': { schema: postInternalNoteSchema } } },
  },
  responses: {
    201: {
      description: 'Nota criada',
      content: { 'application/json': { schema: messageResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.post(
  '/conversations/:conversationId/notes',
  validateParams(conversationIdParamSchema),
  validateBody(postInternalNoteSchema),
  MessagesController.postNote
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/conversations/{conversationId}/messages',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Envia mensagem WhatsApp (outbound)',
  description:
    'Resolve canal via contato do cliente, valida opt-in e janela 24h, dispara ' +
    'via adapter (Mock/Evolution) e persiste em transport + domain layers. ' +
    'Template fura a janela de 24h — text/media só dentro dela.',
  request: {
    params: conversationIdParamSchema,
    body: { content: { 'application/json': { schema: sendMessageSchema } } },
  },
  responses: {
    201: {
      description: 'Mensagem enviada',
      content: { 'application/json': { schema: messageResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/conversations/:conversationId/messages',
  validateParams(conversationIdParamSchema),
  validateBody(sendMessageSchema),
  MessagesController.send
);

// ---------- Upload de mídia (multipart) ----------

openApiRegistry.registerPath({
  method: 'post',
  path: '/conversations/{conversationId}/upload-media',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Upload de arquivo pra mídia outbound',
  description:
    'Persiste o arquivo no MinIO e devolve objectKey + presigned URL. ' +
    'O objectKey vai em `mediaObjectKey` no POST /messages pra confirmar ' +
    'o envio. Limite de 20MB por arquivo.',
  request: {
    params: conversationIdParamSchema,
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
      description: 'Upload concluído',
      content: { 'application/json': { schema: uploadMediaResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    413: ERROR_RESPONSES[400],
  },
});

router.post(
  '/conversations/:conversationId/upload-media',
  validateParams(conversationIdParamSchema),
  upload.single('file'),
  MessagesController.uploadMedia,
);

// ---------- Presigned URL pra mídia já gravada ----------

openApiRegistry.registerPath({
  method: 'get',
  path: '/messages/{messageId}/media-url',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Devolve presigned URL pra download da mídia',
  description:
    'Frontend chama on-demand quando vai renderizar mídia. URL tem TTL ' +
    'configurado (env.minio.presignedUrlTtlSec, default 7d). Funciona ' +
    'pra inbound e outbound — qualquer message com mediaUrl populado.',
  request: { params: messageIdParamSchema },
  responses: {
    200: {
      description: 'URL gerada',
      content: { 'application/json': { schema: mediaUrlResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/messages/:messageId/media-url',
  validateParams(messageIdParamSchema),
  MessagesController.getMediaUrl,
);

// ---------- Edit (PATCH) ----------

openApiRegistry.registerPath({
  method: 'patch',
  path: '/messages/{messageId}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Edita texto de mensagem outbound',
  description:
    'WhatsApp permite editar até ~15min após o envio — fora dessa janela o ' +
    'provider devolve 400. V1 só edita kind="text"; caption de mídia fica ' +
    'pra V2. UI exibe badge "editada" no histórico (campo `editedAt` no ' +
    'response).',
  request: {
    params: messageIdParamSchema,
    body: { content: { 'application/json': { schema: editMessageSchema } } },
  },
  responses: {
    200: {
      description: 'Mensagem editada',
      content: { 'application/json': { schema: messageResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.patch(
  '/messages/:messageId',
  validateParams(messageIdParamSchema),
  validateBody(editMessageSchema),
  MessagesController.edit,
);

// ---------- Revoke (DELETE) ----------

openApiRegistry.registerPath({
  method: 'delete',
  path: '/messages/{messageId}',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Revoga mensagem outbound ("apagar pra cliente")',
  description:
    'Soft delete: registro permanece no banco com `deletedAt` + ' +
    '`deletionOrigin="staff"`. Frontend deve esconder body/mediaUrl e ' +
    'mostrar texto neutro ("Você apagou esta mensagem"). Idempotente — ' +
    'chamar de novo na mesma msg devolve o estado atual.',
  request: { params: messageIdParamSchema },
  responses: {
    200: {
      description: 'Mensagem revogada (soft delete)',
      content: { 'application/json': { schema: messageResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
  },
});

router.delete(
  '/messages/:messageId',
  validateParams(messageIdParamSchema),
  MessagesController.revoke,
);

// ---------- Retry (POST) ----------

openApiRegistry.registerPath({
  method: 'post',
  path: '/messages/{messageId}/retry',
  tags: [TAG],
  security: REQUIRES_AUTH,
  summary: 'Re-enfileira mensagem outbound em estado de falha',
  description:
    'Aciona "Tentar novamente" sobre uma bolha `failed` ou `rejected`. ' +
    'Reseta `delivery_status` pra `pending`, limpa `failureReason`/' +
    '`failureDetail` e re-enfileira o job no worker — pre-flight (opt-in, ' +
    'canal, janela, OutboundGuard) roda inteiro de novo. Se a causa raiz ' +
    'não foi corrigida (ex: contato ainda sem opt-in), volta a rejected. ' +
    'Idempotente: clicar 2x devolve estado atual sem duplicar envio.',
  request: { params: messageIdParamSchema },
  responses: {
    200: {
      description: 'Mensagem reenviada (delivery_status="pending")',
      content: { 'application/json': { schema: messageResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/messages/:messageId/retry',
  validateParams(messageIdParamSchema),
  MessagesController.retry,
);

export default router;
