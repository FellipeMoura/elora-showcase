import {
  and,
  asc,
  eq,
  isNotNull,
  journeys,
  lt,
  messages,
  ne,
  sql,
  whatsappMessages,
  type Tx,
} from '@elora/db';
import type { Message } from './MessagesTypes.js';

interface FindFilters {
  conversationId: string;
  journeyId?: string;
  visibility: 'all' | 'public';
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  tenantId: string;
  conversationId: string;
  journeyId?: string;
  direction: 'inbound' | 'outbound' | 'internal_note';
  kind: 'text' | 'media' | 'template' | 'system' | 'sticker' | 'call';
  body?: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'audio' | 'video' | 'document' | 'sticker';
  callPayload?: {
    direction: 'inbound' | 'outbound';
    status: 'missed' | 'received' | 'declined';
    durationSec?: number;
    startedAt: string;
  };
  templateId?: string;
  // Variáveis do template — preservadas pro worker outbound usar quando
  // construir o payload da Cloud API. Null/omitido em kind != 'template'.
  templateVariables?: Record<string, string>;
  whatsappMessageId?: string;
  // Mensagem que está sendo respondida. Validado em camada superior
  // (`MessagesService.enqueueOutbound` / `inboundNormalizer.pipeline`) — esse
  // INSERT confia que o id pertence à mesma conversa.
  replyToMessageId?: string;
  authorUserId?: string;
  // Mensagem outbound enviada direto pelo celular pareado (não pela UI).
  // Coluna tem default `false` no DB — omitir == false.
  authoredOnDevice?: boolean;
  sentAt?: Date;
  // Status inicial. Inbound e internal_note nascem 'sent' (caminhos que não
  // passam pelo worker outbound). Outbound da UI nasce 'pending' — worker é
  // quem move pra sent/failed/rejected. Outbound capturada do celular (webhook
  // MESSAGES_UPSERT) também nasce 'sent' (já foi).
  deliveryStatus?: 'pending' | 'sent' | 'failed' | 'rejected';
}

