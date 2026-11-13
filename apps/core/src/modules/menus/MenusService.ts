import { eq, groups, inArray, tenants, withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  type PaginatedResult,
  totalPagesOf,
} from '../../shared/types/pagination.js';
import { GroupsQuery } from '../groups/GroupsQuery.js';
import type { Group } from '../groups/GroupsTypes.js';
import { MenusQuery, type MenuTenantRow } from './MenusQuery.js';
import type {
  CreateMenuInput,
  FindMenusQuery,
  Menu,
  MenuNode,
  UpdateMenuInput,
} from './MenusTypes.js';

// Sobe a cadeia de parentIds a partir de `startId`, devolvendo o conjunto de
// ancestrais (sem o próprio startId). Usado pra detectar ciclos e pra inflar
// visibilidade implícita na árvore.
function collectAncestors(
  menusById: Map<string, Menu>,
  startId: string
): Set<string> {
  const ancestors = new Set<string>();
  let current = menusById.get(startId);
  while (current?.parentId) {
    if (ancestors.has(current.parentId)) break; // proteção extra contra dado corrompido
    ancestors.add(current.parentId);
    current = menusById.get(current.parentId);
  }
  return ancestors;
}

function buildTree(items: Menu[]): MenuNode[] {
  const byId = new Map<string, MenuNode>();
  for (const item of items) {
    byId.set(item.id, { ...item, children: [] });
  }
  const roots: MenuNode[] = [];
  for (const item of items) {
    const node = byId.get(item.id)!;
    if (item.parentId && byId.has(item.parentId)) {
      byId.get(item.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  function sortRec(nodes: MenuNode[]): void {
    nodes.sort(
      (a, b) => a.position - b.position || a.label.localeCompare(b.label)
    );
    for (const n of nodes) sortRec(n.children);
  }
  sortRec(roots);
  return roots;
}

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

// Toda a operação é GLOBAL — menus, menu_tenants, menu_groups e groups são
// globais. Único ponto que ainda precisa de tenant context é getVisibleTree
// (resolve user → user_groups, que tem RLS).
export const MenusService = {
  find: async (query: FindMenusQuery): Promise<PaginatedResult<Menu>> => {
    const active = query.status === 'all' ? undefined : query.status === 'active';
    const { items, total } = await MenusQuery.findPaginated(
      db,
      { q: query.q, active },
      { page: query.page, pageSize: query.pageSize }
    );
    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: totalPagesOf(total, query.pageSize),
    };
  },

  findById: async (id: string): Promise<Menu> => {
    const menu = await MenusQuery.findById(db, id);
    if (!menu) throw new AppError('Menu não encontrado', 404);
    return menu;
  },

  // Árvore completa pra admin (ativos + inativos). Sem filtro de visibilidade.
  getTree: async (): Promise<MenuNode[]> => {
    const all = await MenusQuery.listAll(db, false);
    return buildTree(all);
  },

  // Árvore visível ao usuário logado dentro do tenant. Cruza:
  //   - menus globais (active=true)
  //   - menu_tenants(tenant)        → tenant tem direito a esse menu
  //   - menu_groups via user_groups → algum grupo do user tem acesso
  // Inclui ancestrais de menus diretamente acessíveis pra renderizar o caminho.
  getVisibleTree: async (
    tenantId: string,
    userId: string
  ): Promise<MenuNode[]> => {
    const all = await MenusQuery.listAll(db, true);
    const allowedByTenant = new Set(
      await MenusQuery.listMenuIdsForTenant(db, tenantId)
    );

    // RLS de menu_groups + user_groups exige tenant context.
    const allowedByUser = await withTenant(db, tenantId, async (tx) => {
      const ids = await MenusQuery.listVisibleMenuIdsForUser(tx, userId);
      return new Set(ids);
    });

    const direct = new Set<string>();
    for (const id of allowedByTenant) {
      if (allowedByUser.has(id)) direct.add(id);
    }

    const visible = new Set<string>(direct);
    const byId = new Map(all.map((m) => [m.id, m]));
    for (const id of direct) {
      const ancestors = collectAncestors(byId, id);
      // Só inclui ancestral se o tenant também tem direito a ele —
      // evita renderizar "sombras" de menus que o tenant não habilitou.
      for (const a of ancestors) {
        if (allowedByTenant.has(a)) visible.add(a);
      }
    }
    const filtered = all.filter((m) => visible.has(m.id));
    return buildTree(filtered);
  },

  create: async (input: CreateMenuInput): Promise<Menu> => {
    if (input.parentId) {
      const parent = await MenusQuery.findById(db, input.parentId);
      if (!parent) throw new AppError('Menu pai não encontrado', 400);
    }
    return MenusQuery.create(db, input);
  },

  update: async (id: string, input: UpdateMenuInput): Promise<Menu> => {
    const current = await MenusQuery.findById(db, id);
    if (!current) throw new AppError('Menu não encontrado', 404);

    // Se está trocando o parent, validar (existência + ciclo).
    if (input.parentId !== undefined && input.parentId !== current.parentId) {
      if (input.parentId === id) {
        throw new AppError('Menu não pode ser pai de si mesmo', 400);
      }
      if (input.parentId !== null) {
        const all = await MenusQuery.listAll(db, false);
        const byId = new Map(all.map((m) => [m.id, m]));
        if (!byId.has(input.parentId)) {
          throw new AppError('Menu pai não encontrado', 400);
        }
        // Ciclo: o novo parent não pode ser descendente do menu atual.
        // Equivale a: subindo dos ancestrais do novo parent, não pode bater no `id`.
        const ancestorsOfNewParent = collectAncestors(byId, input.parentId);
        ancestorsOfNewParent.add(input.parentId); // inclui o próprio parent
        if (ancestorsOfNewParent.has(id)) {
          throw new AppError(
            'Não é possível mover o menu pra debaixo de um descendente',
            400
          );
        }
      }
    }

    const updated = await MenusQuery.update(db, id, input);
    if (!updated) throw new AppError('Menu não encontrado', 404);
    return updated;
  },

  remove: async (id: string): Promise<void> => {
    try {
      const deleted = await MenusQuery.delete(db, id);
      if (!deleted) throw new AppError('Menu não encontrado', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Menu possui registros vinculados e não pode ser removido',
          409
        );
      }
      throw err;
    }
  },

  deactivate: async (id: string): Promise<Menu> => {
    const current = await MenusQuery.findById(db, id);
    if (!current) throw new AppError('Menu não encontrado', 404);
    if (!current.active) throw new AppError('Menu já está desativado', 409);
    const updated = await MenusQuery.setActive(db, id, false);
    if (!updated) throw new AppError('Menu não encontrado', 404);
    return updated;
  },

  activate: async (id: string): Promise<Menu> => {
    const current = await MenusQuery.findById(db, id);
    if (!current) throw new AppError('Menu não encontrado', 404);
    if (current.active) throw new AppError('Menu já está ativo', 409);
    const updated = await MenusQuery.setActive(db, id, true);
    if (!updated) throw new AppError('Menu não encontrado', 404);
    return updated;
  },

  // ---- Vínculo menu ↔ tenant (catálogo global) ----

  listTenants: async (menuId: string): Promise<MenuTenantRow[]> => {
    const menu = await MenusQuery.findById(db, menuId);
    if (!menu) throw new AppError('Menu não encontrado', 404);
    return MenusQuery.listTenants(db, menuId);
  },

  attachTenant: async (menuId: string, tenantId: string): Promise<void> => {
    const menu = await MenusQuery.findById(db, menuId);
    if (!menu) throw new AppError('Menu não encontrado', 404);
    // `tenants` é tabela global — consulta direta, sem withTenant.
    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) throw new AppError('Tenant não encontrado', 404);
    const already = await MenusQuery.isTenantAttached(db, menuId, tenantId);
    if (already) throw new AppError('Tenant já tem acesso a este menu', 409);
    await MenusQuery.attachTenant(db, menuId, tenantId);
  },

  detachTenant: async (menuId: string, tenantId: string): Promise<void> => {
    const removed = await MenusQuery.detachTenant(db, menuId, tenantId);
    if (!removed) throw new AppError('Vínculo não encontrado', 404);
  },

  // Substitui a lista de tenants vinculados ao menu (set idempotente).
  // Valida que todos os IDs existem em `tenants` antes de aplicar.
  setTenants: async (menuId: string, tenantIds: string[]): Promise<void> => {
    const menu = await MenusQuery.findById(db, menuId);
    if (!menu) throw new AppError('Menu não encontrado', 404);

    const uniqueIds = [...new Set(tenantIds)];
    if (uniqueIds.length > 0) {
      const existing = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(inArray(tenants.id, uniqueIds));
      const existingSet = new Set(existing.map((t) => t.id));
      const missing = uniqueIds.filter((id) => !existingSet.has(id));
      if (missing.length > 0) {
        throw new AppError(
          `Tenants inexistentes: ${missing.join(', ')}`,
          400
        );
      }
    }

    await db.transaction(async (tx) => {
      await MenusQuery.setTenants(tx, menuId, uniqueIds);
    });
  },

  // ---- Visibilidade por grupo (GLOBAL) ----
  // Matriz menu × grupo é única no sistema — gerenciada pela equipe Elora.
  // Tenant cliente não chega aqui (rotas têm requirePlatformAccess).

  listGroups: async (menuId: string): Promise<Group[]> => {
    const menu = await MenusQuery.findById(db, menuId);
    if (!menu) throw new AppError('Menu não encontrado', 404);
    return MenusQuery.listGroups(db, menuId);
  },

  attachGroup: async (menuId: string, groupId: string): Promise<void> => {
    const menu = await MenusQuery.findById(db, menuId);
    if (!menu) throw new AppError('Menu não encontrado', 404);
    const group = await GroupsQuery.findById(db, groupId);
    if (!group) throw new AppError('Grupo não encontrado', 404);
    const already = await MenusQuery.isGroupAttached(db, menuId, groupId);
    if (already) throw new AppError('Grupo já tem acesso a este menu', 409);
    await MenusQuery.attachGroup(db, menuId, groupId);
  },

  detachGroup: async (menuId: string, groupId: string): Promise<void> => {
    const removed = await MenusQuery.detachGroup(db, menuId, groupId);
    if (!removed) throw new AppError('Vínculo não encontrado', 404);
  },

  // Substitui a lista de grupos que veem o menu (set global, idempotente).
  // Valida que o menu existe e que todos os grupos passados existem.
  setGroups: async (menuId: string, groupIds: string[]): Promise<void> => {
    const menu = await MenusQuery.findById(db, menuId);
    if (!menu) throw new AppError('Menu não encontrado', 404);

    const uniqueIds = [...new Set(groupIds)];

    if (uniqueIds.length > 0) {
      const found = await db
        .select({ id: groups.id })
        .from(groups)
        .where(inArray(groups.id, uniqueIds));
      const foundSet = new Set(found.map((g) => g.id));
      const missing = uniqueIds.filter((id) => !foundSet.has(id));
      if (missing.length > 0) {
        throw new AppError(
          `Grupos inexistentes: ${missing.join(', ')}`,
          400
        );
      }
    }

    await db.transaction(async (tx) => {
      await MenusQuery.setGroups(tx, menuId, uniqueIds);
    });
  },
};
