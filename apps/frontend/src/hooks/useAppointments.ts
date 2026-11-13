import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  attendAppointment,
  cancelAppointment,
  confirmAppointment,
  createAppointment,
  fetchAppointmentById,
  fetchAppointments,
  noShowAppointment,
  updateAppointment,
  type Appointment,
  type CreateAppointmentInput,
  type FindAppointmentsQuery,
  type PaginatedAppointments,
  type UpdateAppointmentInput,
} from '@/api/appointments'

export const APPOINTMENTS_QUERY_KEY = ['appointments'] as const

export function appointmentsListKey(query: FindAppointmentsQuery) {
  return [...APPOINTMENTS_QUERY_KEY, 'list', query] as const
}

export function appointmentByIdKey(id: string) {
  return [...APPOINTMENTS_QUERY_KEY, 'detail', id] as const
}

export function useAppointments(query: FindAppointmentsQuery, enabled = true) {
  return useQuery<PaginatedAppointments, Error>({
    queryKey: appointmentsListKey(query),
    queryFn: () => fetchAppointments(query),
    placeholderData: (prev) => prev,
    staleTime: 15 * 1000,
    enabled,
  })
}

export function useAppointment(id: string | undefined) {
  return useQuery<Appointment, Error>({
    queryKey: appointmentByIdKey(id ?? ''),
    queryFn: () => fetchAppointmentById(id as string),
    enabled: Boolean(id),
  })
}

// Invalidações: appointments + journeys (events timeline + lastActivityAt)
// + free-slots (slot que foi tomado/liberado) + procedure-sessions (status
// muda no fluxo attend de procedure).
function invalidateAllRelated(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: APPOINTMENTS_QUERY_KEY })
  queryClient.invalidateQueries({ queryKey: ['journeys'] })
  queryClient.invalidateQueries({ queryKey: ['availability', 'free-slots'] })
  queryClient.invalidateQueries({ queryKey: ['procedureSessions'] })
}

export function useCreateAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateAppointmentInput) => createAppointment(input),
    onSuccess: () => invalidateAllRelated(queryClient),
  })
}

export function useUpdateAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAppointmentInput }) =>
      updateAppointment(id, input),
    onSuccess: (_d, vars) => {
      invalidateAllRelated(queryClient)
      queryClient.invalidateQueries({ queryKey: appointmentByIdKey(vars.id) })
    },
  })
}

export function useConfirmAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => confirmAppointment(id),
    onSuccess: (_d, id) => {
      invalidateAllRelated(queryClient)
      queryClient.invalidateQueries({ queryKey: appointmentByIdKey(id) })
    },
  })
}

export function useAttendAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => attendAppointment(id),
    onSuccess: (_d, id) => {
      // attend dispara cascata (treatment criado/completed, journey stage,
      // session done) — invalida tudo conservadoramente.
      invalidateAllRelated(queryClient)
      queryClient.invalidateQueries({ queryKey: ['treatments'] })
      queryClient.invalidateQueries({ queryKey: appointmentByIdKey(id) })
    },
  })
}

export function useNoShowAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => noShowAppointment(id),
    onSuccess: (_d, id) => {
      invalidateAllRelated(queryClient)
      queryClient.invalidateQueries({ queryKey: appointmentByIdKey(id) })
    },
  })
}

export function useCancelAppointment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelAppointment(id),
    onSuccess: (_d, id) => {
      invalidateAllRelated(queryClient)
      queryClient.invalidateQueries({ queryKey: appointmentByIdKey(id) })
    },
  })
}
