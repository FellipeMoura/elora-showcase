import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  activateMenu,
  createMenu,
  deactivateMenu,
  deleteMenu,
  fetchMenuGroups,
  fetchMenuTenants,
  fetchMenuTree,
  setMenuGroups,
  setMenuTenants,
  updateMenu,
  type CreateMenuInput,
  type Menu,
  type MenuNode,
  type MenuTenantLink,
  type UpdateMenuInput,
} from '@/api/menus'
import type { Group } from '@/api/groups'

// Chave raiz das queries de menus. Mutations invalidam por raiz pra pegar
// tanto a árvore admin (/menus/tree) quanto a visível ao usuário
// (`['menus', 'visible']` em `useVisibleMenus`) — qualquer write pode
// afetar o sidebar do usuário logado.
export const MENUS_QUERY_KEY = ['menus'] as const

export function menuTreeKey() {
  return [...MENUS_QUERY_KEY, 'tree'] as const
}

// Árvore completa pra tela de admin. staleTime alto: menus não mudam
// com frequência e a tela tem refetch manual via mutations.
export function useMenuTree() {
  return useQuery<MenuNode[], Error>({
    queryKey: menuTreeKey(),
    queryFn: fetchMenuTree,
    staleTime: 60 * 1000,
  })
}

export function useCreateMenu() {
  const queryClient = useQueryClient()
  return useMutation<Menu, Error, CreateMenuInput>({
    mutationFn: (input) => createMenu(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MENUS_QUERY_KEY })
    },
  })
}

export function useUpdateMenu() {
  const queryClient = useQueryClient()
  return useMutation<Menu, Error, { id: string; input: UpdateMenuInput }>({
    mutationFn: ({ id, input }) => updateMenu(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MENUS_QUERY_KEY })
    },
  })
}

export function useDeleteMenu() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => deleteMenu(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MENUS_QUERY_KEY })
    },
  })
}

export function useActivateMenu() {
  const queryClient = useQueryClient()
  return useMutation<Menu, Error, string>({
    mutationFn: (id) => activateMenu(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MENUS_QUERY_KEY })
    },
  })
}

export function useDeactivateMenu() {
  const queryClient = useQueryClient()
  return useMutation<Menu, Error, string>({
    mutationFn: (id) => deactivateMenu(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MENUS_QUERY_KEY })
    },
  })
}

// Tenants vinculados a um menu específico — usado no form pra pré-marcar
// checkboxes. `enabled: !!menuId` evita request quando criando novo.
export function useMenuTenants(menuId: string | null | undefined) {
  return useQuery<MenuTenantLink[], Error>({
    queryKey: [...MENUS_QUERY_KEY, menuId ?? '_none_', 'tenants'] as const,
    queryFn: () => fetchMenuTenants(menuId as string),
    enabled: Boolean(menuId),
    staleTime: 30 * 1000,
  })
}

// Substitui a lista completa de tenants do menu (set idempotente).
// Invalida a query de tenants do próprio menu + a árvore (caso afete
// sidebar de algum tenant que tenha o cache aberto).
export function useSetMenuTenants() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { menuId: string; tenantIds: string[] }>({
    mutationFn: ({ menuId, tenantIds }) => setMenuTenants(menuId, tenantIds),
    onSuccess: (_data, { menuId }) => {
      queryClient.invalidateQueries({
        queryKey: [...MENUS_QUERY_KEY, menuId, 'tenants'],
      })
      queryClient.invalidateQueries({ queryKey: MENUS_QUERY_KEY })
    },
  })
}

// Grupos vinculados a um menu — pré-marca os checkboxes no form.
// `enabled: !!menuId` evita request ao criar novo.
export function useMenuGroups(menuId: string | null | undefined) {
  return useQuery<Group[], Error>({
    queryKey: [...MENUS_QUERY_KEY, menuId ?? '_none_', 'groups'] as const,
    queryFn: () => fetchMenuGroups(menuId as string),
    enabled: Boolean(menuId),
    staleTime: 30 * 1000,
  })
}

// Substitui a lista completa de grupos do menu (set idempotente, global).
export function useSetMenuGroups() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, { menuId: string; groupIds: string[] }>({
    mutationFn: ({ menuId, groupIds }) => setMenuGroups(menuId, groupIds),
    onSuccess: (_data, { menuId }) => {
      queryClient.invalidateQueries({
        queryKey: [...MENUS_QUERY_KEY, menuId, 'groups'],
      })
      queryClient.invalidateQueries({ queryKey: MENUS_QUERY_KEY })
    },
  })
}
