import {
  and,
  conversations,
  eq,
  inArray,
  messages,
  searchInColumns,
  sql,
  type Tx,
  whatsappChannels,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
} from '@elora/db';
import type {
  PurgeChannelConversationsResult,
  WhatsappChannel,
} from './WhatsappChannelsTypes.js';

interface FindFilters {
  q?: string;
  providerType?: 'baileys' | 'meta_cloud';
  active?: boolean;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  name: string;
  providerType: 'baileys' | 'meta_cloud';
  providerConfig: Record<string, unknown>;
  phoneNumber?: string;
  color?: string;
}

interface UpdatePatch {
  name?: string;
  providerType?: 'baileys' | 'meta_cloud';
  providerConfig?: Record<string, unknown>;
  phoneNumber?: string | null;
  color?: string | null;
}

export const WhatsappChannelsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination
  ): Promise<{ items: WhatsappChannel[]; total: number }> => {
    const where = and(
      searchInColumns(filters.q, whatsappChannels.name, whatsappChannels.phoneNumber),
      filters.providerType !== undefined
        ? eq(whatsappChannels.providerType, filters.providerType)
        : undefined,
      filters.active !== undefined
        ? eq(whatsappChannels.active, filters.active)
        : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(whatsappChannels)
      .where(where)
      .orderBy(whatsappChannels.name)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(whatsappChannels)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<WhatsappChannel | undefined> => {
    const [channel] = await tx
      .select()
      .from(whatsappChannels)
      .where(eq(whatsappChannels.id, id))
      .limit(1);
    return channel;
  },

  // Pega um canal "default" do tenant pra operações que não exigem canal
  // específico (ex.: verificar se número existe no WhatsApp). Preferência:
  // active=true E connection_state='open' (canal saudável); fallback:
  // qualquer active=true. Retorna undefined se tenant não tem nenhum canal.
  findDefaultActive: async (tx: Tx): Promise<WhatsappChannel | undefined> => {
    const [channel] = await tx
      .select()
      .from(whatsappChannels)
      .where(eq(whatsappChannels.active, true))
      .orderBy(
        // 'open' primeiro, depois o que tiver — coalesce pra não ordenar
        // NULL como 'menor'. Decisão simples; revisar se vira multi-canal sério.
        sql`CASE WHEN ${whatsappChannels.connectionState} = 'open' THEN 0 ELSE 1 END`,
        whatsappChannels.createdAt,
      )
      .limit(1);
    return channel;
  },

  findByNameInTenant: async (
    tx: Tx,
    name: string,
    excludeId?: string
  ): Promise<WhatsappChannel | undefined> => {
    const conditions = [eq(whatsappChannels.name, name)];
    if (excludeId) {
      conditions.push(sql`${whatsappChannels.id} <> ${excludeId}`);
    }
    const [channel] = await tx
      .select()
      .from(whatsappChannels)
      .where(and(...conditions))
      .limit(1);
    return channel;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<WhatsappChannel> => {
    const [channel] = await tx
      .insert(whatsappChannels)
      .values({
        tenantId,
        name: input.name,
        providerType: input.providerType,
        providerConfig: input.providerConfig,
        phoneNumber: input.phoneNumber ?? null,
        color: input.color ?? null,
      })
      .returning();
    if (!channel) throw new Error('Falha ao inserir canal WhatsApp');
    return channel;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch
  ): Promise<WhatsappChannel | undefined> => {
    const [channel] = await tx
      .update(whatsappChannels)
      .set(patch)
      .where(eq(whatsappChannels.id, id))
      .returning();
    return channel;
  },

  delete: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(whatsappChannels)
      .where(eq(whatsappChannels.id, id))
      .returning({ id: whatsappChannels.id });
    return deleted.length > 0;
  },

  // Hard delete de todo o histórico do canal: conversas (domain) +
  // mensagens, contatos + conversas/mensagens transport. O canal em si
  // fica. Usado principalmente pra resetar o tenant demo.
  //
  // Ordem por causa das FKs:
  //   1. conversations do canal → cascade em messages.
  //   2. whatsapp_conversations do canal (cascade em whatsapp_messages).
  //      Normalmente já sairiam pelo cascade do contato, mas a FK pro canal
  //      é RESTRICT — apagar explicitamente evita que uma linha "torta"
  //      (contato de outro canal) trave o purge inteiro.
  //   3. whatsapp_contacts do canal.
  // Contagens são lidas antes (mesma transação) só pro feedback na UI.
  purgeConversations: async (
    tx: Tx,
    channelId: string
  ): Promise<PurgeChannelConversationsResult> => {
    const countSql = sql<number>`count(*)::int`;
    const [convRow] = await tx
      .select({ n: countSql })
      .from(conversations)
      .where(eq(conversations.whatsappChannelId, channelId));
    const [msgRow] = await tx
      .select({ n: countSql })
      .from(messages)
      .where(
        inArray(
          messages.conversationId,
          tx
            .select({ id: conversations.id })
            .from(conversations)
            .where(eq(conversations.whatsappChannelId, channelId))
        )
      );
    const [contactRow] = await tx
      .select({ n: countSql })
      .from(whatsappContacts)
      .where(eq(whatsappContacts.whatsappChannelId, channelId));
    const [waMsgRow] = await tx
      .select({ n: countSql })
      .from(whatsappMessages)
      .where(
        inArray(
          whatsappMessages.whatsappConversationId,
          tx
            .select({ id: whatsappConversations.id })
            .from(whatsappConversations)
            .where(eq(whatsappConversations.whatsappChannelId, channelId))
        )
      );

    await tx
      .delete(conversations)
      .where(eq(conversations.whatsappChannelId, channelId));
    await tx
      .delete(whatsappConversations)
      .where(eq(whatsappConversations.whatsappChannelId, channelId));
    await tx
      .delete(whatsappContacts)
      .where(eq(whatsappContacts.whatsappChannelId, channelId));

    return {
      conversations: convRow?.n ?? 0,
      messages: msgRow?.n ?? 0,
      contacts: contactRow?.n ?? 0,
      whatsappMessages: waMsgRow?.n ?? 0,
    };
  },

  setActive: async (
    tx: Tx,
    id: string,
    active: boolean
  ): Promise<WhatsappChannel | undefined> => {
    const [channel] = await tx
      .update(whatsappChannels)
      .set({ active })
      .where(eq(whatsappChannels.id, id))
      .returning();
    return channel;
  },

  // Update idempotente: SÓ grava se o state mudou. Filtro `IS DISTINCT FROM`
  // cobre o caso `connection_state IS NULL` (primeira vez). Quando nada
  // mudou, `.returning()` volta vazio — caller usa pra decidir se publica
  // evento no eventBus. Evolution+Baileys pode mandar dezenas de eventos
  // com mesmo state durante reconexão; sem esse filtro, escreveríamos N
  // vezes por segundo e dispararíamos N eventos socket por troca de
  // presença que não interessa.
  setConnectionState: async (
    tx: Tx,
    id: string,
    state: string,
    stateAt: Date
  ): Promise<WhatsappChannel | undefined> => {
    const [channel] = await tx
      .update(whatsappChannels)
      .set({ connectionState: state, connectionStateAt: stateAt })
      .where(
        and(
          eq(whatsappChannels.id, id),
          sql`${whatsappChannels.connectionState} IS DISTINCT FROM ${state}`
        )
      )
      .returning();
    return channel;
  },
};
