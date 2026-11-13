import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  activateProcedure,
  createProcedure,
  deactivateProcedure,
  deleteProcedure,
  fetchProcedureById,
  fetchProcedures,
  updateProcedure,
  type CreateProcedureInput,
  type FindProceduresQuery,
  type PaginatedProcedures,
  type Procedure,
  type UpdateProcedureInput,
} from '@/api/procedures'

export const PROCEDURES_QUERY_KEY = ['procedures'] as const

export function proceduresListKey(query: FindProceduresQuery) {
  return [...PROCEDURES_QUERY_KEY, 'list', query] as const
}

export function procedureByIdKey(id: string) {
  return [...PROCEDURES_QUERY_KEY, 'detail', id] as const
}

export function useProcedures(query: FindProceduresQuery) {
  return useQuery<PaginatedProcedures, Error>({
    queryKey: proceduresListKey(query),
    queryFn: () => fetchProcedures(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useProcedure(id: string | undefined) {
  return useQuery<Procedure, Error>({
    queryKey: procedureByIdKey(id ?? ''),
    queryFn: () => fetchProcedureById(id as string),
    enabled: Boolean(id),
  })
}

export function useCreateProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateProcedureInput) => createProcedure(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROCEDURES_QUERY_KEY })
    },
  })
}

export function useUpdateProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateProcedureInput }) =>
      updateProcedure(id, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: PROCEDURES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: procedureByIdKey(vars.id) })
    },
  })
}

export function useDeactivateProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deactivateProcedure(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROCEDURES_QUERY_KEY })
    },
  })
}

export function useActivateProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => activateProcedure(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROCEDURES_QUERY_KEY })
    },
  })
}

export function useDeleteProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteProcedure(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROCEDURES_QUERY_KEY })
    },
  })
}
