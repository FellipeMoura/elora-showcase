import {
  clients,
  conversations,
  eq,
  sql,
  type Tx,
  whatsappChannels,
  whatsappContacts,
  withTenant,
} from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  type PaginatedResult,
  totalPagesOf,
} from '../../shared/types/pagination.js';
import { ConversationsQuery } from './ConversationsQuery.js';
import type {
  Conversation,
  ConversationWithClient,
  FindConversationsQuery,
} from './ConversationsTypes.js';

export const ConversationsService = {
  find: async (
    tenantId: string,
    query: FindConversationsQuery
  ): Promise<PaginatedResult<ConversationWithClient>> => {
    return withTenant(db, tenantId, async (tx) => {
      const { items, total } = await ConversationsQuery.findPaginated(
        tx,
        { q: query.q, hasMessages: query.hasMessages },
        { page: query.page, pageSize: query.pageSize }
      );
      return {
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: totalPagesOf(total, query.pageSize),
      };
    });
  },

  findById: async (
    tenantId: string,
    id: string
  ): Promise<ConversationWithClient> => {
    return withTenant(db, tenantId, async (tx) => {
      const conv = await ConversationsQuery.findById(tx, id);
      if (!conv) throw new AppError('Conversation não encontrada', 404);
      return conv;
    });
  },

  // Marca a conversa como lida pelo staff (qualquer staff). Atualiza
  // `last_staff_seen_at = now()`. Próxima chamada de `find` retorna
  // `unreadCount = 0` pra essa conversa.
  markSeen: async (tenantId: string, id: string): Promise<void> => {
    return withTenant(db, tenantId, async (tx) => {
      const ok = await ConversationsQuery.markSeen(tx, id, new Date());
      if (!ok) throw new AppError('Conversation não encontrada', 404);
    });
  },

  // Idempotente: garante exatamente uma conversation por (cliente, canal).
  // Usado pelo webhook normalizer (passo 7) quando inbound chega e pelo
  // módulo messages antes de criar a primeira mensagem outbound/internal_note.
  //
  // Race: dois inbound do mesmo cliente no mesmo canal no mesmo instante.
  // unique(client_id, whatsapp_channel_id) + ON CONFLICT DO NOTHING: quem
  // perde a corrida lê a linha do vencedor, sem abortar a transação.
  findOrCreateForClientChannel: async (
    tenantId: string,
    clientId: string,
    requestedChannelId?: string,
  ): Promise<Conversation> => {
    return withTenant(db, tenantId, async (tx) => {
      const whatsappChannelId =
        requestedChannelId ?? (await pickChannelForClient(tx, clientId));
      const existing = await ConversationsQuery.findByClientChannel(
        tx,
        clientId,
        whatsappChannelId,
      );
      if (existing) return existing;

      // Valida que o cliente existe DENTRO do tenant (RLS já garante isso na
      // prática, mas mensagem amigável é melhor que erro de FK genérico).
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      if (!client) throw new AppError('Cliente não encontrado', 404);

      // Idempotente: ON CONFLICT no Query.create devolve a do vencedor.
      return ConversationsQuery.create(tx, tenantId, clientId, whatsappChannelId);
    });
  },
};

// Canal pra "abrir conversa" a partir do cliente (Clientes, Contratos,
// Agenda), que só tem o clientId. Ordem:
//   1. canal do contato WhatsApp ativo do cliente (no máximo 1 — índice
//      wa_contacts_client_active_unique); o worker de envio só aceita esse;
//   2. canal onde o cliente já tem conversa;
//   3. canal ativo mais antigo, preferindo o conectado.
// Só canais ativos. 409 quando o tenant não tem nenhum.
async function pickChannelForClient(tx: Tx, clientId: string): Promise<string> {
  const [row] = await tx
    .select({ id: whatsappChannels.id })
    .from(whatsappChannels)
    .where(eq(whatsappChannels.active, true))
    .orderBy(
      sql`NOT EXISTS (
        SELECT 1 FROM ${whatsappContacts} wc
        WHERE wc.whatsapp_channel_id = ${whatsappChannels.id}
          AND wc.client_id = ${clientId} AND wc.active = true
      )`,
      sql`NOT EXISTS (
        SELECT 1 FROM ${conversations} c
        WHERE c.whatsapp_channel_id = ${whatsappChannels.id}
          AND c.client_id = ${clientId}
      )`,
      sql`${whatsappChannels.connectionState} IS DISTINCT FROM 'open'`,
      whatsappChannels.createdAt,
    )
    .limit(1);
  if (!row) throw new AppError('Nenhum canal WhatsApp ativo', 409);
  return row.id;
}
