import type { InferSelectModel, whatsappContacts } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type WhatsappContact = InferSelectModel<typeof whatsappContacts>;

export const whatsappContactResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    whatsappChannelId: z.string().uuid(),
    clientId: z.string().uuid().nullable(),
    phoneE164: z.string(),
    whatsappE164: z.string().nullable().openapi({
      description:
        'E.164 que o WhatsApp efetivamente reconhece (cache do resolveNumber). ' +
        'Pode diferir de phoneE164 quando a conta WhatsApp não usa o nono ' +
        'dígito. Null = ainda não resolvido (worker resolve no primeiro envio).',
    }),
    profileName: z.string().nullable(),
    profilePictureUrl: z.string().nullable().openapi({
      description:
        'ObjectKey do MinIO. Frontend usa GET /whatsapp/contacts/{id}/profile-picture-url ' +
        'pra receber presigned URL com TTL.',
    }),
    optedInAt: z.string().datetime().nullable(),
    optInSource: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('WhatsappContact');

export const findContactsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(20).openapi({ example: 20 }),
    q: z.string().trim().min(1).optional(),
    channelId: z.string().uuid().optional(),
    // Tri-state: 'yes' (opted_in_at != null), 'no' (null), 'all' (sem filtro).
    optedIn: z.enum(['yes', 'no', 'all']).default('all'),
    // Tri-state: contatos com cliente vinculado, sem, ou todos.
    hasClient: z.enum(['yes', 'no', 'all']).default('all'),
  })
  .openapi('FindWhatsappContactsQuery');

export type FindContactsQuery = z.infer<typeof findContactsQuerySchema>;

// Query param do endpoint GET /whatsapp/numbers/check. Usado pelo cadastro
// de cliente/lead no frontend pra dar feedback em tempo real (verde/amarelo).
export const checkNumberQuerySchema = z
  .object({
    phoneE164: z
      .string()
      .trim()
      .regex(
        /^\+[1-9]\d{7,14}$/,
        'phoneE164 deve estar em formato E.164 (ex: +5511999999999)',
      )
      .openapi({ example: '+5511999999999' }),
  })
  .openapi('CheckNumberQuery');

export type CheckNumberQuery = z.infer<typeof checkNumberQuerySchema>;

export const checkNumberResponseSchema = z
  .object({
    onWhatsApp: z.boolean().openapi({
      description:
        'True se o número responde no WhatsApp via canal default do tenant.',
    }),
    whatsappE164: z
      .string()
      .nullable()
      .openapi({
        description:
          'E.164 que o WhatsApp efetivamente reconhece. Pode diferir do ' +
          'phoneE164 consultado por causa da quirk BR (celular cadastrado ' +
          'sem o nono dígito). Null quando onWhatsApp=false.',
        example: '+5531988887777',
      }),
    checkedAt: z.string().datetime(),
    reason: z
      .enum(['no_channel', 'provider_error'])
      .optional()
      .openapi({
        description:
          'Quando onWhatsApp=false: motivo opcional. `no_channel` = tenant sem ' +
          'canal cadastrado; `provider_error` = falha ao consultar Evolution. ' +
          'Ausente = número realmente não tem WhatsApp.',
      }),
  })
  .openapi('CheckNumberResponse');

export const contactIdParamSchema = z.object({
  id: z.string().uuid('ID inválido').openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

// Admin pode corrigir vinculações: linkar a um cliente, registrar opt-in manualmente
// (cliente assinou formulário, deu autorização verbal etc), atualizar profile name.
export const updateContactSchema = z
  .object({
    clientId: z.string().uuid().nullable().optional(),
    profileName: z.string().trim().max(255).nullable().optional(),
    optedInAt: z.coerce.date().nullable().optional(),
    optInSource: z
      .string()
      .trim()
      .max(64)
      .nullable()
      .optional()
      .openapi({ example: 'manual', description: 'Origem do opt-in: manual, form, etc.' }),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateWhatsappContactInput');

export type UpdateContactInput = z.infer<typeof updateContactSchema>;
