import { coreApi } from '@/api/client'
import type { Group } from './groups'

// Espelha MenuNode do backend (apps/core/src/modules/menus/MenusTypes.ts).
// Catálogo é GLOBAL — não há `tenantId`. Quais tenants veem cada menu é
// definido em `menu_tenants` no backend (endpoints `/menus/:id/tenants`).
export interface Menu {
  id: string
  parentId: string | null
  label: string
  icon: string | null
  // Hex CSS pra cor do ícone na sidebar. Null = herda a cor do texto/tema.
  color: string | null
  path: string | null
  position: number
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface MenuNode extends Menu {
  children: MenuNode[]
}

export interface CreateMenuInput {
  parentId?: string | null
  label: string
  icon?: string | null
  color?: string | null
  path?: string | null
  position?: number
}

export interface UpdateMenuInput {
  parentId?: string | null
  label?: string
  icon?: string | null
  color?: string | null
  path?: string | null
  position?: number
}

interface ItemsResponse<T> {
  items: T[]
}

// Árvore de menus visível ao usuário logado. Filtragem por grupo é feita
// no backend (/menus/visible junta user_groups com menu_groups).
export async function fetchVisibleMenus(): Promise<MenuNode[]> {
  const res = await coreApi.get<ItemsResponse<MenuNode>>('/menus/visible')
  return res.data.items
}

// Árvore completa pra admin (sem filtro de visibilidade). Inclui menus
// inativos também — frontend decide se filtra ou destaca.
export async function fetchMenuTree(): Promise<MenuNode[]> {
  const res = await coreApi.get<ItemsResponse<MenuNode>>('/menus/tree')
  return res.data.items
}

export async function createMenu(input: CreateMenuInput): Promise<Menu> {
  const res = await coreApi.post<Menu>('/menus', input)
  return res.data
}

export async function updateMenu(
  id: string,
  input: UpdateMenuInput,
): Promise<Menu> {
  const res = await coreApi.patch<Menu>(`/menus/${id}`, input)
  return res.data
}

export async function deleteMenu(id: string): Promise<void> {
  await coreApi.delete(`/menus/${id}`)
}

export async function activateMenu(id: string): Promise<Menu> {
  const res = await coreApi.post<Menu>(`/menus/${id}/activate`)
  return res.data
}

export async function deactivateMenu(id: string): Promise<Menu> {
  const res = await coreApi.post<Menu>(`/menus/${id}/deactivate`)
  return res.data
}

// Vínculo menu ↔ tenant (super-admin)

export interface MenuTenantLink {
  id: string
  slug: string
  name: string
  linkedAt: string
}

export async function fetchMenuTenants(menuId: string): Promise<MenuTenantLink[]> {
  const res = await coreApi.get<{ items: MenuTenantLink[] }>(
    `/menus/${menuId}/tenants`,
  )
  return res.data.items
}

// Set idempotente — backend faz diff. Passa lista completa de tenantIds
// que devem ficar vinculados.
export async function setMenuTenants(
  menuId: string,
  tenantIds: string[],
): Promise<void> {
  await coreApi.put(`/menus/${menuId}/tenants`, { tenantIds })
}

// Grupos vinculados a um menu (matriz GLOBAL menu × grupo).
export async function fetchMenuGroups(menuId: string): Promise<Group[]> {
  const res = await coreApi.get<{ items: Group[] }>(`/menus/${menuId}/groups`)
  return res.data.items
}

// Set idempotente de grupos que veem o menu (global).
export async function setMenuGroups(
  menuId: string,
  groupIds: string[],
): Promise<void> {
  await coreApi.put(`/menus/${menuId}/groups`, { groupIds })
}
