import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  cancelProcedureSession,
  evolveProcedureSession,
  fetchProcedureSessionById,
  fetchProcedureSessions,
  markProcedureSessionDoneManual,
  updateProcedureSessionNotes,
  type EvolveProcedureSessionInput,
  type FindProcedureSessionsQuery,
  type PaginatedProcedureSessions,
  type ProcedureSession,
  type UpdateProcedureSessionInput,
} from '@/api/procedureSessions'

export const PROCEDURE_SESSIONS_QUERY_KEY = ['procedureSessions'] as const

export function procedureSessionsListKey(query: FindProcedureSessionsQuery) {
  return [...PROCEDURE_SESSIONS_QUERY_KEY, 'list', query] as const
}

export function useProcedureSessions(
  query: FindProcedureSessionsQuery,
  enabled = true,
) {
  return useQuery<PaginatedProcedureSessions, Error>({
    queryKey: procedureSessionsListKey(query),
    queryFn: () => fetchProcedureSessions(query),
    placeholderData: (prev) => prev,
    staleTime: 15 * 1000,
    enabled,
  })
}

export function procedureSessionDetailKey(id: string) {
  return [...PROCEDURE_SESSIONS_QUERY_KEY, 'detail', id] as const
}

export function useProcedureSession(id: string | undefined, enabled = true) {
  return useQuery<ProcedureSession, Error>({
    queryKey: procedureSessionDetailKey(id ?? ''),
    queryFn: () => fetchProcedureSessionById(id as string),
    enabled: Boolean(id) && enabled,
    staleTime: 15 * 1000,
  })
}

export function useUpdateProcedureSessionNotes() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: UpdateProcedureSessionInput
    }) => updateProcedureSessionNotes(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROCEDURE_SESSIONS_QUERY_KEY })
    },
  })
}

export function useCancelProcedureSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelProcedureSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROCEDURE_SESSIONS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['treatments'] })
    },
  })
}

export function useMarkProcedureSessionDoneManual() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => markProcedureSessionDoneManual(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROCEDURE_SESSIONS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['treatments'] })
      queryClient.invalidateQueries({ queryKey: ['journeys'] })
    },
  })
}

export function useEvolveProcedureSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: EvolveProcedureSessionInput
    }) => evolveProcedureSession(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROCEDURE_SESSIONS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['treatments'] })
      queryClient.invalidateQueries({ queryKey: ['journeys'] })
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
    },
  })
}
