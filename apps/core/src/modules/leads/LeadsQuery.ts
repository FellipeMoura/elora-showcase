import {
  and,
  appointments,
  clients,
  conversations,
  eq,
  ilike,
  journeys,
  messages,
  or,
  quotes,
  sql,
  whatsappContacts,
  type SQL,
  type Tx,
} from '@elora/db';
import type {
  LeadCard,
  LeadDetail,
  LeadSubstageValue,
  leadSourceValues,
} from './LeadsTypes.js';

// =====================================================================
// LeadsQuery — todos os reads vão sobre `journeys WHERE stage='lead'`.
//
// Cards do kanban enriquecidos com:
//   - client.name + phone_e164
//   - conversation_id (1 por journey atualmente, escolhe a mais recente)
//   - próximo appointment kind=evaluation futuro (pra cards de scheduled/rescheduled)
//
// Filtros aplicam-se em duas etapas: where SQL para campos diretos, post-filter
// não acontece — search usa ILIKE direto na join.
// =====================================================================

interface FindFilters {
  substage?: LeadSubstageValue;
  source?: (typeof leadSourceValues)[number];
  ageMinDays?: number;
  ageMaxDays?: number;
  channelId?: string;
  search?: string;
}

interface Pagination {
  page: number;
  pageSize: number;
}

function buildWhereClause(filters: FindFilters): SQL | undefined {
  const conds: (SQL | undefined)[] = [eq(journeys.stage, 'lead')];

  if (filters.substage) {
    conds.push(eq(journeys.leadSubstage, filters.substage));
  }
  if (filters.source) {
    conds.push(eq(journeys.source, filters.source));
  }

  // ageMinDays = "criada há pelo menos N dias" → createdAt <= NOW() - N days
  if (filters.ageMinDays !== undefined) {
    conds.push(
      sql`${journeys.createdAt} <= NOW() - (${filters.ageMinDays} || ' days')::interval`
    );
  }
  if (filters.ageMaxDays !== undefined) {
    conds.push(
      sql`${journeys.createdAt} >= NOW() - (${filters.ageMaxDays} || ' days')::interval`
    );
  }

  if (filters.search) {
    const term = `%${filters.search}%`;
    conds.push(
      or(ilike(clients.name, term), ilike(clients.phoneE164, term))
    );
  }

  // channelId filtra pela conversation associada à journey. Sem conversation,
  // não bate o filtro (left join + IS NOT NULL implícito).
  if (filters.channelId) {
    conds.push(eq(conversations.whatsappChannelId, filters.channelId));
  }

  return and(...conds.filter((c): c is SQL => c !== undefined));
}

// Retorna SQL que pega a conversation mais recente da journey via subquery.
// Usado tanto em SELECT quanto em JOIN (channelId filter).
function latestConversationSubquery(): SQL<string | null> {
  return sql<string | null>`(
    SELECT c.id::text FROM ${conversations} c
    WHERE c.client_id = ${journeys.clientId}
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
    LIMIT 1
  )`;
}

// Próximo appointment kind=evaluation futuro (NÃO cancelado, NÃO no_show).
function nextEvaluationSubquery(): SQL<Date | null> {
  return sql<Date | null>`(
    SELECT a.scheduled_at FROM ${appointments} a
    WHERE a.journey_id = ${journeys.id}
      AND a.kind = 'evaluation'
      AND a.status NOT IN ('cancelled', 'no_show')
      AND a.scheduled_at > NOW()
    ORDER BY a.scheduled_at ASC
    LIMIT 1
  )`;
}

// whatsapp_contact_id da conversation mais recente do cliente.
// Pode ser null em conversation manual sem inbound prévio.
function latestWhatsappContactSubquery(): SQL<string | null> {
  return sql<string | null>`(
    SELECT wc.id::text FROM ${whatsappContacts} wc
    WHERE wc.client_id = ${journeys.clientId}
      AND wc.whatsapp_channel_id = (
        SELECT c.whatsapp_channel_id FROM ${conversations} c
        WHERE c.client_id = ${journeys.clientId}
        ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
        LIMIT 1
      )
    LIMIT 1
  )`;
}

// Tamanho da prévia da última mensagem — bate com PREVIEW_LENGTH usado em
// ConversationsQuery (chat). UI corta novamente se quiser, mas evitamos
// trafegar body inteiro (até 4096) por linha do board.
const LAST_MESSAGE_PREVIEW_LENGTH = 200;

