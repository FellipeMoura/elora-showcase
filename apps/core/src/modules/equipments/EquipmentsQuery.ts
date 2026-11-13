import {
  and,
  eq,
  equipments,
  searchInColumns,
  sql,
  type SQL,
  type Tx,
} from '@elora/db';
import type { Equipment } from './EquipmentsTypes.js';

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

export const EquipmentsQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: Equipment[]; total: number }> => {
    const where = and(
      searchInColumns(filters.q, equipments.name),
      filters.active !== undefined ? eq(equipments.active, filters.active) : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(equipments)
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(equipments)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<Equipment | undefined> => {
    const [row] = await tx
      .select()
      .from(equipments)
      .where(eq(equipments.id, id))
      .limit(1);
    return row;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<Equipment> => {
    const [row] = await tx
      .insert(equipments)
      .values({ tenantId, name: input.name })
      .returning();
    if (!row) throw new Error('Falha ao inserir equipment');
    return row;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch
  ): Promise<Equipment | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;

    const [row] = await tx
      .update(equipments)
      .set(set)
      .where(eq(equipments.id, id))
      .returning();
    return row;
  },

  setActive: async (
    tx: Tx,
    id: string,
    active: boolean
  ): Promise<Equipment | undefined> => {
    const [row] = await tx
      .update(equipments)
      .set({ active })
      .where(eq(equipments.id, id))
      .returning();
    return row;
  },

  delete: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(equipments)
      .where(eq(equipments.id, id))
      .returning({ id: equipments.id });
    return deleted.length > 0;
  },
};
