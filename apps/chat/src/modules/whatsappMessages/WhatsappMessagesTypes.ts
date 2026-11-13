import type { InferSelectModel, whatsappMessages } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type WhatsappMessage = InferSelectModel<typeof whatsappMessages>;

// Response schema — atualizar se schema.ts mudar whatsapp_messages.
export const whatsappMessageResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    whatsappConversationId: z.string().uuid(),
    externalId: z.string().nullable(),
    direction: z.enum(['inbound', 'outbound']),
    payloadType: z.string(),
    payload: z.record(z.unknown()).nullable(),
    status: z.string().nullable(),
    statusUpdatedAt: z.string().datetime().nullable(),
    errorMessage: z.string().nullable(),
    sentAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('WhatsappMessage');

export const whatsappMessageIdParamSchema = z.object({
  id: z.string().uuid('ID inválido').openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});
