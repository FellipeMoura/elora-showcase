import type { InferSelectModel, messages } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type Message = InferSelectModel<typeof messages>;

// Response: schema escrito à mão. Atualizar se schema.ts mudar `messages`.
//
// `mediaUrl` aqui é o objectKey estável do MinIO (não é URL de download).
// Frontend troca por presigned URL via GET /messages/:id/media-url quando
// for renderizar — presigned tem TTL curto e não vale incluir na listagem.
export const messageResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    conversationId: z.string().uuid(),
    journeyId: z.string().uuid().nullable(),
    direction: z.enum(['inbound', 'outbound', 'internal_note']),
    kind: z.enum(['text', 'media', 'template', 'system', 'sticker', 'call']),
    body: z.string().nullable(),
    mediaUrl: z.string().nullable().openapi({
      description:
        'ObjectKey do MinIO (path estável). NÃO é URL de download — use ' +
        'GET /messages/{id}/media-url pra receber presigned URL com TTL.',
    }),
    mediaType: z
      .enum(['image', 'audio', 'video', 'document', 'sticker'])
      .nullable(),
    callPayload: z
      .object({
        direction: z.enum(['inbound', 'outbound']),
        status: z.enum(['missed', 'received', 'declined']),
        durationSec: z.number().int().nonnegative().optional(),
        startedAt: z.string().datetime(),
      })
      .nullable(),
    editedAt: z.string().datetime().nullable(),
    deletedAt: z.string().datetime().nullable(),
    deletionOrigin: z.enum(['client', 'staff', 'system']).nullable(),
    templateId: z.string().uuid().nullable(),
    templateVariables: z.record(z.string()).nullable().openapi({
      description:
        'Variáveis usadas pra renderizar o template — preservadas pro worker ' +
        'outbound usar na construção do payload Cloud API. Null quando ' +
        'kind != "template".',
    }),
    whatsappMessageId: z.string().uuid().nullable(),
    replyToMessageId: z.string().uuid().nullable().openapi({
      description:
        'Id da mensagem citada/respondida (mesma conversa). Frontend usa pra ' +
        'renderizar bloco "respondendo a…" acima da bolha — o snapshot ' +
        '(body/kind/mediaType) é resolvido do próprio cache da timeline, ' +
        'sem chamada extra. Null quando não é reply.',
    }),
    authorUserId: z.string().uuid().nullable(),
    authoredOnDevice: z.boolean().openapi({
      description:
        'True quando a mensagem outbound foi enviada direto pelo celular ' +
        'pareado (capturada via webhook) em vez de pela UI do Elora. ' +
        'Frontend usa pra marcar visualmente.',
    }),
    deliveryStatus: z
      .enum(['pending', 'sent', 'failed', 'rejected'])
      .openapi({
        description:
          'Estado de entrega da mensagem outbound. Inbound e internal_note ' +
          'nascem "sent". Outbound da UI nasce "pending" e o worker atualiza ' +
          'pra "sent" (sucesso), "failed" (adapter falhou) ou "rejected" ' +
          '(pre-flight bloqueou — sem opt-in, canal off, etc).',
      }),
    failureReason: z
      .enum([
        'no_opt_in',
        'channel_disconnected',
        'window_24h_expired',
        'invalid_template',
        'rate_limited',
        'provider_error',
        'worker_timeout',
        'unknown',
      ])
      .nullable()
      .openapi({
        description:
          'Motivo da falha/rejeição. Frontend mapeia pra label PT-BR + ação ' +
          'contextual no botão da bolha (ex: "no_opt_in" → "Pedir opt-in").',
      }),
    failureDetail: z
      .record(z.unknown())
      .nullable()
      .openapi({
        description:
          'Contexto rico do erro (status code provider, retryAfterSec, ' +
          'mensagem bruta). Usado em tooltips avançados e audit — UI ' +
          'principal usa só failureReason.',
      }),
    sentAt: z.string().datetime().nullable(),
    deliveredAt: z.string().datetime().nullable(),
    readAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Message');

export const findMessagesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(50).openapi({ example: 50 }),
    // Filtra por jornada — útil pra ver só msgs de uma journey específica
    // quando cliente tem N journeys paralelas (chat-domain.md §11.3).
    journeyId: z.string().uuid().optional(),
    // 'all' inclui internal_note; 'public' exclui (caso UI queira esconder
    // notas internas em algum view).
    visibility: z.enum(['all', 'public']).default('all'),
  })
  .openapi('FindMessagesQuery');

export type FindMessagesQuery = z.infer<typeof findMessagesQuerySchema>;

export const conversationIdParamSchema = z.object({
  conversationId: z
    .string()
    .uuid('conversationId inválido')
    .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

// POST /conversations/:conversationId/notes — anotação interna entre staff.
// Não vai pro WhatsApp. journeyId opcional pra taggar a nota (atualiza
// last_activity_at da journey conforme §10.1).
export const postInternalNoteSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'Texto obrigatório')
      .max(4096)
      .openapi({ example: 'Cliente prefere atendimento à tarde.' }),
    journeyId: z.string().uuid().optional(),
  })
  .openapi('PostInternalNoteInput');

export type PostInternalNoteInput = z.infer<typeof postInternalNoteSchema>;

