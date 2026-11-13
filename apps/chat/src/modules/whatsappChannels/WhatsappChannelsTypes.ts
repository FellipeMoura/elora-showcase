import type { InferSelectModel, whatsappChannels } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type WhatsappChannel = InferSelectModel<typeof whatsappChannels>;

// Lista fechada de providers suportados — espelha o enum do schema
// (whatsapp_provider_type). Adicionar provider novo exige migration + adapter.
// `baileys` = WhatsApp Web não-oficial (Evolution-Baileys); `meta_cloud` =
// Cloud API oficial (Evolution-Business).
const providerTypeEnum = z
  .enum(['baileys', 'meta_cloud'])
  .openapi({ example: 'baileys', description: 'Tipo de provider WhatsApp.' });

// provider_config tem forma diferente por modo. Por ora aceita objeto livre —
// validação forte acontece no EvolutionAdapter quando ele tentar usar as
// credenciais (falha amigável "config inválida" lá). Pra Evolution real:
// `{ baseUrl, instanceName, apiKey, integration, webhookToken }`.
const providerConfigSchema = z
  .record(z.unknown())
  .default({})
  .openapi({
    example: { mock: true },
    description:
      'Configuração específica do provider (credenciais Evolution, ' +
      '`mock: true` em dev). Schema livre por provider — adapter valida.',
  });

// Response: schema escrito à mão pra OpenAPI. Tentamos derivar via
// `createSelectSchema` do drizzle-zod, mas drizzle-zod@0.8.x usa Zod v4 (sub-
// export 'zod/v4') enquanto zod-to-openapi@7.x estende Zod v3 — incompatível.
// Quando subirmos tudo pra Zod v4 + zod-to-openapi@8, dá pra automatizar.
//
// **Manutenção:** se mudar `whatsappChannels` em packages/db/src/schema.ts,
// atualiza esse schema também.
export const whatsappChannelResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    providerType: providerTypeEnum,
    providerConfig: z.record(z.unknown()),
    phoneNumber: z.string().nullable(),
    active: z.boolean(),
    // Estado do socket reportado pelo provider via CONNECTION_UPDATE.
    // null = nunca recebemos (recém-provisionado, mock, ou pré-feature).
    connectionState: z
      .enum(['open', 'connecting', 'closed', 'unknown'])
      .nullable(),
    connectionStateAt: z.string().datetime().nullable(),
    // Cor de destaque hex `#RRGGBB`. null = sem cor (UI usa default).
    color: z.string().nullable(),
    // Datas vêm como ISO 8601 em JSON.
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('WhatsappChannel');

// Hex `#RRGGBB` (sem alpha). Aceitamos 6 chars pra não complicar input — UI
// usa color picker nativo que devolve nesse formato. Maiúscula/minúscula OK.
const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Cor deve ser hex no formato #RRGGBB');

export const createChannelSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'WhatsApp Recepção' }),
    providerType: providerTypeEnum,
    providerConfig: providerConfigSchema,
    phoneNumber: z
      .string()
      .trim()
      .max(32)
      .optional()
      .openapi({ example: '+5511988887777' }),
    color: hexColorSchema
      .optional()
      .openapi({ example: '#25D366', description: 'Cor de destaque hex.' }),
  })
  .openapi('CreateWhatsappChannelInput');

export type CreateChannelInput = z.infer<typeof createChannelSchema>;

export const updateChannelSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    providerType: providerTypeEnum.optional(),
    providerConfig: providerConfigSchema.optional(),
    phoneNumber: z.string().trim().max(32).nullable().optional(),
    color: hexColorSchema.nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateWhatsappChannelInput');

export type UpdateChannelInput = z.infer<typeof updateChannelSchema>;

export const findChannelsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .openapi({ example: 20 }),
    q: z
      .string()
      .trim()
      .min(1)
      .optional()
      .openapi({ example: 'recepção', description: 'Busca em name + phone_number.' }),
    providerType: providerTypeEnum.optional(),
    status: z
      .enum(['active', 'inactive', 'all'])
      .default('active')
      .openapi({ example: 'active' }),
  })
  .openapi('FindWhatsappChannelsQuery');

export type FindChannelsQuery = z.infer<typeof findChannelsQuerySchema>;

export const channelIdParamSchema = z.object({
  id: z.string().uuid('ID inválido').openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

// Response do GET /qr — espelha QrCodeResult de EvolutionAdmin.
export const channelQrCodeResponseSchema = z
  .object({
    base64: z
      .string()
      .nullable()
      .openapi({
        description:
          'Data URL base64 do QR code. `null` quando instância já está conectada.',
      }),
    pairingCode: z
      .string()
      .optional()
      .openapi({
        description: 'Código alternativo pra pareamento via número (Evolution v2).',
      }),
  })
  .openapi('WhatsappChannelQrCode');

// Response do POST /purge-conversations — quantos registros foram apagados.
export const purgeChannelConversationsResponseSchema = z
  .object({
    conversations: z.number().int(),
    messages: z.number().int(),
    contacts: z.number().int(),
    whatsappMessages: z.number().int(),
  })
  .openapi('WhatsappChannelPurgeResult');

export type PurgeChannelConversationsResult = z.infer<
  typeof purgeChannelConversationsResponseSchema
>;

// Response do GET /connection-state — espelha ConnectionStateResult.
export const channelConnectionStateResponseSchema = z
  .object({
    state: z.enum(['open', 'connecting', 'closed', 'unknown']),
    raw: z.record(z.unknown()).openapi({
      description: 'Payload bruto da Evolution pra debug (não usar pra lógica).',
    }),
  })
  .openapi('WhatsappChannelConnectionState');
