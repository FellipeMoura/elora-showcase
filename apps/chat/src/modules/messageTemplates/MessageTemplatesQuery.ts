import {
  and,
  eq,
  messageTemplates,
  searchInColumns,
  sql,
  type Tx,
} from '@elora/db';
import type { MessageTemplate } from './MessageTemplatesTypes.js';

type Kind = 'text' | 'media';
type Stage = 'lead' | 'evaluation' | 'sale' | 'treatment' | 'result';

interface FindFilters {
  q?: string;
  kind?: Kind;
  stage?: Stage;
  active?: boolean;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  name: string;
  body: string;
  kind: Kind;
  surfaceInStage: Stage[];
}

interface UpdatePatch {
  name?: string;
  body?: string;
  kind?: Kind;
  surfaceInStage?: Stage[];
}

export const MessageTemplatesQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination
  ): Promise<{ items: MessageTemplate[]; total: number }> => {
    const where = and(
      searchInColumns(filters.q, messageTemplates.name, messageTemplates.body),
      filters.kind !== undefined ? eq(messageTemplates.kind, filters.kind) : undefined,
      filters.active !== undefined
        ? eq(messageTemplates.active, filters.active)
        : undefined,
      // surface_in_stage é text[] no DB. Postgres ANY checa pertinência.
      // sql.raw seria injetável — usamos parametrização do drizzle.
      filters.stage !== undefined
        ? sql`${filters.stage} = ANY(${messageTemplates.surfaceInStage})`
        : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(messageTemplates)
      .where(where)
      .orderBy(messageTemplates.name)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(messageTemplates)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<MessageTemplate | undefined> => {
    const [template] = await tx
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.id, id))
      .limit(1);
    return template;
  },

  findByNameInTenant: async (
    tx: Tx,
    name: string,
    excludeId?: string
  ): Promise<MessageTemplate | undefined> => {
    const conditions = [eq(messageTemplates.name, name)];
    if (excludeId) {
      conditions.push(sql`${messageTemplates.id} <> ${excludeId}`);
    }
    const [template] = await tx
      .select()
      .from(messageTemplates)
      .where(and(...conditions))
      .limit(1);
    return template;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<MessageTemplate> => {
    const [template] = await tx
      .insert(messageTemplates)
      .values({
        tenantId,
        name: input.name,
        body: input.body,
        kind: input.kind,
        surfaceInStage: input.surfaceInStage,
      })
      .returning();
    if (!template) throw new Error('Falha ao inserir template');
    return template;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch
  ): Promise<MessageTemplate | undefined> => {
    const [template] = await tx
      .update(messageTemplates)
      .set(patch)
      .where(eq(messageTemplates.id, id))
      .returning();
    return template;
  },

  delete: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(messageTemplates)
      .where(eq(messageTemplates.id, id))
      .returning({ id: messageTemplates.id });
    return deleted.length > 0;
  },

  setActive: async (
    tx: Tx,
    id: string,
    active: boolean
  ): Promise<MessageTemplate | undefined> => {
    const [template] = await tx
      .update(messageTemplates)
      .set({ active })
      .where(eq(messageTemplates.id, id))
      .returning();
    return template;
  },
};
