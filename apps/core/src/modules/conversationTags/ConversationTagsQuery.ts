import {
  and,
  conversationTagAssignments,
  conversationTags,
  eq,
  inArray,
  searchInColumns,
  sql,
  type SQL,
  type Tx,
} from '@elora/db';
import type { ConversationTag } from './ConversationTagsTypes.js';

interface FindFilters {
  q?: string;
  active?: boolean;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  name: string;
  color: string;
  agentInstruction?: string | null;
}

interface UpdatePatch {
  name?: string;
  color?: string;
  agentInstruction?: string | null;
}

export const ConversationTagsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: ConversationTag[]; total: number }> => {
    const where = and(
      searchInColumns(filters.q, conversationTags.name),
      filters.active !== undefined
        ? eq(conversationTags.active, filters.active)
        : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(conversationTags)
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(conversationTags)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<ConversationTag | undefined> => {
    const [row] = await tx
      .select()
      .from(conversationTags)
      .where(eq(conversationTags.id, id))
      .limit(1);
    return row;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<ConversationTag> => {
    const [row] = await tx
      .insert(conversationTags)
      .values({
        tenantId,
        name: input.name,
        color: input.color,
        agentInstruction: input.agentInstruction ?? null,
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir conversation_tag');
    return row;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch
  ): Promise<ConversationTag | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.color !== undefined) set.color = patch.color;
    // null é valor válido (limpa a instrução); undefined = não mexe.
    if (patch.agentInstruction !== undefined) {
      set.agentInstruction = patch.agentInstruction;
    }

    const [row] = await tx
      .update(conversationTags)
      .set(set)
      .where(eq(conversationTags.id, id))
      .returning();
    return row;
  },

  setActive: async (
    tx: Tx,
    id: string,
    active: boolean
  ): Promise<ConversationTag | undefined> => {
    const [row] = await tx
      .update(conversationTags)
      .set({ active })
      .where(eq(conversationTags.id, id))
      .returning();
    return row;
  },

  delete: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(conversationTags)
      .where(eq(conversationTags.id, id))
      .returning({ id: conversationTags.id });
    return deleted.length > 0;
  },

  // ---------- Assignments ----------

  // Filtra tagIds que existem E estão ativos no tenant atual (RLS filtra
  // por tenant). Caller compara com input pra detectar IDs inválidos.
  findActiveTagsByIds: async (
    tx: Tx,
    ids: readonly string[],
  ): Promise<{ id: string }[]> => {
    if (ids.length === 0) return [];
    return tx
      .select({ id: conversationTags.id })
      .from(conversationTags)
      .where(
        and(
          inArray(conversationTags.id, [...ids]),
          eq(conversationTags.active, true),
        ),
      );
  },

  deleteAssignmentsForConversation: async (
    tx: Tx,
    conversationId: string,
  ): Promise<void> => {
    await tx
      .delete(conversationTagAssignments)
      .where(eq(conversationTagAssignments.conversationId, conversationId));
  },

  insertAssignments: async (
    tx: Tx,
    tenantId: string,
    conversationId: string,
    tagIds: readonly string[],
    agentTurnId: string | null,
  ): Promise<void> => {
    if (tagIds.length === 0) return;
    await tx.insert(conversationTagAssignments).values(
      tagIds.map((tagId) => ({
        conversationId,
        tagId,
        tenantId,
        assignedByAgentTurnId: agentTurnId,
      })),
    );
  },
};
