import {
  and,
  asc,
  eq,
  groups,
  inArray,
  menuGroups,
  menuTenants,
  menus,
  searchInColumns,
  sql,
  tenants,
  type Db,
  type Tx,
  userGroups,
} from '@elora/db';
import type { Group } from '../groups/GroupsTypes.js';
import type { Menu } from './MenusTypes.js';

// Todos os métodos operam em tabelas globais (menus, menu_tenants,
// menu_groups, groups). Aceitam `db` ou `Tx` indiscriminadamente. Único
// método tenant-scoped é `listVisibleMenuIdsForUser` (usa user_groups, que
// tem RLS) — esse exige `Tx` aberto via withTenant.
type DbOrTx = Db | Tx;

interface FindFilters {
  q?: string;
  active?: boolean;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  parentId?: string | null;
  label: string;
  icon?: string | null;
  color?: string | null;
  path?: string | null;
  position?: number;
}

interface UpdatePatch {
  parentId?: string | null;
  label?: string;
  icon?: string | null;
  color?: string | null;
  path?: string | null;
  position?: number;
}

export interface MenuTenantRow {
  id: string;
  slug: string;
  name: string;
  linkedAt: Date;
}

// Queries do catálogo global (menus, menu_tenants). Não dependem de
// `app.current_tenant` — recebem `tx` direto do `db` global.
// Queries de visibilidade por grupo (menu_groups) continuam tenant-scoped:
// quem chama precisa passar um `tx` aberto via `withTenant(...)`.
export const MenusQuery = {
  findPaginated: async (
    tx: DbOrTx,
    filters: FindFilters,
    pagination: Pagination
  ): Promise<{ items: Menu[]; total: number }> => {
    const where = and(
      searchInColumns(filters.q, menus.label),
      filters.active !== undefined ? eq(menus.active, filters.active) : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(menus)
      .where(where)
      .orderBy(asc(menus.position), asc(menus.label))
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(menus)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: DbOrTx, id: string): Promise<Menu | undefined> => {
    const [menu] = await tx.select().from(menus).where(eq(menus.id, id)).limit(1);
    return menu;
  },

  // Lista plana de todos os menus (sem paginação). Catálogo global é pequeno
  // (dezenas, não milhares) — frontend monta a árvore em memória.
  listAll: async (tx: DbOrTx, activeOnly: boolean): Promise<Menu[]> => {
    return tx
      .select()
      .from(menus)
      .where(activeOnly ? eq(menus.active, true) : undefined)
      .orderBy(asc(menus.position), asc(menus.label));
  },

  // IDs de menus que o tenant tem acesso (linhas em menu_tenants).
  listMenuIdsForTenant: async (
    tx: DbOrTx,
    tenantId: string
  ): Promise<string[]> => {
    const rows = await tx
      .select({ menuId: menuTenants.menuId })
      .from(menuTenants)
      .where(eq(menuTenants.tenantId, tenantId));
    return rows.map((r) => r.menuId);
  },

  // IDs de menus que algum grupo do usuário tem acesso direto. Visibilidade
  // implícita de ancestrais é computada em código (mais barato que CTE recursiva
  // pra trees pequenas). user_groups tem RLS por tenant — precisa rodar dentro
  // de `withTenant(...)`. menu_groups e groups são globais (sem RLS).
  listVisibleMenuIdsForUser: async (
    tx: Tx,
    userId: string
  ): Promise<string[]> => {
    const rows = await tx
      .selectDistinct({ menuId: menuGroups.menuId })
      .from(menuGroups)
      .innerJoin(userGroups, eq(userGroups.groupId, menuGroups.groupId))
      .where(eq(userGroups.userId, userId));
    return rows.map((r) => r.menuId);
  },

  create: async (tx: DbOrTx, input: CreateInput): Promise<Menu> => {
    const [menu] = await tx
      .insert(menus)
      .values({
        parentId: input.parentId ?? null,
        label: input.label,
        icon: input.icon ?? null,
        color: input.color ?? null,
        path: input.path ?? null,
        position: input.position ?? 0,
      })
      .returning();
    if (!menu) throw new Error('Falha ao inserir menu');
    return menu;
  },

  update: async (tx: DbOrTx, id: string, patch: UpdatePatch): Promise<Menu | undefined> => {
    const [menu] = await tx
      .update(menus)
      .set(patch)
      .where(eq(menus.id, id))
      .returning();
    return menu;
  },

  delete: async (tx: DbOrTx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(menus)
      .where(eq(menus.id, id))
      .returning({ id: menus.id });
    return deleted.length > 0;
  },

  setActive: async (tx: DbOrTx, id: string, active: boolean): Promise<Menu | undefined> => {
    const [menu] = await tx
      .update(menus)
      .set({ active })
      .where(eq(menus.id, id))
      .returning();
    return menu;
  },

  // ---- menu_tenants (catálogo global -> tenants habilitados) ----

  listTenants: async (tx: DbOrTx, menuId: string): Promise<MenuTenantRow[]> => {
    return tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        linkedAt: menuTenants.createdAt,
      })
      .from(menuTenants)
      .innerJoin(tenants, eq(menuTenants.tenantId, tenants.id))
      .where(eq(menuTenants.menuId, menuId))
      .orderBy(asc(tenants.name));
  },

  isTenantAttached: async (
    tx: DbOrTx,
    menuId: string,
    tenantId: string
  ): Promise<boolean> => {
    const [row] = await tx
      .select({ menuId: menuTenants.menuId })
      .from(menuTenants)
      .where(
        and(eq(menuTenants.menuId, menuId), eq(menuTenants.tenantId, tenantId))
      )
      .limit(1);
    return Boolean(row);
  },

  attachTenant: async (
    tx: DbOrTx,
    menuId: string,
    tenantId: string
  ): Promise<void> => {
    await tx
      .insert(menuTenants)
      .values({ menuId, tenantId })
      .onConflictDoNothing();
  },

  detachTenant: async (
    tx: DbOrTx,
    menuId: string,
    tenantId: string
  ): Promise<boolean> => {
    const deleted = await tx
      .delete(menuTenants)
      .where(
        and(eq(menuTenants.menuId, menuId), eq(menuTenants.tenantId, tenantId))
      )
      .returning({ menuId: menuTenants.menuId });
    return deleted.length > 0;
  },

  // IDs (não objetos) — usado pra calcular diff de set.
  listTenantIds: async (tx: DbOrTx, menuId: string): Promise<string[]> => {
    const rows = await tx
      .select({ tenantId: menuTenants.tenantId })
      .from(menuTenants)
      .where(eq(menuTenants.menuId, menuId));
    return rows.map((r) => r.tenantId);
  },

  // Substitui a lista de tenants vinculados ao menu em uma transação:
  // remove os ausentes e insere os novos. `existingTenantIds` deve cobrir
  // todos os IDs válidos (já validados no caller).
  setTenants: async (
    tx: Tx,
    menuId: string,
    desiredTenantIds: string[]
  ): Promise<void> => {
    const current = new Set(await MenusQuery.listTenantIds(tx, menuId));
    const desired = new Set(desiredTenantIds);
    const toAdd = [...desired].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !desired.has(id));

    if (toRemove.length > 0) {
      await tx
        .delete(menuTenants)
        .where(
          and(
            eq(menuTenants.menuId, menuId),
            inArray(menuTenants.tenantId, toRemove)
          )
        );
    }
    if (toAdd.length > 0) {
      await tx
        .insert(menuTenants)
        .values(toAdd.map((tenantId) => ({ menuId, tenantId })));
    }
  },

  // ---- menu_groups (visibilidade por grupo — GLOBAL) ----
  // Matriz única no sistema, gerenciada pela equipe Elora. Sem RLS.

  listGroups: async (tx: DbOrTx, menuId: string): Promise<Group[]> => {
    return tx
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
        roleCode: groups.roleCode,
        active: groups.active,
        createdAt: groups.createdAt,
        updatedAt: groups.updatedAt,
      })
      .from(menuGroups)
      .innerJoin(groups, eq(menuGroups.groupId, groups.id))
      .where(eq(menuGroups.menuId, menuId))
      .orderBy(asc(groups.name));
  },

  isGroupAttached: async (
    tx: DbOrTx,
    menuId: string,
    groupId: string
  ): Promise<boolean> => {
    const [row] = await tx
      .select({ menuId: menuGroups.menuId })
      .from(menuGroups)
      .where(and(eq(menuGroups.menuId, menuId), eq(menuGroups.groupId, groupId)))
      .limit(1);
    return Boolean(row);
  },

  attachGroup: async (
    tx: DbOrTx,
    menuId: string,
    groupId: string
  ): Promise<void> => {
    await tx
      .insert(menuGroups)
      .values({ menuId, groupId })
      .onConflictDoNothing();
  },

  detachGroup: async (
    tx: DbOrTx,
    menuId: string,
    groupId: string
  ): Promise<boolean> => {
    const deleted = await tx
      .delete(menuGroups)
      .where(and(eq(menuGroups.menuId, menuId), eq(menuGroups.groupId, groupId)))
      .returning({ menuId: menuGroups.menuId });
    return deleted.length > 0;
  },

  listGroupIds: async (tx: DbOrTx, menuId: string): Promise<string[]> => {
    const rows = await tx
      .select({ groupId: menuGroups.groupId })
      .from(menuGroups)
      .where(eq(menuGroups.menuId, menuId));
    return rows.map((r) => r.groupId);
  },

  // Substitui a lista de grupos vinculados ao menu (set idempotente, global).
  setGroups: async (
    tx: Tx,
    menuId: string,
    desiredGroupIds: string[]
  ): Promise<void> => {
    const current = new Set(await MenusQuery.listGroupIds(tx, menuId));
    const desired = new Set(desiredGroupIds);
    const toAdd = [...desired].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !desired.has(id));

    if (toRemove.length > 0) {
      await tx
        .delete(menuGroups)
        .where(
          and(
            eq(menuGroups.menuId, menuId),
            inArray(menuGroups.groupId, toRemove)
          )
        );
    }
    if (toAdd.length > 0) {
      await tx
        .insert(menuGroups)
        .values(toAdd.map((groupId) => ({ menuId, groupId })));
    }
  },
};
