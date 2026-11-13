import { useQuery } from '@tanstack/react-query'
import { fetchGroups, type Group } from '@/api/groups'

export const GROUPS_QUERY_KEY = ['groups'] as const

// Lista grupos globais. Cache longo: catálogo é fixo (5 grupos hoje),
// mutations de super-admin invalidam explicitamente quando vierem.
export function useGroups() {
  return useQuery<Group[], Error>({
    queryKey: GROUPS_QUERY_KEY,
    queryFn: fetchGroups,
    staleTime: 5 * 60 * 1000,
  })
}
