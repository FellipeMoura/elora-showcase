import { EVENT_CHANNELS } from '@elora/events-contracts';
import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { eventBus } from '../../shared/eventBus/eventBus.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { ConversationTagsQuery } from './ConversationTagsQuery.js';
import { conversationTagsSortSpec } from './ConversationTagsTypes.js';
import type {
  ConversationTag,
  CreateConversationTagInput,
  FindConversationTagsQuery,
  ReplaceConversationTagsInput,
  ReplaceConversationTagsResponse,
  UpdateConversationTagInput,
} from './ConversationTagsTypes.js';

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export const ConversationTagsService = {
  find: async (
    tenantId: string,
    query: FindConversationTagsQuery
  ): Promise<PaginatedResult<ConversationTag>> => {
    return withTenant(db, tenantId, async (tx) => {
      const active = query.status === 'all' ? undefined : query.status === 'active';
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        conversationTagsSortSpec
      );
      const { items, total } = await ConversationTagsQuery.findPaginated(
        tx,
        { q: query.q, active },
        { page: query.page, pageSize: query.pageSize },
        orderBy
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

  findById: async (tenantId: string, id: string): Promise<ConversationTag> => {
    return withTenant(db, tenantId, async (tx) => {
      const row = await ConversationTagsQuery.findById(tx, id);
      if (!row) throw new AppError('Tag não encontrada', 404);
      return row;
    });
  },

  create: async (
    tenantId: string,
    input: CreateConversationTagInput
  ): Promise<ConversationTag> => {
    return withTenant(db, tenantId, async (tx) => {
      try {
        return await ConversationTagsQuery.create(tx, tenantId, input);
      } catch (err) {
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe uma tag com este nome neste tenant',
            409
          );
        }
        throw err;
      }
    });
  },

  update: async (
    tenantId: string,
    id: string,
    input: UpdateConversationTagInput
  ): Promise<ConversationTag> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ConversationTagsQuery.findById(tx, id);
      if (!current) throw new AppError('Tag não encontrada', 404);

      try {
        const updated = await ConversationTagsQuery.update(tx, id, input);
        if (!updated) throw new AppError('Tag não encontrada', 404);
        return updated;
      } catch (err) {
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe uma tag com este nome neste tenant',
            409
          );
        }
        throw err;
      }
    });
  },

  deactivate: async (tenantId: string, id: string): Promise<ConversationTag> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ConversationTagsQuery.findById(tx, id);
      if (!current) throw new AppError('Tag não encontrada', 404);
      if (!current.active) throw new AppError('Tag já está desativada', 409);

      const updated = await ConversationTagsQuery.setActive(tx, id, false);
      if (!updated) throw new AppError('Tag não encontrada', 404);
      return updated;
    });
  },

  activate: async (tenantId: string, id: string): Promise<ConversationTag> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ConversationTagsQuery.findById(tx, id);
      if (!current) throw new AppError('Tag não encontrada', 404);
      if (current.active) throw new AppError('Tag já está ativa', 409);

      const updated = await ConversationTagsQuery.setActive(tx, id, true);
      if (!updated) throw new AppError('Tag não encontrada', 404);
      return updated;
    });
  },

  remove: async (tenantId: string, id: string): Promise<void> => {
    try {
      const deleted = await withTenant(db, tenantId, async (tx) => {
        return ConversationTagsQuery.delete(tx, id);
      });
      if (!deleted) throw new AppError('Tag não encontrada', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // 23503 = foreign_key_violation. conversation_tag_assignments cascateia
      // (ON DELETE CASCADE) — esse caminho não deve disparar pra essa FK,
      // mas mantemos o handler defensivo pra futuras refs que mudem o policy.
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Tag vinculada a conversations — desative em vez de excluir',
          409
        );
      }
      throw err;
    }
  },

  // Replace mode — substitui o conjunto inteiro de tags da conversa. RLS
  // garante que tenant_id não vaze; validamos explicitamente que todos os
  // tagIds existem e estão ativos pra dar erro amigável (RLS faria insert
  // silenciosamente filtrar, gerando inconsistência).
  //
  // Source ('agent' | 'human') é inferida do agentTurnId: presente = agente;
  // ausente = humano. Frontend usa pra decidir se mostra badge "IA aplicou"
  // nos chips.
  //
  // Publica `conversation.tags_updated` em fim de transação (best-effort)
  // pra UI repintar chips em tempo real.
  replaceConversationTags: async (
    tenantId: string,
    input: ReplaceConversationTagsInput,
  ): Promise<ReplaceConversationTagsResponse> => {
    const agentTurnId = input.agentTurnId ?? null;

    const result = await withTenant(db, tenantId, async (tx) => {
      // Validação: todos os tagIds existem + ativos (RLS filtra por tenant).
      // Dedup pra evitar duplicata silenciosa no insert.
      const uniqueTagIds = Array.from(new Set(input.tagIds));
      if (uniqueTagIds.length > 0) {
        const found = await ConversationTagsQuery.findActiveTagsByIds(
          tx,
          uniqueTagIds,
        );
        if (found.length !== uniqueTagIds.length) {
          const foundSet = new Set(found.map((f) => f.id));
          const missing = uniqueTagIds.filter((id) => !foundSet.has(id));
          throw new AppError(
            'Tag(s) inválida(s) ou inativa(s)',
            400,
            { missing },
          );
        }
      }

      // Replace: limpa as existentes e insere as novas dentro da mesma tx
      // pra não deixar conversa sem tags entre os dois passos visível.
      await ConversationTagsQuery.deleteAssignmentsForConversation(
        tx,
        input.conversationId,
      );
      await ConversationTagsQuery.insertAssignments(
        tx,
        tenantId,
        input.conversationId,
        uniqueTagIds,
        agentTurnId,
      );

      return uniqueTagIds;
    });

    const response: ReplaceConversationTagsResponse = {
      conversationId: input.conversationId,
      tagIds: result,
      source: agentTurnId ? 'agent' : 'human',
      agentTurnId,
      updatedAt: new Date().toISOString(),
    };

    // Best-effort. Erro de publish não rebobina a tx (estado já consistente).
    await eventBus.publish(EVENT_CHANNELS.conversationTagsUpdated, {
      tenantId,
      conversationId: response.conversationId,
      tagIds: response.tagIds,
      source: response.source,
      agentTurnId: response.agentTurnId,
      updatedAt: response.updatedAt,
    });

    return response;
  },
};