// SELECT escalar genérico sobre a última mensagem da conversation mais
// recente do cliente. Caller passa qual coluna da `messages` extrair —
// preview, direction, kind, media_type.
//
// Subquery aninhada: ID da conv mais recente → última msg dessa conv.
// Repete-se 4× no SELECT do card, mas o índice
// (conversation_id, COALESCE(sent_at, created_at)) já cobre todas.
function latestMessageFieldSubquery<T>(
  field: SQL,
): SQL<T | null> {
  return sql<T | null>`(
    SELECT ${field} FROM ${messages} m
    WHERE m.conversation_id = (
      SELECT c.id FROM ${conversations} c
      WHERE c.client_id = ${journeys.clientId}
      ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
      LIMIT 1
    )
    ORDER BY COALESCE(m.sent_at, m.created_at) DESC
    LIMIT 1
  )`;
}

export const LeadsQuery = {
  // =====================================================================
  // Cards do board — list com enrich. Junta clients (inner) e conversations
  // (left, via subquery em select) numa única query. Filtros aplicados via
  // where; channelId força inner-join implícito ao filtrar por
  // conversations.whatsapp_channel_id.
  // =====================================================================
  findCards: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: LeadCard[]; total: number }> => {
    const where = buildWhereClause(filters);
    const offset = (pagination.page - 1) * pagination.pageSize;

    // Quando channelId filtra, fazemos join "real" com conversations pra
    // poder aplicar o WHERE. Caso contrário, conversation_id vem por
    // subquery (left join lógico).
    const baseSelect = {
      id: journeys.id,
      clientId: journeys.clientId,
      clientName: clients.name,
      clientPhone: clients.phoneE164,
      substage: journeys.leadSubstage,
      source: journeys.source,
      lastActivityAt: journeys.lastActivityAt,
      createdAt: journeys.createdAt,
      conversationId: latestConversationSubquery().as('conversation_id'),
      whatsappContactId: latestWhatsappContactSubquery().as(
        'whatsapp_contact_id',
      ),
      lastMessagePreview: latestMessageFieldSubquery<string>(
        sql`LEFT(m.body, ${LAST_MESSAGE_PREVIEW_LENGTH})`,
      ).as('last_message_preview'),
      lastMessageDirection: latestMessageFieldSubquery<
        'inbound' | 'outbound' | 'internal_note'
      >(sql`m.direction::text`).as('last_message_direction'),
      lastMessageKind: latestMessageFieldSubquery<
        'text' | 'media' | 'template' | 'system' | 'sticker' | 'call'
      >(sql`m.kind::text`).as('last_message_kind'),
      lastMessageMediaType: latestMessageFieldSubquery<
        'image' | 'audio' | 'video' | 'document' | 'sticker'
      >(sql`m.media_type::text`).as('last_message_media_type'),
      nextEvaluationAt: nextEvaluationSubquery().as('next_evaluation_at'),
    };

    let itemsQuery = tx
      .select(baseSelect)
      .from(journeys)
      .innerJoin(clients, eq(clients.id, journeys.clientId))
      .$dynamic();

    if (filters.channelId) {
      itemsQuery = itemsQuery.innerJoin(
        conversations,
        and(
          eq(conversations.clientId, journeys.clientId),
          eq(conversations.whatsappChannelId, filters.channelId)
        )!
      );
    }

    // "Sem resposta" primeiro: leads onde a última mensagem da conversa
    // veio do cliente (direction='inbound') sobem ao topo da coluna,
    // independentemente do `sortBy` escolhido. A clínica está devendo
    // resposta — esses cards têm urgência operacional. Empate dentro do
    // bucket cai pro orderBy normal (lastActivityAt DESC por default).
    // Leads sem conversa (direction=null) ficam no bucket "outros".
    const waitingReplyFirst = sql`(${latestMessageFieldSubquery<string>(
      sql`m.direction::text`,
    )} = 'inbound') DESC NULLS LAST`;

    const rows = await itemsQuery
      .where(where)
      .orderBy(waitingReplyFirst, orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    // Count usa o mesmo where + joins.
    let countQuery = tx
      .select({ count: sql<number>`count(distinct ${journeys.id})::int`.as('count') })
      .from(journeys)
      .innerJoin(clients, eq(clients.id, journeys.clientId))
      .$dynamic();

    if (filters.channelId) {
      countQuery = countQuery.innerJoin(
        conversations,
        and(
          eq(conversations.clientId, journeys.clientId),
          eq(conversations.whatsappChannelId, filters.channelId)
        )!
      );
    }
    const [totalRow] = await countQuery.where(where);

    const items = rows.map(
      (r): LeadCard => ({
        id: r.id,
        clientId: r.clientId,
        clientName: r.clientName,
        clientPhone: r.clientPhone,
        substage: r.substage as LeadSubstageValue | null,
        source: r.source,
        lastActivityAt: r.lastActivityAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        conversationId: r.conversationId ?? null,
        whatsappContactId: r.whatsappContactId ?? null,
        lastMessagePreview: r.lastMessagePreview ?? null,
        lastMessageDirection: r.lastMessageDirection ?? null,
        lastMessageKind: r.lastMessageKind ?? null,
        lastMessageMediaType: r.lastMessageMediaType ?? null,
        nextEvaluationAt: r.nextEvaluationAt
          ? new Date(r.nextEvaluationAt).toISOString()
          : null,
      })
    );

    return { items, total: totalRow?.count ?? 0 };
  },

  // =====================================================================
  // Counts por substage — usa o mesmo where (sem paginação). Inclui chave
  // 'unset' pros leads sem substage definido.
  // =====================================================================
  countsBySubstage: async (
    tx: Tx,
    filters: Omit<FindFilters, 'substage'>
  ): Promise<Record<string, number>> => {
    const where = buildWhereClause(filters);

    let q = tx
      .select({
        substage: journeys.leadSubstage,
        count: sql<number>`count(distinct ${journeys.id})::int`.as('count'),
      })
      .from(journeys)
      .innerJoin(clients, eq(clients.id, journeys.clientId))
      .$dynamic();

    if (filters.channelId) {
      q = q.innerJoin(
        conversations,
        and(
          eq(conversations.clientId, journeys.clientId),
          eq(conversations.whatsappChannelId, filters.channelId)
        )!
      );
    }

    const rows = await q.where(where).groupBy(journeys.leadSubstage);

    const out: Record<string, number> = {
      new: 0,
      template: 0,
      contact: 0,
      scheduled: 0,
      no_show: 0,
      rescheduled: 0,
      quoted: 0,
      unset: 0,
    };
    for (const r of rows) {
      const key = r.substage ?? 'unset';
      out[key] = r.count;
    }
    return out;
  },

  // =====================================================================
  // Detalhe enriquecido pra GET /leads/:id.
  // =====================================================================
  findDetailById: async (tx: Tx, id: string): Promise<LeadDetail | undefined> => {
    const [row] = await tx
      .select({
        id: journeys.id,
        tenantId: journeys.tenantId,
        clientId: journeys.clientId,
        clientName: clients.name,
        clientPhone: clients.phoneE164,
        clientEmail: clients.email,
        stage: journeys.stage,
        substage: journeys.leadSubstage,
        status: journeys.status,
        source: journeys.source,
        sourceMetadata: journeys.sourceMetadata,
        lostReason: journeys.lostReason,
        lastActivityAt: journeys.lastActivityAt,
        closedAt: journeys.closedAt,
        createdAt: journeys.createdAt,
        updatedAt: journeys.updatedAt,
        conversationId: latestConversationSubquery().as('conversation_id'),
        nextEvaluationAt: nextEvaluationSubquery().as('next_evaluation_at'),
        latestQuoteId: sql<string | null>`(
          SELECT q.id::text FROM ${quotes} q
          WHERE q.journey_id = ${journeys.id}
          ORDER BY q.created_at DESC LIMIT 1
        )`.as('latest_quote_id'),
        latestQuoteStatus: sql<string | null>`(
          SELECT q.status::text FROM ${quotes} q
          WHERE q.journey_id = ${journeys.id}
          ORDER BY q.created_at DESC LIMIT 1
        )`.as('latest_quote_status'),
      })
      .from(journeys)
      .innerJoin(clients, eq(clients.id, journeys.clientId))
      .where(and(eq(journeys.id, id), eq(journeys.stage, 'lead')))
      .limit(1);

    if (!row) return undefined;

    return {
      id: row.id,
      tenantId: row.tenantId,
      clientId: row.clientId,
      clientName: row.clientName,
      clientPhone: row.clientPhone,
      clientEmail: row.clientEmail,
      stage: 'lead',
      substage: row.substage as LeadSubstageValue | null,
      status: row.status,
      source: row.source,
      sourceMetadata: row.sourceMetadata,
      lostReason: row.lostReason,
      lastActivityAt: row.lastActivityAt.toISOString(),
      closedAt: row.closedAt ? row.closedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      conversationId: row.conversationId ?? null,
      nextEvaluationAt: row.nextEvaluationAt
        ? new Date(row.nextEvaluationAt).toISOString()
        : null,
      latestQuoteId: row.latestQuoteId ?? null,
      latestQuoteStatus: row.latestQuoteStatus ?? null,
    };
  },
};

