import { useQuery } from '@tanstack/react-query'
import { fetchVisibleMenus, type MenuNode } from '@/api/menus'
import { useMe } from '@/hooks/useMe'

export const VISIBLE_MENUS_QUERY_KEY = ['menus', 'visible'] as const

// Árvore de menus visível ao usuário corrente. Compartilhada por sidebar
// desktop e drawer mobile via cache do TanStack Query — uma fetch só.
// `enabled: !!me?.user` evita disparos em transições de login (refetch on
// focus / queryClient.clear) quando o cache de user ainda está vazio.
export function useVisibleMenus() {
  const { data: me } = useMe()
  return useQuery<MenuNode[], Error>({
    queryKey: VISIBLE_MENUS_QUERY_KEY,
    queryFn: fetchVisibleMenus,
    enabled: !!me?.user,
    staleTime: 10 * 60 * 1000,
  })
}
