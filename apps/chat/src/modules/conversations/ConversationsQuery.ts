import {
  and,
  clients,
  conversations,
  desc,
  eq,
  ilike,
  isNotNull,
  journeys,
  messages,
  or,
  sql,
  type Tx,
  whatsappChannels,
  whatsappContacts,
  whatsappConversations,
} from '@elora/db';
import type {
  Conversation,
  ConversationWithClient,
} from './ConversationsTypes.js';

// Constante usada em COALESCE pra comparar timestamps quando staff nunca
// viu a conversa. Qualquer valor "muito antigo" funciona — escolhi 1970
// porque é o epoch padrão e zero ambiguidade timezone.
const NEVER_SEEN_FALLBACK = sql`'1970-01-01 00:00:00'::timestamp`;

// Tamanho da prévia da última mensagem (truncada no SQL pra não trafegar
// 4096 chars por linha numa lista paginada).
const PREVIEW_LENGTH = 200;

interface FindFilters {
  q?: string;
  hasMessages?: boolean;
}

interface Pagination {
  page: number;
  pageSize: number;
}

// Helper: monta o WHERE a partir dos filtros + joina conversations com clients
// pra busca por nome/telefone.
function buildWhere(filters: FindFilters): ReturnType<typeof and> {
  const conditions: ReturnType<typeof eq>[] = [];

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    const match = or(ilike(clients.name, pattern), ilike(clients.phoneE164, pattern));
    if (match) conditions.push(match);
  }

  if (filters.hasMessages === true) {
    conditions.push(isNotNull(conversations.lastMessageAt));
  }

  return and(...conditions);
}

