import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelEvaluation,
  createEvaluation,
  fetchEvaluationById,
  fetchEvaluations,
  updateEvaluation,
  type CreateEvaluationInput,
  type Evaluation,
  type FindEvaluationsQuery,
  type PaginatedEvaluations,
  type UpdateEvaluationInput,
} from '@/api/evaluations'
import { useMe } from '@/hooks/useMe'

export const EVALUATIONS_QUERY_KEY = ['evaluations'] as const

export function evaluationsListKey(query: FindEvaluationsQuery) {
  return [...EVALUATIONS_QUERY_KEY, 'list', query] as const
}

export function evaluationDetailKey(id: string) {
  return [...EVALUATIONS_QUERY_KEY, 'detail', id] as const
}

export function useEvaluations(query: FindEvaluationsQuery = {}) {
  const { data: me } = useMe()
  return useQuery<PaginatedEvaluations, Error>({
    queryKey: evaluationsListKey(query),
    queryFn: () => fetchEvaluations(query),
    placeholderData: (prev) => prev,
    enabled: !!me?.user,
    staleTime: 30 * 1000,
  })
}

export function useEvaluation(id: string | undefined) {
  const { data: me } = useMe()
  return useQuery<Evaluation, Error>({
    queryKey: evaluationDetailKey(id ?? ''),
    queryFn: () => fetchEvaluationById(id as string),
    enabled: !!me?.user && !!id,
    staleTime: 30 * 1000,
  })
}

function invalidateAll(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: EVALUATIONS_QUERY_KEY })
}

export function useCreateEvaluation() {
  const qc = useQueryClient()
  return useMutation<Evaluation, Error, CreateEvaluationInput>({
    mutationFn: (input) => createEvaluation(input),
    onSuccess: () => {
      invalidateAll(qc)
      // Cria evaluation pode disparar journey_event + recompute substage —
      // invalida journeys/events também pra ClientDetailPage refletir.
      qc.invalidateQueries({ queryKey: ['journeys'] })
    },
  })
}

export interface UpdateEvaluationArgs {
  id: string
  input: UpdateEvaluationInput
}

export function useUpdateEvaluation() {
  const qc = useQueryClient()
  return useMutation<Evaluation, Error, UpdateEvaluationArgs>({
    mutationFn: ({ id, input }) => updateEvaluation(id, input),
    onSuccess: () => invalidateAll(qc),
  })
}

export function useCancelEvaluation() {
  const qc = useQueryClient()
  return useMutation<Evaluation, Error, string>({
    mutationFn: (id) => cancelEvaluation(id),
    onSuccess: () => invalidateAll(qc),
  })
}
