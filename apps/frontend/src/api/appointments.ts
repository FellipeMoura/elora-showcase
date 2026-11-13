import { coreApi } from '@/api/client'

// =====================================================================
// Espelha apps/core/src/modules/appointments/AppointmentsTypes.ts.
// Polimorfismo via discriminated union — kind decide quais FKs são válidos.
// =====================================================================

export const APPOINTMENT_KINDS = ['evaluation', 'procedure'] as const
export type AppointmentKind = (typeof APPOINTMENT_KINDS)[number]

export const APPOINTMENT_STATUSES = [
  'scheduled',
  'confirmed',
  'attended',
  'no_show',
  'cancelled',
] as const
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number]

export const EVALUATION_KINDS = [
  'initial',
  'reevaluation',
  'return',
] as const
export type EvaluationKind = (typeof EVALUATION_KINDS)[number]

export interface Appointment {
  id: string
  tenantId: string
  journeyId: string
  clientId: string
  kind: AppointmentKind
  evaluationId: string | null
  procedureSessionId: string | null
  professionalId: string | null
  unitId: string | null
  equipmentId: string | null
  scheduledAt: string
  durationMinutes: number
  status: AppointmentStatus
  notes: string | null
  createdAt: string
  updatedAt: string
}

export type CreateAppointmentInput =
  | {
      kind: 'evaluation'
      journeyId: string
      professionalId?: string | null
      unitId?: string | null
      scheduledAt: string
      durationMinutes: number
      notes?: string | null
      evaluation: { kind: EvaluationKind }
    }
  | {
      kind: 'procedure'
      journeyId: string
      procedureSessionId: string
      professionalId?: string | null
      unitId?: string | null
      equipmentId?: string | null
      scheduledAt: string
      durationMinutes: number
      notes?: string | null
    }

export interface UpdateAppointmentInput {
  professionalId?: string | null
  unitId?: string | null
  equipmentId?: string | null
  scheduledAt?: string
  durationMinutes?: number
  notes?: string | null
}

export interface FindAppointmentsQuery {
  page?: number
  pageSize?: number
  kind?: AppointmentKind
  journeyId?: string
  clientId?: string
  professionalId?: string
  unitId?: string
  equipmentId?: string
  status?: AppointmentStatus
  dateFrom?: string
  dateTo?: string
  sortBy?: 'scheduledAt' | 'createdAt' | 'updatedAt'
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedAppointments {
  items: Appointment[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function fetchAppointments(
  query: FindAppointmentsQuery = {},
): Promise<PaginatedAppointments> {
  const res = await coreApi.get<PaginatedAppointments>('/appointments', {
    params: query,
  })
  return res.data
}

export async function fetchAppointmentById(id: string): Promise<Appointment> {
  const res = await coreApi.get<Appointment>(`/appointments/${id}`)
  return res.data
}

export async function createAppointment(
  input: CreateAppointmentInput,
): Promise<Appointment> {
  const res = await coreApi.post<Appointment>('/appointments', input)
  return res.data
}

export async function updateAppointment(
  id: string,
  input: UpdateAppointmentInput,
): Promise<Appointment> {
  const res = await coreApi.patch<Appointment>(`/appointments/${id}`, input)
  return res.data
}

export async function confirmAppointment(id: string): Promise<Appointment> {
  const res = await coreApi.post<Appointment>(`/appointments/${id}/confirm`)
  return res.data
}

export async function attendAppointment(id: string): Promise<Appointment> {
  const res = await coreApi.post<Appointment>(`/appointments/${id}/attend`)
  return res.data
}

export async function noShowAppointment(id: string): Promise<Appointment> {
  const res = await coreApi.post<Appointment>(`/appointments/${id}/no-show`)
  return res.data
}

export async function cancelAppointment(id: string): Promise<Appointment> {
  const res = await coreApi.post<Appointment>(`/appointments/${id}/cancel`)
  return res.data
}
