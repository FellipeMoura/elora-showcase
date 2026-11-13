import { Router, type Router as ExpressRouter } from 'express';
import { ERROR_RESPONSES, openApiRegistry, z } from '../../shared/openapi/index.js';
import { ContractsWebhookController } from './ContractsWebhookController.js';

// Rota pública — endpoint configurado no painel da ZapSign. NÃO passa pelo
// tenantContextMiddleware (ZapSign não conhece subdomínio); tenant é
// resolvido via SECURITY DEFINER function no controller.

const router: ExpressRouter = Router();

// Schema solto — ZapSign manda payloads com forma variada por tipo de
// evento. O adapter (`normalizeWebhook`) consome os campos relevantes e
// preserva o resto em metadata.
const zapsignWebhookPayloadSchema = z
  .object({
    event_type: z.string().optional().openapi({ example: 'doc_signed' }),
    token: z.string().optional().openapi({
      description: 'ID/token do documento na ZapSign (= zapsign_document_id em contracts).',
    }),
    status: z.string().optional(),
    signed_at: z.string().optional(),
    signed_file: z.string().optional().nullable(),
  })
  .passthrough()
  .openapi('ZapSignWebhookPayload');

const webhookAckResponseSchema = z
  .object({
    status: z.enum(['processed', 'ignored']),
    reason: z.string().optional(),
  })
  .openapi('SignatureWebhookAck');

openApiRegistry.registerPath({
  method: 'post',
  path: '/webhooks/zapsign',
  tags: ['Webhooks'],
  summary: 'Webhook do ZapSign (eventos de assinatura)',
  description:
    'Endpoint público. Resolve tenant via `resolve_contract_tenant(zapsign_document_id)`, ' +
    'valida `X-Elora-Webhook-Token` (configurado no painel ZapSign), normaliza o evento ' +
    'e atualiza o contrato (status, signedAt, signedPdfObjectKey, etc). Idempotente — ' +
    'eventos repetidos são absorvidos sem efeito colateral.',
  request: {
    body: {
      content: { 'application/json': { schema: zapsignWebhookPayloadSchema } },
    },
  },
  responses: {
    200: {
      description: 'Processado ou acknowledged (caller não deve retentar)',
      content: { 'application/json': { schema: webhookAckResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    500: ERROR_RESPONSES[500],
  },
});

router.post('/webhooks/zapsign', ContractsWebhookController.zapsign);

export default router;
