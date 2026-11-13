import { z } from '../../shared/openapi/registry.js';

export const webhookChannelParamSchema = z.object({
  channelId: z
    .string()
    .uuid('channelId inválido')
    .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export type WebhookChannelParam = z.infer<typeof webhookChannelParamSchema>;

// Body do webhook em modo Mock — referência pra Postman saber qual shape
// mandar. Evolution (provider real) tem shape próprio; o adapter normaliza
// tudo pra `NormalizedInboundEvent`. Aqui declaramos só o do Mock pra a
// UI do Postman gerar exemplo útil. Em prod, esse endpoint aceita qualquer
// JSON — adapter resolve.
export const mockWebhookBodySchema = z
  .discriminatedUnion('kind', [
    z
      .object({
        kind: z.literal('message_received'),
        externalId: z.string().min(1).optional(),
        from: z
          .string()
          .min(8)
          .openapi({ example: '+5511988887777', description: 'Telefone E.164 do remetente.' }),
        profileName: z.string().optional().openapi({ example: 'Maria' }),
        text: z.string().optional().openapi({ example: 'oi, gostaria de info' }),
      })
      .openapi('MockInboundMessage'),
    z
      .object({
        kind: z.literal('status_updated'),
        externalId: z.string().min(1).openapi({ example: 'ext_abc123' }),
        status: z.enum(['queued', 'sent', 'delivered', 'read', 'failed']),
        error: z.string().optional(),
      })
      .openapi('MockInboundStatus'),
    z
      .object({
        kind: z.literal('ignored'),
        reason: z.string().min(1),
      })
      .openapi('MockInboundIgnored'),
  ])
  .openapi('MockWebhookBody');

export const webhookQueuedResponseSchema = z
  .object({
    status: z.literal('queued').openapi({ example: 'queued' }),
  })
  .openapi('WebhookQueuedResponse');
