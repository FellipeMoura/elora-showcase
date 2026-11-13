import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  searchInColumns,
  sql,
  type Tx,
  whatsappContacts,
} from '@elora/db';
import type { WhatsappContact } from './WhatsappContactsTypes.js';

interface FindFilters {
  q?: string;
  channelId?: string;
  optedIn?: boolean;
  hasClient?: boolean;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  whatsappChannelId: string;
  phoneE164: string;
  profileName?: string;
  clientId?: string;
}

interface UpdatePatch {
  clientId?: string | null;
  profileName?: string | null;
  whatsappE164?: string | null;
  optedInAt?: Date | null;
  optInSource?: string | null;
  profilePictureUrl?: string | null;
}

export const WhatsappContactsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination
  ): Promise<{ items: WhatsappContact[]; total: number }> => {
    const where = and(
      searchInColumns(filters.q, whatsappContacts.phoneE164, whatsappContacts.profileName),
      filters.channelId !== undefined
        ? eq(whatsappContacts.whatsappChannelId, filters.channelId)
        : undefined,
      filters.optedIn === true
        ? isNotNull(whatsappContacts.optedInAt)
        : filters.optedIn === false
          ? isNull(whatsappContacts.optedInAt)
          : undefined,
      filters.hasClient === true
        ? isNotNull(whatsappContacts.clientId)
        : filters.hasClient === false
          ? isNull(whatsappContacts.clientId)
          : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(whatsappContacts)
      .where(where)
      .orderBy(desc(whatsappContacts.createdAt))
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(whatsappContacts)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<WhatsappContact | undefined> => {
    const [contact] = await tx
      .select()
      .from(whatsappContacts)
      .where(eq(whatsappContacts.id, id))
      .limit(1);
    return contact;
  },

  findByChannelAndPhone: async (
    tx: Tx,
    channelId: string,
    phoneE164: string
  ): Promise<WhatsappContact | undefined> => {
    const [contact] = await tx
      .select()
      .from(whatsappContacts)
      .where(
        and(
          eq(whatsappContacts.whatsappChannelId, channelId),
          eq(whatsappContacts.phoneE164, phoneE164),
        )
      )
      .limit(1);
    return contact;
  },

  // Lookup pelo cliente — pra resolver "que canal mandar mensagem outbound".
  // Tipicamente 1 contato por cliente, mas modelo permite múltiplos (cliente
  // com 2 WhatsApps em canais diferentes). Caller decide:
  //   - 0 contatos: cliente nunca conversou → erro
  //   - 1 contato: auto-resolve
  //   - 2+ contatos: caller deve receber whatsappContactId explícito da UI
  findByClientId: async (
    tx: Tx,
    clientId: string
  ): Promise<WhatsappContact[]> => {
    return tx
      .select()
      .from(whatsappContacts)
      .where(eq(whatsappContacts.clientId, clientId))
      .orderBy(whatsappContacts.createdAt);
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<WhatsappContact> => {
    const [contact] = await tx
      .insert(whatsappContacts)
      .values({
        tenantId,
        whatsappChannelId: input.whatsappChannelId,
        phoneE164: input.phoneE164,
        profileName: input.profileName,
        clientId: input.clientId,
      })
      .returning();
    if (!contact) throw new Error('Falha ao inserir contato WhatsApp');
    return contact;
  },

  // Igual ao create, mas colisão no unique (canal, telefone) devolve
  // undefined em vez de erro — um 23505 abortaria a transação do caller e o
  // re-fetch seguinte falharia ("current transaction is aborted").
  createIfAbsent: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<WhatsappContact | undefined> => {
    const [contact] = await tx
      .insert(whatsappContacts)
      .values({
        tenantId,
        whatsappChannelId: input.whatsappChannelId,
        phoneE164: input.phoneE164,
        profileName: input.profileName,
        clientId: input.clientId,
      })
      .onConflictDoNothing({
        target: [whatsappContacts.whatsappChannelId, whatsappContacts.phoneE164],
      })
      .returning();
    return contact;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch
  ): Promise<WhatsappContact | undefined> => {
    const [contact] = await tx
      .update(whatsappContacts)
      .set(patch)
      .where(eq(whatsappContacts.id, id))
      .returning();
    return contact;
  },
};
