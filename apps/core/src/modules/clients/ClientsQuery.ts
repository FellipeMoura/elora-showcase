import {
  and,
  clients,
  conversations,
  eq,
  journeys,
  searchInColumns,
  sql,
  whatsappContacts,
  type ClientAddress,
  type SQL,
  type Tx,
} from '@elora/db';
import type { Client, ClientWithChat } from './ClientsTypes.js';

interface FindFilters {
  q?: string;
  active?: boolean; // undefined = sem filtro
  isVip?: boolean;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  name: string;
  phoneE164: string;
  email?: string | null;
  birthDate?: string | null;
  document?: string | null;
  address?: ClientAddress | null;
  notes?: string | null;
  isVip?: boolean;
}

interface UpdatePatch {
  name?: string;
  phoneE164?: string;
  email?: string | null;
  birthDate?: string | null;
  document?: string | null;
  address?: ClientAddress | null;
  notes?: string | null;
  isVip?: boolean;
}

// Subquery: id do whatsapp_contact ativo do cliente. Partial unique no schema
// garante no máximo 1 ativo por cliente.
//
// IMPORTANTE: `${clients}.id` em vez de `${clients.id}` — quando `clients` é
// a tabela base do FROM (como aqui), Drizzle elide o prefixo e gera só `"id"`,
// o que dentro do subquery resolve pro `wc.id` (whatsapp_contacts também tem
// `id`) e quebra silenciosamente o WHERE. Interpolando a tabela inteira
// (`${clients}` → `"clients"`) força a qualificação correta `"clients".id`.
function whatsappContactIdSubquery(): SQL<string | null> {
  return sql<string | null>`(
    SELECT wc.id::text FROM ${whatsappContacts} wc
    WHERE wc.client_id = ${clients}.id AND wc.active = true
    LIMIT 1
  )`;
}

// Subquery: canal WhatsApp do contact ativo do cliente. Usado pelo frontend
// pra criar conversation (POST /conversations) quando contact existe mas
// ainda não tem conversation (cadastro manual + WhatsApp checado).
function whatsappChannelIdSubquery(): SQL<string | null> {
  return sql<string | null>`(
    SELECT wc.whatsapp_channel_id::text FROM ${whatsappContacts} wc
    WHERE wc.client_id = ${clients}.id AND wc.active = true
    LIMIT 1
  )`;
}

// Subquery: stage da journey active do cliente. Invariante "1 active por
// cliente" garante no máximo 1 linha; LIMIT 1 é defesa.
function currentJourneyStageSubquery(): SQL<
  'lead' | 'evaluation' | 'sale' | 'treatment' | 'result' | null
> {
  return sql<
    'lead' | 'evaluation' | 'sale' | 'treatment' | 'result' | null
  >`(
    SELECT j.stage::text FROM ${journeys} j
    WHERE j.client_id = ${clients}.id AND j.status = 'active'
    LIMIT 1
  )`;
}

// Subquery: conversation mais recente do cliente (qualquer canal — modelo
// permite 1-por-(cliente, canal), pegamos a mais ativa).
function conversationIdSubquery(): SQL<string | null> {
  return sql<string | null>`(
    SELECT c.id::text FROM ${conversations} c
    WHERE c.client_id = ${clients}.id
    ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
    LIMIT 1
  )`;
}

// Seleção canônica de Client + campos de chat enriquecidos. Centraliza pra
// findPaginated, findById, findByPhone — qualquer caminho que devolve cliente
// pra controller. Writes (insert/update) retornam Client puro e o Service
// completa com null/null ou faz refetch via findById.
function selectClientWithChatColumns() {
  return {
    id: clients.id,
    tenantId: clients.tenantId,
    name: clients.name,
    phoneE164: clients.phoneE164,
    email: clients.email,
    birthDate: clients.birthDate,
    document: clients.document,
    address: clients.address,
    notes: clients.notes,
    isVip: clients.isVip,
    active: clients.active,
    createdAt: clients.createdAt,
    updatedAt: clients.updatedAt,
    // `.as(...)` é necessário pro Drizzle mapear o SQL fragment de volta ao
    // campo no resultado. Sem alias, a coluna vem como nome do índice e o
    // mapeamento devolve null.
    whatsappContactId: whatsappContactIdSubquery().as('whatsapp_contact_id'),
    whatsappChannelId: whatsappChannelIdSubquery().as('whatsapp_channel_id'),
    conversationId: conversationIdSubquery().as('conversation_id'),
    currentJourneyStage: currentJourneyStageSubquery().as(
      'current_journey_stage',
    ),
  };
}

export const ClientsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: ClientWithChat[]; total: number }> => {
    const where = and(
      // Busca casa nome OU telefone — operadora digita um dos dois.
      searchInColumns(filters.q, clients.name, clients.phoneE164),
      filters.active !== undefined ? eq(clients.active, filters.active) : undefined,
      filters.isVip !== undefined ? eq(clients.isVip, filters.isVip) : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    // Queries serializadas porque transação Drizzle usa uma única conexão pg —
    // queries paralelas no mesmo `tx` quebram o protocolo.
    const items = await tx
      .select(selectClientWithChatColumns())
      .from(clients)
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(clients)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<ClientWithChat | undefined> => {
    const [client] = await tx
      .select(selectClientWithChatColumns())
      .from(clients)
      .where(eq(clients.id, id))
      .limit(1);
    return client;
  },

  findByPhone: async (tx: Tx, phoneE164: string): Promise<Client | undefined> => {
    const [client] = await tx
      .select()
      .from(clients)
      .where(eq(clients.phoneE164, phoneE164))
      .limit(1);
    return client;
  },

  create: async (tx: Tx, tenantId: string, input: CreateInput): Promise<Client> => {
    const [client] = await tx
      .insert(clients)
      .values({
        tenantId,
        name: input.name,
        phoneE164: input.phoneE164,
        email: input.email ?? null,
        birthDate: input.birthDate ?? null,
        document: input.document ?? null,
        address: input.address ?? null,
        notes: input.notes ?? null,
        isVip: input.isVip ?? false,
      })
      .returning();
    if (!client) throw new Error('Falha ao inserir cliente');
    return client;
  },

  update: async (tx: Tx, id: string, patch: UpdatePatch): Promise<Client | undefined> => {
    const [client] = await tx
      .update(clients)
      .set(patch)
      .where(eq(clients.id, id))
      .returning();
    return client;
  },

  delete: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(clients)
      .where(eq(clients.id, id))
      .returning({ id: clients.id });
    return deleted.length > 0;
  },

  setActive: async (tx: Tx, id: string, active: boolean): Promise<Client | undefined> => {
    const [client] = await tx
      .update(clients)
      .set({ active })
      .where(eq(clients.id, id))
      .returning();
    return client;
  },
};
