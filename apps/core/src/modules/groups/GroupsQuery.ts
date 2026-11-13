import {
  and,
  eq,
  groups,
  searchInColumns,
  sql,
  type Db,
  type Tx,
  userGroups,
  users,
} from '@elora/db';
import type { RoleCode } from '../../shared/permissions/permissions.js';
import type { User } from '../users/UsersTypes.js';
import type { Group } from './GroupsTypes.js';

// CRUD do catálogo de grupos opera no banco GLOBAL — aceita `db` direto.
// Membership (user_groups) é tenant-scoped: métodos que mexem nela exigem
// `Tx` aberto via withTenant.
type DbOrTx = Db | Tx;

interface FindFilters {
  q?: string;
  active?: boolean;
  roleCode?: RoleCode;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  name: string;
  description?: string | null;
  roleCode: RoleCode;
}

interface UpdatePatch {
  name?: string;
  description?: string | null;
  roleCode?: RoleCode;
}

export const GroupsQuery = {
  findPaginated: async (
    tx: DbOrTx,
    filters: FindFilters,
    pagination: Pagination
  ): Promise<{ items: Group[]; total: number }> => {
    const where = and(
      searchInColumns(filters.q, groups.name),
      filters.active !== undefined ? eq(groups.active, filters.active) : undefined,
      filters.roleCode !== undefined
        ? eq(groups.roleCode, filters.roleCode)
        : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(groups)
      .where(where)
      .orderBy(groups.name)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(groups)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: DbOrTx, id: string): Promise<Group | undefined> => {
    const [group] = await tx.select().from(groups).where(eq(groups.id, id)).limit(1);
    return group;
  },

  findByName: async (
    tx: DbOrTx,
    name: string,
    excludeId?: string
  ): Promise<Group | undefined> => {
    const conditions = [eq(groups.name, name)];
    if (excludeId) {
      conditions.push(sql`${groups.id} <> ${excludeId}`);
    }
    const [group] = await tx
      .select()
      .from(groups)
      .where(and(...conditions))
      .limit(1);
    return group;
  },

  create: async (tx: DbOrTx, input: CreateInput): Promise<Group> => {
    const [group] = await tx
      .insert(groups)
      .values({
        name: input.name,
        description: input.description ?? null,
        roleCode: input.roleCode,
      })
      .returning();
    if (!group) throw new Error('Falha ao inserir grupo');
    return group;
  },

  update: async (tx: DbOrTx, id: string, patch: UpdatePatch): Promise<Group | undefined> => {
    const [group] = await tx
      .update(groups)
      .set(patch)
      .where(eq(groups.id, id))
      .returning();
    return group;
  },

  delete: async (tx: DbOrTx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(groups)
      .where(eq(groups.id, id))
      .returning({ id: groups.id });
    return deleted.length > 0;
  },

  setActive: async (tx: DbOrTx, id: string, active: boolean): Promise<Group | undefined> => {
    const [group] = await tx
      .update(groups)
      .set({ active })
      .where(eq(groups.id, id))
      .returning();
    return group;
  },

  // Membership operations — RLS de user_groups exige tenant context (Tx).
  listMembers: async (tx: Tx, groupId: string): Promise<User[]> => {
    return tx
      .select({
        id: users.id,
        tenantId: users.tenantId,
        username: users.username,
        email: users.email,
        passwordHash: users.passwordHash,
        name: users.name,
        active: users.active,
        canEvaluate: users.canEvaluate,
        canApplyProcedures: users.canApplyProcedures,
        isSystemAgent: users.isSystemAgent,
        preferences: users.preferences,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(userGroups)
      .innerJoin(users, eq(userGroups.userId, users.id))
      .where(eq(userGroups.groupId, groupId))
      .orderBy(users.name);
  },

  isMember: async (tx: Tx, groupId: string, userId: string): Promise<boolean> => {
    const [row] = await tx
      .select({ userId: userGroups.userId })
      .from(userGroups)
      .where(and(eq(userGroups.groupId, groupId), eq(userGroups.userId, userId)))
      .limit(1);
    return Boolean(row);
  },

  addMember: async (
    tx: Tx,
    tenantId: string,
    groupId: string,
    userId: string
  ): Promise<void> => {
    await tx
      .insert(userGroups)
      .values({ userId, groupId, tenantId })
      .onConflictDoNothing();
  },

  removeMember: async (tx: Tx, groupId: string, userId: string): Promise<boolean> => {
    const deleted = await tx
      .delete(userGroups)
      .where(and(eq(userGroups.groupId, groupId), eq(userGroups.userId, userId)))
      .returning({ userId: userGroups.userId });
    return deleted.length > 0;
  },
};