export const ConversationsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination
  ): Promise<{ items: ConversationWithClient[]; total: number }> => {
    const where = buildWhere(filters);
    const offset = (pagination.page - 1) * pagination.pageSize;

    // Conversas mais recentes (ou criadas) primeiro — coalesce trata o caso
    // de conversation novinha sem mensagens.
    //
    // Subqueries inline pra agregados:
    //   - last_message_*: scalar subquery LIMIT 1 (usa índice
    //     messages_conversation_idx em (conversation_id, created_at)).
    //   - unread_count: COUNT inbound depois de last_staff_seen_at.
    // Subqueries duplicam o lookup do último msg pra body e direction —
    // aceitável pra page size <= 100 com índice. Otimização possível: passar
    // pra LATERAL única se virar gargalo medido.
    const rows = await tx
      .select({
        id: conversations.id,
        tenantId: conversations.tenantId,
        clientId: conversations.clientId,
        whatsappChannelId: conversations.whatsappChannelId,
        lastMessageAt: conversations.lastMessageAt,
        lastStaffSeenAt: conversations.lastStaffSeenAt,
        agentPausedUntil: conversations.agentPausedUntil,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        clientName: clients.name,
        clientPhone: clients.phoneE164,
        clientIsVip: clients.isVip,
        channelName: whatsappChannels.name,
        channelColor: whatsappChannels.color,
        channelProviderType: whatsappChannels.providerType,
        unreadCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
            AND m.direction = 'inbound'
            AND COALESCE(m.sent_at, m.created_at) > COALESCE(${conversations.lastStaffSeenAt}, ${NEVER_SEEN_FALLBACK})
        )`.as('unread_count'),
        lastMessagePreview: sql<string | null>`(
          SELECT LEFT(m.body, ${PREVIEW_LENGTH}) FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
          ORDER BY COALESCE(m.sent_at, m.created_at) DESC
          LIMIT 1
        )`.as('last_message_preview'),
        lastMessageDirection: sql<
          'inbound' | 'outbound' | 'internal_note' | null
        >`(
          SELECT m.direction::text FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
          ORDER BY COALESCE(m.sent_at, m.created_at) DESC
          LIMIT 1
        )`.as('last_message_direction'),
        // Kind + mediaType da última mensagem — UI usa pra renderizar preview
        // de mídia/sticker/call quando body é null (cobertura completa do
        // discriminated union de Message).
        lastMessageKind: sql<
          'text' | 'media' | 'template' | 'system' | 'sticker' | 'call' | null
        >`(
          SELECT m.kind::text FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
          ORDER BY COALESCE(m.sent_at, m.created_at) DESC
          LIMIT 1
        )`.as('last_message_kind'),
        lastMessageMediaType: sql<
          'image' | 'audio' | 'video' | 'document' | 'sticker' | null
        >`(
          SELECT m.media_type::text FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
          ORDER BY COALESCE(m.sent_at, m.created_at) DESC
          LIMIT 1
        )`.as('last_message_media_type'),
        // Resolve o whatsapp_contact correspondente ao par (client, channel).
        // Pode ser null em casos extremos (conversa criada sem inbound prévio
        // — fluxo manual de admin). UI cai pra inicial colorida quando null.
        whatsappContactId: sql<string | null>`(
          SELECT wc.id FROM ${whatsappContacts} wc
          WHERE wc.client_id = ${conversations.clientId}
            AND wc.whatsapp_channel_id = ${conversations.whatsappChannelId}
          LIMIT 1
        )`.as('whatsapp_contact_id'),
        // MAX(last_inbound_at) entre as wa_convs ligadas à conversation.
        // Normalmente é 1 (par cliente×canal único), mas o MAX cobre o caso
        // de N pra prevenir surprise se a schema evoluir.
        lastInboundAt: sql<Date | null>`(
          SELECT MAX(${whatsappConversations.lastInboundAt})
          FROM ${whatsappConversations}
          WHERE ${whatsappConversations.conversationId} = ${conversations.id}
        )`.as('last_inbound_at'),
        // Stage da journey ativa do cliente. Invariante "1 active por
        // cliente" garante no máximo 1 linha; LIMIT 1 é defesa. UI exibe
        // como chip pra dar contexto do estado do funil.
        currentJourneyStage: sql<
          'lead' | 'evaluation' | 'sale' | 'treatment' | 'result' | null
        >`(
          SELECT j.stage::text FROM ${journeys} j
          WHERE j.client_id = ${conversations.clientId} AND j.status = 'active'
          LIMIT 1
        )`.as('current_journey_stage'),
        // Substage da journey ativa (só populated quando stage='lead').
        // Lê a mesma row da subquery acima — duplica o lookup pra evitar
        // CTE/lateral. Cost negligível com índice em (client_id, status).
        currentLeadSubstage: sql<
          | 'new'
          | 'template'
          | 'contact'
          | 'scheduled'
          | 'no_show'
          | 'rescheduled'
          | 'quoted'
          | null
        >`(
          SELECT j.lead_substage::text FROM ${journeys} j
          WHERE j.client_id = ${conversations.clientId} AND j.status = 'active'
          LIMIT 1
        )`.as('current_lead_substage'),
      })
      .from(conversations)
      .innerJoin(clients, eq(conversations.clientId, clients.id))
      .innerJoin(
        whatsappChannels,
        eq(conversations.whatsappChannelId, whatsappChannels.id),
      )
      .where(where)
      .orderBy(desc(sql`COALESCE(${conversations.lastMessageAt}, ${conversations.createdAt})`))
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(conversations)
      .innerJoin(clients, eq(conversations.clientId, clients.id))
      .where(where);

    const items: ConversationWithClient[] = rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      clientId: row.clientId,
      whatsappChannelId: row.whatsappChannelId,
      lastMessageAt: row.lastMessageAt,
      lastStaffSeenAt: row.lastStaffSeenAt,
      agentPausedUntil: row.agentPausedUntil,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      client: {
        id: row.clientId,
        name: row.clientName,
        phoneE164: row.clientPhone,
        isVip: row.clientIsVip,
      },
      channel: {
        id: row.whatsappChannelId,
        name: row.channelName,
        color: row.channelColor,
        providerType: row.channelProviderType,
      },
      whatsappContactId: row.whatsappContactId,
      unreadCount: row.unreadCount ?? 0,
      lastMessagePreview: row.lastMessagePreview,
      lastMessageDirection: row.lastMessageDirection,
      lastMessageKind: row.lastMessageKind,
      lastMessageMediaType: row.lastMessageMediaType,
      lastInboundAt: row.lastInboundAt,
      currentJourneyStage: row.currentJourneyStage,
      currentLeadSubstage: row.currentLeadSubstage,
    }));

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (
    tx: Tx,
    id: string
  ): Promise<ConversationWithClient | undefined> => {
    const [row] = await tx
      .select({
        id: conversations.id,
        tenantId: conversations.tenantId,
        clientId: conversations.clientId,
        whatsappChannelId: conversations.whatsappChannelId,
        lastMessageAt: conversations.lastMessageAt,
        lastStaffSeenAt: conversations.lastStaffSeenAt,
        agentPausedUntil: conversations.agentPausedUntil,
        createdAt: conversations.createdAt,
        updatedAt: conversations.updatedAt,
        clientName: clients.name,
        clientPhone: clients.phoneE164,
        clientIsVip: clients.isVip,
        channelName: whatsappChannels.name,
        channelColor: whatsappChannels.color,
        channelProviderType: whatsappChannels.providerType,
        unreadCount: sql<number>`(
          SELECT COUNT(*)::int FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
            AND m.direction = 'inbound'
            AND COALESCE(m.sent_at, m.created_at) > COALESCE(${conversations.lastStaffSeenAt}, ${NEVER_SEEN_FALLBACK})
        )`.as('unread_count'),
        lastMessagePreview: sql<string | null>`(
          SELECT LEFT(m.body, ${PREVIEW_LENGTH}) FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
          ORDER BY COALESCE(m.sent_at, m.created_at) DESC
          LIMIT 1
        )`.as('last_message_preview'),
        lastMessageDirection: sql<
          'inbound' | 'outbound' | 'internal_note' | null
        >`(
          SELECT m.direction::text FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
          ORDER BY COALESCE(m.sent_at, m.created_at) DESC
          LIMIT 1
        )`.as('last_message_direction'),
        // Kind + mediaType da última mensagem — UI usa pra renderizar preview
        // de mídia/sticker/call quando body é null (cobertura completa do
        // discriminated union de Message).
        lastMessageKind: sql<
          'text' | 'media' | 'template' | 'system' | 'sticker' | 'call' | null
        >`(
          SELECT m.kind::text FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
          ORDER BY COALESCE(m.sent_at, m.created_at) DESC
          LIMIT 1
        )`.as('last_message_kind'),
        lastMessageMediaType: sql<
          'image' | 'audio' | 'video' | 'document' | 'sticker' | null
        >`(
          SELECT m.media_type::text FROM ${messages} m
          WHERE m.conversation_id = ${conversations.id}
          ORDER BY COALESCE(m.sent_at, m.created_at) DESC
          LIMIT 1
        )`.as('last_message_media_type'),
        // Resolve o whatsapp_contact correspondente ao par (client, channel).
        // Pode ser null em casos extremos (conversa criada sem inbound prévio
        // — fluxo manual de admin). UI cai pra inicial colorida quando null.
        whatsappContactId: sql<string | null>`(
          SELECT wc.id FROM ${whatsappContacts} wc
          WHERE wc.client_id = ${conversations.clientId}
            AND wc.whatsapp_channel_id = ${conversations.whatsappChannelId}
          LIMIT 1
        )`.as('whatsapp_contact_id'),
        // MAX(last_inbound_at) entre as wa_convs ligadas à conversation.
        // Frontend usa pra calcular a janela de 24h e exibir composer adequado.
        lastInboundAt: sql<Date | null>`(
          SELECT MAX(${whatsappConversations.lastInboundAt})
          FROM ${whatsappConversations}
          WHERE ${whatsappConversations.conversationId} = ${conversations.id}
        )`.as('last_inbound_at'),
        currentJourneyStage: sql<
          'lead' | 'evaluation' | 'sale' | 'treatment' | 'result' | null
        >`(
          SELECT j.stage::text FROM ${journeys} j
          WHERE j.client_id = ${conversations.clientId} AND j.status = 'active'
          LIMIT 1
        )`.as('current_journey_stage'),
        currentLeadSubstage: sql<
          | 'new'
          | 'template'
          | 'contact'
          | 'scheduled'
          | 'no_show'
          | 'rescheduled'
          | 'quoted'
          | null
        >`(
          SELECT j.lead_substage::text FROM ${journeys} j
          WHERE j.client_id = ${conversations.clientId} AND j.status = 'active'
          LIMIT 1
        )`.as('current_lead_substage'),
      })
      .from(conversations)
      .innerJoin(clients, eq(conversations.clientId, clients.id))
      .innerJoin(
        whatsappChannels,
        eq(conversations.whatsappChannelId, whatsappChannels.id),
      )
      .where(eq(conversations.id, id))
      .limit(1);

    if (!row) return undefined;

    return {
      id: row.id,
      tenantId: row.tenantId,
      clientId: row.clientId,
      whatsappChannelId: row.whatsappChannelId,
      lastMessageAt: row.lastMessageAt,
      lastStaffSeenAt: row.lastStaffSeenAt,
      agentPausedUntil: row.agentPausedUntil,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      client: {
        id: row.clientId,
        name: row.clientName,
        phoneE164: row.clientPhone,
        isVip: row.clientIsVip,
      },
      channel: {
        id: row.whatsappChannelId,
        name: row.channelName,
        color: row.channelColor,
        providerType: row.channelProviderType,
      },
      whatsappContactId: row.whatsappContactId,
      unreadCount: row.unreadCount ?? 0,
      lastMessagePreview: row.lastMessagePreview,
      lastMessageDirection: row.lastMessageDirection,
      lastMessageKind: row.lastMessageKind,
      lastMessageMediaType: row.lastMessageMediaType,
      lastInboundAt: row.lastInboundAt,
      currentJourneyStage: row.currentJourneyStage,
      currentLeadSubstage: row.currentLeadSubstage,
    };
  },

  // Busca conversation única de um par (cliente, canal). Substitui o antigo
  // `findByClientId` — uma mesma pessoa pode ter N conversations (uma por
  // canal), então client_id sozinho não é mais chave única.
  findByClientChannel: async (
    tx: Tx,
    clientId: string,
    whatsappChannelId: string,
  ): Promise<Conversation | undefined> => {
    const [conv] = await tx
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.clientId, clientId),
          eq(conversations.whatsappChannelId, whatsappChannelId),
        ),
      )
      .limit(1);
    return conv;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    clientId: string,
    whatsappChannelId: string,
  ): Promise<Conversation> => {
    const [conv] = await tx
      .insert(conversations)
      .values({ tenantId, clientId, whatsappChannelId })
      // Corrida no unique (cliente, canal): devolve a linha do vencedor sem
      // erro — um catch de 23505 abortaria a transação do caller.
      .onConflictDoNothing({
        target: [conversations.clientId, conversations.whatsappChannelId],
      })
      .returning();
    if (conv) return conv;
    const existing = await ConversationsQuery.findByClientChannel(tx, clientId, whatsappChannelId);
    if (!existing) throw new Error('Falha ao criar conversation');
    return existing;
  },

  touchLastMessageAt: async (
    tx: Tx,
    id: string,
    at: Date
  ): Promise<void> => {
    await tx
      .update(conversations)
      .set({ lastMessageAt: at })
      .where(eq(conversations.id, id));
  },

  // Marca a conversa como "vista por staff agora". V1 tem semântica global —
  // qualquer staff abrir zera o unread pra todos. Per-user tracking fica
  // pra V1.x. Retorna true se UPDATE afetou 1 linha (404 amigável no
  // caller caso contrário).
  markSeen: async (tx: Tx, id: string, at: Date): Promise<boolean> => {
    const result = await tx
      .update(conversations)
      .set({ lastStaffSeenAt: at })
      .where(eq(conversations.id, id))
      .returning({ id: conversations.id });
    return result.length > 0;
  },
};
