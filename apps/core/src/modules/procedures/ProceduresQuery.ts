import {
  and,
  eq,
  procedures,
  searchInColumns,
  sql,
  type SQL,
  type Tx,
} from '@elora/db';
import type { Procedure } from './ProceduresTypes.js';

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
  description?: string | null;
  defaultSessions: number;
  defaultPrice?: number | null;
  color?: string | null;
}

interface UpdatePatch {
  name?: string;
  description?: string | null;
  defaultSessions?: number;
  defaultPrice?: number | null;
  color?: string | null;
}

// Drizzle armazena decimal como string no driver pg. Convertemos no insert/update
// pra evitar bug silencioso de coerção; reads vêm como string e a API expõe
// como string (cliente decide formatação).
function priceToString(v: number | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return v.toFixed(2);
}

export const ProceduresQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: Procedure[]; total: number }> => {
    const where = and(
      searchInColumns(filters.q, procedures.name),
      filters.active !== undefined ? eq(procedures.active, filters.active) : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(procedures)
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(procedures)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<Procedure | undefined> => {
    const [row] = await tx
      .select()
      .from(procedures)
      .where(eq(procedures.id, id))
      .limit(1);
    return row;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<Procedure> => {
    const [row] = await tx
      .insert(procedures)
      .values({
        tenantId,
        name: input.name,
        description: input.description ?? null,
        defaultSessions: input.defaultSessions,
        defaultPrice: priceToString(input.defaultPrice) ?? null,
        color: input.color ?? null,
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir procedure');
    return row;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch
  ): Promise<Procedure | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.defaultSessions !== undefined) set.defaultSessions = patch.defaultSessions;
    if (patch.defaultPrice !== undefined) set.defaultPrice = priceToString(patch.defaultPrice);
    if (patch.color !== undefined) set.color = patch.color;

    const [row] = await tx
      .update(procedures)
      .set(set)
      .where(eq(procedures.id, id))
      .returning();
    return row;
  },

  setActive: async (
    tx: Tx,
    id: string,
    active: boolean
  ): Promise<Procedure | undefined> => {
    const [row] = await tx
      .update(procedures)
      .set({ active })
      .where(eq(procedures.id, id))
      .returning();
    return row;
  },

  delete: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(procedures)
      .where(eq(procedures.id, id))
      .returning({ id: procedures.id });
    return deleted.length > 0;
  },
};
