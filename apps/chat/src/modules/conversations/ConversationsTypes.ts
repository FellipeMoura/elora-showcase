import type { InferSelectModel, conversations } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type Conversation = InferSelectModel<typeof conversations>;

// View enriquecida com dados do cliente embedded + agregados que a UI da
// inbox precisa pra renderizar (preview da última msg, badge de não-lidas).
// Calculados via subqueries em ConversationsQuery — evita N+1 do frontend.
export interface ConversationWithClient extends Conversation {
  client: {
    id: string;
    name: string;
    phoneE164: string;
    isVip: boolean;
  };
  // Canal de origem da conversa (cada conv é por par cliente×canal). UI usa
  // pra diferenciar visualmente mesmo cliente em canais diferentes.
  channel: {
    id: string;
    name: string;
    // Hex `#RRGGBB` ou null. Frontend aplica como border/highlight nos
    // MinimizedCards e FloatingChatWindow.
    color: string | null;
    // Track do provider (`baileys`, `meta_cloud`). Frontend usa pra decidir
    // composer (Cloud → swap pra TemplateComposer fora da janela 24h;
    // Baileys → composer livre, sem opção de template).
    providerType: string;
  };
  // ID do whatsapp_contact correspondente (par cliente×canal). Frontend usa
  // pra resolver `GET /whatsapp/contacts/:id/profile-picture-url` e exibir
  // avatar. Null quando conversa foi criada artificialmente sem contact
  // vinculado — caso raro, UI cai pra inicial colorida.
  whatsappContactId: string | null;
  unreadCount: number;
  // Truncado em 200 chars no backend. Pra mídia sem body, vem `null` — UI
  // resolve fallback baseado em `lastMessageKind` + `lastMessageMediaType`
  // (ex.: "Imagem", "Mensagem de voz", "Figurinha").
  lastMessagePreview: string | null;
  lastMessageDirection: 'inbound' | 'outbound' | 'internal_note' | null;
  // Kind da última mensagem da conversa. Frontend usa pra renderizar preview
  // adequada quando `lastMessagePreview` é null (mídia sem caption, sticker,
  // call). Null quando a conversa não tem nenhuma mensagem.
  lastMessageKind:
    | 'text'
    | 'media'
    | 'template'
    | 'system'
    | 'sticker'
    | 'call'
    | null;
  // Tipo da mídia da última mensagem (só relevante quando kind='media').
  // Null pra outros kinds ou quando a conversa não tem mensagens.
  lastMessageMediaType:
    | 'image'
    | 'audio'
    | 'video'
    | 'document'
    | 'sticker'
    | null;
  // Último inbound do WhatsApp (whatsapp_conversations.last_inbound_at).
  // Frontend usa pra calcular a janela de 24h e decidir entre composer de
  // texto livre ou composer de templates. Null quando nunca houve inbound
  // (ou conversation criada sem wa_conv linkada).
  lastInboundAt: Date | null;
  // Stage da journey ativa do cliente. Null quando não tem journey ativa
  // (cliente cadastrado sem lead ou todas fechadas). Frontend exibe como
  // chip na sidebar item pra dar contexto rápido do estado do funil.
  currentJourneyStage:
    | 'lead'
    | 'evaluation'
    | 'sale'
    | 'treatment'
    | 'result'
    | null;
  // Substage da journey ativa quando stage='lead'. Null nos demais stages
  // ou quando não há journey ativa. UI prefere mostrar substage no chip
  // quando disponível (mais informativo que "Lead" genérico).
  currentLeadSubstage:
    | 'new'
    | 'template'
    | 'contact'
    | 'scheduled'
    | 'no_show'
    | 'rescheduled'
    | 'quoted'
    | null;
}

// Response schemas pro OpenAPI. Atualizar se schema.ts mudar conversations
// ou clients.
export const conversationResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    clientId: z.string().uuid(),
    whatsappChannelId: z.string().uuid(),
    lastMessageAt: z.string().datetime().nullable(),
    lastStaffSeenAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Conversation');

export const conversationWithClientResponseSchema = conversationResponseSchema
  .extend({
    client: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        phoneE164: z.string(),
        isVip: z.boolean(),
      })
      .openapi('ConversationClientSummary'),
    channel: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        color: z.string().nullable(),
        providerType: z.string().openapi({
          example: 'baileys',
          description:
            'Track do provider (baileys | meta_cloud | mock). Frontend usa ' +
            'pra decidir composer e quais features mostrar.',
        }),
      })
      .openapi('ConversationChannelSummary'),
    whatsappContactId: z.string().uuid().nullable().openapi({
      description:
        'ID do whatsapp_contact (par client×channel). Frontend usa pra ' +
        'resolver foto de perfil via GET /whatsapp/contacts/{id}/profile-picture-url.',
    }),
    unreadCount: z.number().int().nonnegative(),
    lastMessagePreview: z.string().nullable(),
    lastMessageDirection: z
      .enum(['inbound', 'outbound', 'internal_note'])
      .nullable(),
    lastMessageKind: z
      .enum(['text', 'media', 'template', 'system', 'sticker', 'call'])
      .nullable(),
    lastMessageMediaType: z
      .enum(['image', 'audio', 'video', 'document', 'sticker'])
      .nullable(),
    lastInboundAt: z.string().datetime().nullable().openapi({
      description:
        'Último inbound do WhatsApp (whatsapp_conversations.last_inbound_at). ' +
        'Frontend usa pra calcular a janela de 24h e exibir composer adequado ' +
        '(texto livre vs. templates).',
    }),
    currentJourneyStage: z
      .enum(['lead', 'evaluation', 'sale', 'treatment', 'result'])
      .nullable()
      .openapi({
        description:
          'Stage da journey ativa do cliente (invariante: 1 ativa por cliente). ' +
          'Null quando não há journey ativa. Frontend usa pra exibir chip de ' +
          'estado do funil na sidebar item.',
      }),
    currentLeadSubstage: z
      .enum([
        'new',
        'template',
        'contact',
        'scheduled',
        'no_show',
        'rescheduled',
        'quoted',
      ])
      .nullable()
      .openapi({
        description:
          'Substage da journey ativa quando stage=lead. Null nos demais ' +
          'stages ou sem journey ativa. UI prefere o chip de substage ao ' +
          'chip genérico "Lead" quando disponível.',
      }),
  })
  .openapi('ConversationWithClient');

export const findConversationsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(20).openapi({ example: 20 }),
    // Busca pelo nome ou telefone do cliente.
    q: z.string().trim().min(1).optional(),
    // Filtra só conversas com mensagem recente (útil pra "inbox" ativa).
    hasMessages: z.coerce.boolean().optional(),
  })
  .openapi('FindConversationsQuery');

export type FindConversationsQuery = z.infer<typeof findConversationsQuerySchema>;

export const conversationIdParamSchema = z.object({
  id: z.string().uuid('ID inválido').openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export const findOrCreateConversationSchema = z
  .object({
    clientId: z.string().uuid('clientId inválido'),
    // Opcional: sem ele o backend escolhe o canal (ver Service).
    whatsappChannelId: z.string().uuid('whatsappChannelId inválido').optional(),
  })
  .openapi('FindOrCreateConversationInput');

export type FindOrCreateConversationInput = z.infer<
  typeof findOrCreateConversationSchema
>;
