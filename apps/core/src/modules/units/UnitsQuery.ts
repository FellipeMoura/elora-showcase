import {
  and,
  eq,
  searchInColumns,
  sql,
  units,
  type SQL,
  type Tx,
} from '@elora/db';
import type { Unit } from './UnitsTypes.js';

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
}

interface UpdatePatch {
  name?: string;
}

export const UnitsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: Unit[]; total: number }> => {
    const where = and(
      searchInColumns(filters.q, units.name),
      filters.active !== undefined ? eq(units.active, filters.active) : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(units)
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(units)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<Unit | undefined> => {
    const [row] = await tx
      .select()
      .from(units)
      .where(eq(units.id, id))
      .limit(1);
    return row;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<Unit> => {
    const [row] = await tx
      .insert(units)
      .values({ tenantId, name: input.name })
      .returning();
    if (!row) throw new Error('Falha ao inserir unit');
    return row;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch
  ): Promise<Unit | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;

    const [row] = await tx
      .update(units)
      .set(set)
      .where(eq(units.id, id))
      .returning();
    return row;
  },

  setActive: async (
    tx: Tx,
    id: string,
    active: boolean
  ): Promise<Unit | undefined> => {
    const [row] = await tx
      .update(units)
      .set({ active })
      .where(eq(units.id, id))
      .returning();
    return row;
  },

  delete: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(units)
      .where(eq(units.id, id))
      .returning({ id: units.id });
    return deleted.length > 0;
  },
};
