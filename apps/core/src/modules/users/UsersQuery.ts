import {
  and,
  eq,
  inArray,
  searchInColumns,
  sql,
  userGroups,
  users,
  type Tx,
  type UserPreferences,
} from '@elora/db';
import type { User } from './UsersTypes.js';

interface FindFilters {
  q?: string;
  active?: boolean; // undefined = sem filtro
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  username: string;
  email?: string | null;
  name: string;
  passwordHash: string;
  canEvaluate?: boolean;
  canApplyProcedures?: boolean;
}

type UpdatePatch = Partial<CreateInput>;

export const UsersQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination
  ): Promise<{ items: User[]; total: number }> => {
    const where = and(
      searchInColumns(filters.q, users.username, users.name),
      filters.active !== undefined ? eq(users.active, filters.active) : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    // Queries serializadas porque transação Drizzle usa uma única conexão pg —
    // queries paralelas no mesmo `tx` quebram o protocolo.
    const items = await tx
      .select()
      .from(users)
      .where(where)
      .orderBy(users.name)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(users)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },
  findByUsername: async (tx: Tx, username: string): Promise<User | undefined> => {
    const [user] = await tx.select().from(users).where(eq(users.username, username)).limit(1);
    return user;
  },
  findById: async (tx: Tx, id: string): Promise<User | undefined> => {
    const [user] = await tx.select().from(users).where(eq(users.id, id)).limit(1);
    return user;
  },
  create: async (tx: Tx, tenantId: string, input: CreateInput): Promise<User> => {
    const [user] = await tx
      .insert(users)
      .values({
        tenantId,
        username: input.username,
        email: input.email ?? null,
        name: input.name,
        passwordHash: input.passwordHash,
        canEvaluate: input.canEvaluate,
        canApplyProcedures: input.canApplyProcedures,
      })
      .returning();
    if (!user) throw new Error('Falha ao inserir usuário');
    return user;
  },
  update: async (tx: Tx, id: string, patch: UpdatePatch): Promise<User | undefined> => {
    const [user] = await tx
      .update(users)
      .set(patch)
      .where(eq(users.id, id))
      .returning();
    return user;
  },
  delete: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(users)
      .where(eq(users.id, id))
      .returning({ id: users.id });
    return deleted.length > 0;
  },
  setActive: async (tx: Tx, id: string, active: boolean): Promise<User | undefined> => {
    const [user] = await tx
      .update(users)
      .set({ active })
      .where(eq(users.id, id))
      .returning();
    return user;
  },

  // Merge parcial em users.preferences. Usa o operador jsonb `||` do
  // Postgres pra preservar chaves não enviadas. Patch já validado pelo Zod
  // do caller antes de chegar aqui.
  mergePreferences: async (
    tx: Tx,
    id: string,
    patch: Partial<UserPreferences>
  ): Promise<User | undefined> => {
    const [user] = await tx
      .update(users)
      .set({
        preferences: sql`${users.preferences} || ${JSON.stringify(patch)}::jsonb`,
      })
      .where(eq(users.id, id))
      .returning();
    return user;
  },

  // ---- Membership em grupos globais (user_groups é tenant-scoped + RLS) ----

  // Vínculos por user pra um conjunto de userIds — evita N+1 ao popular
  // groupIds em listagens. Roda dentro de withTenant(...) (RLS filtra).
  listMembershipsForUsers: async (
    tx: Tx,
    userIds: string[]
  ): Promise<Array<{ userId: string; groupId: string }>> => {
    if (userIds.length === 0) return [];
    return tx
      .select({ userId: userGroups.userId, groupId: userGroups.groupId })
      .from(userGroups)
      .where(inArray(userGroups.userId, userIds));
  },

  listUserGroupIds: async (tx: Tx, userId: string): Promise<string[]> => {
    const rows = await tx
      .select({ groupId: userGroups.groupId })
      .from(userGroups)
      .where(eq(userGroups.userId, userId));
    return rows.map((r) => r.groupId);
  },

  // Set idempotente: aplica diff (insere ausentes, remove sobrando) numa
  // transação tenant-scoped. `tenantId` é desnormalizado nas linhas novas.
  setUserGroups: async (
    tx: Tx,
    tenantId: string,
    userId: string,
    desiredGroupIds: string[]
  ): Promise<void> => {
    const current = new Set(await UsersQuery.listUserGroupIds(tx, userId));
    const desired = new Set(desiredGroupIds);
    const toAdd = [...desired].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !desired.has(id));

    if (toRemove.length > 0) {
      await tx
        .delete(userGroups)
        .where(
          and(
            eq(userGroups.userId, userId),
            inArray(userGroups.groupId, toRemove)
          )
        );
    }
    if (toAdd.length > 0) {
      await tx
        .insert(userGroups)
        .values(toAdd.map((groupId) => ({ userId, groupId, tenantId })));
    }
  },
};
