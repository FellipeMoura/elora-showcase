import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  createLead,
  fetchLeadById,
  fetchLeads,
  fetchLeadsBoard,
  fetchLeadsCounts,
  markLeadLost,
  recomputeLeadSubstage,
  recycleLead,
  updateLeadSubstage,
  type CreateLeadInput,
  type FindLeadsQuery,
  type LeadDetail,
  type LeadsBoardResponse,
  type LeadsCounts,
  type MarkLeadLostInput,
  type PaginatedLeads,
  type UpdateLeadSubstageInput,
} from '@/api/leads'
import { JOURNEYS_QUERY_KEY } from './useJourneys'

// Chave raiz das queries do recurso. Mutations invalidam por raiz pra
// pegar board/list/counts/detail em um único invalidate.
export const LEADS_QUERY_KEY = ['leads'] as const

export function leadsBoardKey(query: FindLeadsQuery) {
  return [...LEADS_QUERY_KEY, 'board', query] as const
}

export function leadsListKey(query: FindLeadsQuery) {
  return [...LEADS_QUERY_KEY, 'list', query] as const
}

export function leadsCountsKey(
  query: Omit<FindLeadsQuery, 'page' | 'pageSize' | 'substage' | 'sortBy' | 'sortDir'>,
) {
  return [...LEADS_QUERY_KEY, 'counts', query] as const
}

export function leadByIdKey(id: string) {
  return [...LEADS_QUERY_KEY, 'detail', id] as const
}

// Board kanban. placeholderData mantém o conteúdo enquanto refetch acontece —
// evita flash de "Carregando…" quando filtros mudam.
export function useLeadsBoard(query: FindLeadsQuery) {
  return useQuery<LeadsBoardResponse, Error>({
    queryKey: leadsBoardKey(query),
    queryFn: () => fetchLeadsBoard(query),
    placeholderData: (prev) => prev,
    staleTime: 15 * 1000,
  })
}

export function useLeadsCounts(
  query: Omit<FindLeadsQuery, 'page' | 'pageSize' | 'substage' | 'sortBy' | 'sortDir'>,
) {
  return useQuery<LeadsCounts, Error>({
    queryKey: leadsCountsKey(query),
    queryFn: () => fetchLeadsCounts(query),
    placeholderData: (prev) => prev,
    staleTime: 15 * 1000,
  })
}

export function useLeads(query: FindLeadsQuery) {
  return useQuery<PaginatedLeads, Error>({
    queryKey: leadsListKey(query),
    queryFn: () => fetchLeads(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useLead(id: string | undefined) {
  return useQuery<LeadDetail, Error>({
    queryKey: leadByIdKey(id ?? ''),
    queryFn: () => fetchLeadById(id as string),
    enabled: Boolean(id),
  })
}

// Mutations: invalidam leads + journeys (lead é projeção sobre journey, e o
// board de journeys pode mostrar o mesmo registro).
function invalidateLeads(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY })
  queryClient.invalidateQueries({ queryKey: JOURNEYS_QUERY_KEY })
}

export function useCreateLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateLeadInput) => createLead(input),
    onSuccess: () => invalidateLeads(queryClient),
  })
}

export function useUpdateLeadSubstage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateLeadSubstageInput }) =>
      updateLeadSubstage(id, input),
    onSuccess: (_data, vars) => {
      invalidateLeads(queryClient)
      queryClient.invalidateQueries({ queryKey: leadByIdKey(vars.id) })
    },
  })
}

export function useRecomputeLeadSubstage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => recomputeLeadSubstage(id),
    onSuccess: (_data, id) => {
      invalidateLeads(queryClient)
      queryClient.invalidateQueries({ queryKey: leadByIdKey(id) })
    },
  })
}

export function useMarkLeadLost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MarkLeadLostInput }) =>
      markLeadLost(id, input),
    onSuccess: (_data, vars) => {
      invalidateLeads(queryClient)
      queryClient.invalidateQueries({ queryKey: leadByIdKey(vars.id) })
    },
  })
}

export function useRecycleLead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (previousId: string) => recycleLead(previousId),
    onSuccess: () => invalidateLeads(queryClient),
  })
}
