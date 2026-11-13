import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  createException,
  createSchedule,
  deleteException,
  deleteSchedule,
  fetchExceptions,
  fetchFreeSlots,
  fetchSchedules,
  updateException,
  updateSchedule,
  type CreateExceptionInput,
  type CreateScheduleInput,
  type FindExceptionsQuery,
  type FindSchedulesQuery,
  type FreeSlot,
  type FreeSlotsQuery,
  type ProfessionalSchedule,
  type ScheduleException,
  type UpdateExceptionInput,
  type UpdateScheduleInput,
} from '@/api/availability'

export const AVAILABILITY_QUERY_KEY = ['availability'] as const

export function schedulesKey(query: FindSchedulesQuery) {
  return [...AVAILABILITY_QUERY_KEY, 'schedules', query] as const
}

export function exceptionsKey(query: FindExceptionsQuery) {
  return [...AVAILABILITY_QUERY_KEY, 'exceptions', query] as const
}

export function freeSlotsKey(query: FreeSlotsQuery) {
  return [...AVAILABILITY_QUERY_KEY, 'free-slots', query] as const
}

// =====================================================================
// Schedules
// =====================================================================

export function useSchedules(query: FindSchedulesQuery, enabled = true) {
  return useQuery<ProfessionalSchedule[], Error>({
    queryKey: schedulesKey(query),
    queryFn: () => fetchSchedules(query),
    enabled,
    staleTime: 30 * 1000,
  })
}

export function useCreateSchedule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateScheduleInput) => createSchedule(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AVAILABILITY_QUERY_KEY })
    },
  })
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateScheduleInput }) =>
      updateSchedule(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AVAILABILITY_QUERY_KEY })
    },
  })
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteSchedule(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AVAILABILITY_QUERY_KEY })
    },
  })
}

// =====================================================================
// Exceptions
// =====================================================================

export function useExceptions(query: FindExceptionsQuery, enabled = true) {
  return useQuery<ScheduleException[], Error>({
    queryKey: exceptionsKey(query),
    queryFn: () => fetchExceptions(query),
    enabled,
    staleTime: 30 * 1000,
  })
}

export function useCreateException() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateExceptionInput) => createException(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AVAILABILITY_QUERY_KEY })
    },
  })
}

export function useUpdateException() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateExceptionInput }) =>
      updateException(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AVAILABILITY_QUERY_KEY })
    },
  })
}

export function useDeleteException() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteException(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AVAILABILITY_QUERY_KEY })
    },
  })
}

// =====================================================================
// Free slots (consumido pela agenda)
// =====================================================================

export function useFreeSlots(query: FreeSlotsQuery, enabled = true) {
  return useQuery<FreeSlot[], Error>({
    queryKey: freeSlotsKey(query),
    queryFn: () => fetchFreeSlots(query),
    enabled,
    // Slots livres mudam a cada agendamento — mantém staleTime baixo pra
    // listas de slots na UI sempre refletirem estado atual.
    staleTime: 5 * 1000,
  })
}
