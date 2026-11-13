import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  closeTreatmentManually,
  fetchTreatmentById,
  fetchTreatments,
  reopenTreatment,
  updateTreatment,
  type CloseTreatmentManuallyInput,
  type FindTreatmentsQuery,
  type PaginatedTreatments,
  type Treatment,
  type TreatmentWithSessions,
  type UpdateTreatmentInput,
} from '@/api/treatments'

export const TREATMENTS_QUERY_KEY = ['treatments'] as const

export function treatmentsListKey(query: FindTreatmentsQuery) {
  return [...TREATMENTS_QUERY_KEY, 'list', query] as const
}

export function treatmentByIdKey(id: string) {
  return [...TREATMENTS_QUERY_KEY, 'detail', id] as const
}

export function useTreatments(query: FindTreatmentsQuery) {
  return useQuery<PaginatedTreatments, Error>({
    queryKey: treatmentsListKey(query),
    queryFn: () => fetchTreatments(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

// Detalhe traz sessions embedded — usado pra renderizar lista de
// procedimentos dentro do ClientDetailPage e decidir se há "agendar".
export function useTreatment(id: string | undefined) {
  return useQuery<TreatmentWithSessions, Error>({
    queryKey: treatmentByIdKey(id ?? ''),
    queryFn: () => fetchTreatmentById(id as string),
    enabled: Boolean(id),
  })
}

export function useUpdateTreatment() {
  const queryClient = useQueryClient()
  return useMutation<
    Treatment,
    Error,
    { id: string; input: UpdateTreatmentInput }
  >({
    mutationFn: ({ id, input }) => updateTreatment(id, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: TREATMENTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: treatmentByIdKey(vars.id) })
    },
  })
}

export function useCloseTreatmentManually() {
  const queryClient = useQueryClient()
  return useMutation<
    Treatment,
    Error,
    { id: string; input?: CloseTreatmentManuallyInput }
  >({
    mutationFn: ({ id, input }) => closeTreatmentManually(id, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: TREATMENTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: treatmentByIdKey(vars.id) })
      queryClient.invalidateQueries({ queryKey: ['journeys'] })
    },
  })
}

export function useReopenTreatment() {
  const queryClient = useQueryClient()
  return useMutation<Treatment, Error, string>({
    mutationFn: (id) => reopenTreatment(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: TREATMENTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: treatmentByIdKey(id) })
      queryClient.invalidateQueries({ queryKey: ['journeys'] })
    },
  })
}