// =====================================================================
// POST /conversations/:conversationId/messages — outbound real WhatsApp.
//
// Discriminated union em `kind` deixa cada variante carregar só os campos
// que faz sentido:
//   - text: precisa `body`
//   - media: precisa `mediaUrl` + `mediaType`
//   - template: precisa `templateId` + opcional `templateVariables`
//
// `journeyId` é opcional em qualquer variante — quando informado, a
// mensagem é taggada e `journey.last_activity_at` é tocado.
// =====================================================================

const sendMessageBase = z.object({
  journeyId: z
    .string()
    .uuid()
    .optional()
    .openapi({ description: 'Tag a mensagem com uma journey específica.' }),
  // Disambiguação quando cliente tem 2+ whatsapp_contacts. Tipicamente
  // omitido (Service auto-resolve o único contato).
  whatsappContactId: z.string().uuid().optional(),
  // Mensagem que está sendo respondida ("quote/reply"). Validado em service:
  // tem que pertencer à mesma conversation e ter whatsapp_message_id (sem
  // externalId não dá pra montar o quoted pro Evolution). Internal_note não
  // pode ser respondida (não saiu pro WhatsApp).
  replyToMessageId: z
    .string()
    .uuid()
    .optional()
    .openapi({
      description:
        'Id de uma mensagem da mesma conversa pra responder/citar. Backend ' +
        'monta o quoted nativo do WhatsApp pelo whatsapp_message_id da alvo.',
    }),
});

export const sendTextSchema = sendMessageBase.extend({
  kind: z.literal('text'),
  body: z
    .string()
    .trim()
    .min(1, 'Texto obrigatório')
    .max(4096)
    .openapi({ example: 'Oi Maria! Tudo certo pra sua sessão amanhã?' }),
});

export const sendMediaSchema = sendMessageBase.extend({
  kind: z.literal('media'),
  // ObjectKey devolvido por POST /conversations/:id/upload-media. Backend
  // gera presigned URL no ato do envio pra repassar ao adapter (Evolution
  // precisa de URL HTTP acessível). Salvar URL externa direto não é
  // suportado — todo arquivo passa pelo MinIO primeiro.
  mediaObjectKey: z.string().min(1).openapi({
    example: '550e8400.../channel.../2026/05/18/abc-foto.jpg',
    description: 'ObjectKey retornado por POST /conversations/{id}/upload-media',
  }),
  mediaType: z.enum(['image', 'audio', 'video', 'document']),
  caption: z.string().max(1024).optional(),
});

export const sendTemplateSchema = sendMessageBase.extend({
  kind: z.literal('template'),
  templateId: z
    .string()
    .uuid()
    .openapi({ description: 'ID de message_templates do tenant.' }),
  templateVariables: z
    .record(z.string())
    .default({})
    .openapi({
      example: { nome: 'Maria', hora: '14h', unidade: 'Matriz' },
      description:
        'Variáveis substituídas no body do template. Chaves no body como ' +
        '`{{nome}}` viram o valor passado.',
    }),
});

export const sendMessageSchema = z
  .discriminatedUnion('kind', [sendTextSchema, sendMediaSchema, sendTemplateSchema])
  .openapi('SendMessageInput');

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

// =====================================================================
// POST /conversations/:conversationId/upload-media — multipart upload de
// arquivo pra MinIO. Devolve objectKey + presigned URL.
//
// Frontend faz upload primeiro, depois passa `mediaObjectKey` no
// /messages pra confirmar o envio. Separar upload de envio:
//   - Permite mostrar preview pré-envio sem comprometer histórico
//   - Permite cancelar/trocar arquivo antes do disparo
//   - Upload pesado não trava a request de envio (sem timeout no adapter)
// =====================================================================

export const uploadMediaResponseSchema = z
  .object({
    objectKey: z.string().openapi({
      description: 'Path estável no MinIO. Passe em mediaObjectKey no /messages.',
    }),
    presignedUrl: z.string().url().openapi({
      description: 'URL temporária pra preview/download. TTL configurável.',
    }),
    size: z.number().int().nonnegative(),
    mimeType: z.string(),
  })
  .openapi('UploadMediaResponse');

export type UploadMediaResponse = z.infer<typeof uploadMediaResponseSchema>;

// GET /messages/:messageId/media-url — devolve presigned URL de download
// pra mensagem que tem mediaUrl (objectKey). Frontend usa quando vai
// renderizar a mídia, evita carregar todas as URLs na listagem.
export const messageIdParamSchema = z.object({
  messageId: z.string().uuid('messageId inválido'),
});

// PATCH /messages/:messageId — staff edita texto de msg outbound.
// V1 só `body` é editável (caption de mídia fica pra V2).
export const editMessageSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, 'Texto obrigatório')
      .max(4096)
      .openapi({ example: 'Oi! Reagendei pra amanhã às 14h.' }),
  })
  .openapi('EditMessageInput');

export type EditMessageInput = z.infer<typeof editMessageSchema>;

export const mediaUrlResponseSchema = z
  .object({
    url: z.string().url(),
    expiresInSec: z.number().int().positive(),
  })
  .openapi('MediaUrlResponse');

export type MediaUrlResponse = z.infer<typeof mediaUrlResponseSchema>;