export const MessagesQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination
  ): Promise<{ items: Message[]; total: number }> => {
    const where = and(
      eq(messages.conversationId, filters.conversationId),
      filters.journeyId !== undefined
        ? eq(messages.journeyId, filters.journeyId)
        : undefined,
      filters.visibility === 'public'
        ? ne(messages.direction, 'internal_note')
        : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    // Mais recentes primeiro — frontend renderiza invertido pro scroll de chat.
    // `COALESCE(sent_at, created_at)`: outbound pending/failed/rejected tem
    // sent_at=null (worker ainda não confirmou OU vai não confirmar nunca);
    // pra essas, ordenar pelo createdAt mantém a cronologia certa misturada
    // com as sent (cujo sentAt vem do provider, alguns ms após o createdAt).
    // Sem isso, `desc(sentAt)` agrupa todas as nulls junto (NULLS FIRST default
    // do Postgres em DESC) em ordem indeterminada — bolhas aparecem fora de
    // sequência na timeline.
    const items = await tx
      .select()
      .from(messages)
      .where(where)
      .orderBy(sql`coalesce(${messages.sentAt}, ${messages.createdAt}) desc`)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(messages)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  create: async (tx: Tx, input: CreateInput): Promise<Message> => {
    const [msg] = await tx
      .insert(messages)
      .values(input)
      .returning();
    if (!msg) throw new Error('Falha ao inserir mensagem');
    return msg;
  },

  findById: async (tx: Tx, messageId: string): Promise<Message | undefined> => {
    const [msg] = await tx
      .select()
      .from(messages)
      .where(eq(messages.id, messageId))
      .limit(1);
    return msg;
  },

  // Idempotência pro normalizer: se já existe mensagem domain ligada a esse
  // whatsapp_message_id, devolve a existente. BullMQ pode reprocessar o
  // mesmo job em erro transiente — sem isso, geraria duplicata visível
  // pro cliente.
  findByWhatsappMessageId: async (
    tx: Tx,
    whatsappMessageId: string
  ): Promise<Message | undefined> => {
    const [msg] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.whatsappMessageId, whatsappMessageId),
          isNotNull(messages.whatsappMessageId)
        )
      )
      .limit(1);
    return msg;
  },

  // Atualiza delivered_at / read_at quando status webhook chega. Match
  // pelo whatsapp_message_id (transport). Idempotente.
  setDeliveryTimestamp: async (
    tx: Tx,
    whatsappMessageId: string,
    field: 'deliveredAt' | 'readAt',
    at: Date
  ): Promise<void> => {
    await tx
      .update(messages)
      .set({ [field]: at })
      .where(eq(messages.whatsappMessageId, whatsappMessageId));
  },

  // Atualiza `journeys.last_activity_at = NOW()` (chat-domain.md §4.2 e §10.1).
  // Chamado em toda ação de staff que conta como atividade: outbound,
  // internal_note. Inbound NÃO chama isso (per §10.1).
  touchJourneyActivity: async (tx: Tx, journeyId: string): Promise<void> => {
    await tx
      .update(journeys)
      .set({ lastActivityAt: new Date() })
      .where(eq(journeys.id, journeyId));
  },

  // Resolve message domain pelo externalId do webhook (cliente editou/deletou).
  // O caminho é: webhook tem `externalId` do provider → busca whatsapp_messages
  // pelo external_id → daí join no message domain via whatsapp_message_id.
  // Subquery em vez de JOIN explícito porque o tipo do Drizzle fica mais
  // limpo e o resultado é só 1 linha.
  findByExternalId: async (
    tx: Tx,
    externalId: string,
  ): Promise<Message | undefined> => {
    const [msg] = await tx
      .select()
      .from(messages)
      .where(
        eq(
          messages.whatsappMessageId,
          tx
            .select({ id: whatsappMessages.id })
            .from(whatsappMessages)
            .where(eq(whatsappMessages.externalId, externalId))
            .limit(1),
        ),
      )
      .limit(1);
    return msg;
  },

  // Marca edição: novo body + edited_at = agora. NÃO escreve em deleted_at
  // (msg deletada não deveria estar sendo editada — caller valida antes).
  markEdited: async (
    tx: Tx,
    messageId: string,
    newBody: string,
    editedAt: Date,
  ): Promise<Message | undefined> => {
    const [msg] = await tx
      .update(messages)
      .set({ body: newBody, editedAt })
      .where(eq(messages.id, messageId))
      .returning();
    return msg;
  },

  // Soft delete. `body`/`mediaUrl` ficam intactos (audit). UI esconde com
  // base em deletedAt != null. Idempotente: re-aplicar mantém deleted_at
  // original (não sobrescreve).
  markDeleted: async (
    tx: Tx,
    messageId: string,
    origin: 'client' | 'staff' | 'system',
    deletedAt: Date,
  ): Promise<Message | undefined> => {
    const [msg] = await tx
      .update(messages)
      .set({ deletedAt, deletionOrigin: origin })
      .where(and(eq(messages.id, messageId), sql`${messages.deletedAt} IS NULL`))
      .returning();
    return msg;
  },

  // Worker outbound — sucesso. Liga a row domain à row transport recém-criada
  // (whatsapp_message_id) e finaliza o status com sent_at do provider. Guard
  // `WHERE delivery_status='pending'` é defensivo contra race onde reconciler
  // já marcou como worker_timeout (worker antigo terminou tarde).
  markDeliverySent: async (
    tx: Tx,
    messageId: string,
    whatsappMessageId: string,
    sentAt: Date,
    // Em mídia, atualizamos mediaUrl pro objectKey final (o INSERT já usou o
    // mesmo valor, mas mantemos por simetria/clareza). Em texto/template, null.
    mediaUrl: string | null,
  ): Promise<Message | undefined> => {
    const [msg] = await tx
      .update(messages)
      .set({
        deliveryStatus: 'sent',
        sentAt,
        whatsappMessageId,
        ...(mediaUrl !== null ? { mediaUrl } : {}),
        failureReason: null,
        failureDetail: null,
      })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.deliveryStatus, 'pending'),
        ),
      )
      .returning();
    return msg;
  },

  // Worker outbound — pre-flight bloqueou OU adapter falhou. `terminal` decide
  // entre 'rejected' (pre-flight: corrigir algo antes de tentar de novo) e
  // 'failed' (adapter: retry simples resolve). Guard mantém idempotência:
  // re-aplicar sobre uma row que já saiu de 'pending' é noop.
  markDeliveryFailed: async (
    tx: Tx,
    messageId: string,
    terminal: 'failed' | 'rejected',
    reason:
      | 'no_opt_in'
      | 'not_on_whatsapp'
      | 'channel_disconnected'
      | 'window_24h_expired'
      | 'invalid_template'
      | 'rate_limited'
      | 'provider_error'
      | 'worker_timeout'
      | 'unknown',
    detail: Record<string, unknown> | null,
  ): Promise<Message | undefined> => {
    const [msg] = await tx
      .update(messages)
      .set({
        deliveryStatus: terminal,
        failureReason: reason,
        failureDetail: detail,
      })
      .where(
        and(
          eq(messages.id, messageId),
          eq(messages.deliveryStatus, 'pending'),
        ),
      )
      .returning();
    return msg;
  },

  // Reset pra 'pending' usado pelo retry manual via UI. Limpa rastros do erro
  // anterior pra ficar limpo no audit. Caller é o controller de retry (que
  // também re-enfileira o job).
  resetToPending: async (
    tx: Tx,
    messageId: string,
  ): Promise<Message | undefined> => {
    const [msg] = await tx
      .update(messages)
      .set({
        deliveryStatus: 'pending',
        failureReason: null,
        failureDetail: null,
      })
      .where(
        and(
          eq(messages.id, messageId),
          // Só retenta a partir de estado terminal de falha — não permite
          // forçar reset em sent/pending (proteção contra duplo-envio).
          sql`${messages.deliveryStatus} IN ('failed','rejected')`,
        ),
      )
      .returning();
    return msg;
  },

  // Reconciliação: messages outbound em 'pending' há mais que `cutoff`. Worker
  // ou caiu/crashou no meio, ou demorou demais. Caller marca como
  // failed/worker_timeout. Limit conservador pra não fazer batch monstro num
  // tenant com bug — preferimos rodar várias vezes se necessário. Sem filtro
  // de tenant porque o reconciler roda fora de `withTenant` (cron global —
  // ver pipeline de reconciliação).
  //
  // `authoredOnDevice=false` é defesa: messages capturadas do celular pareado
  // (webhook MESSAGES_UPSERT) nascem fora do worker outbound — se por bug
  // alguma cair com delivery_status='pending', NÃO é caso pro reconciler
  // (ela já foi enviada de fato, só está mal-marcada). Mesma defesa cobre
  // qualquer caminho futuro que crie outbound fora do worker (V2 automações
  // server-side, etc) — só messages da UI passam pelo reconciler.
  findStuckPending: async (
    tx: Tx,
    cutoff: Date,
    limit = 100,
  ): Promise<Array<Pick<Message, 'id' | 'tenantId' | 'conversationId'>>> => {
    return tx
      .select({
        id: messages.id,
        tenantId: messages.tenantId,
        conversationId: messages.conversationId,
      })
      .from(messages)
      .where(
        and(
          eq(messages.deliveryStatus, 'pending'),
          eq(messages.direction, 'outbound'),
          eq(messages.authoredOnDevice, false),
          lt(messages.createdAt, cutoff),
        ),
      )
      .orderBy(asc(messages.createdAt))
      .limit(limit);
  },
};
