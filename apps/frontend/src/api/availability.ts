import { coreApi } from '@/api/client'

// =====================================================================
// Espelha o backend (apps/core/src/modules/availability/AvailabilityTypes.ts).
// Modelo: regras semanais (professionalSchedule) + exceções pontuais
// (scheduleException) + cálculo on-the-fly de slots livres (computeFreeSlots).
// =====================================================================

export const WEEKDAYS = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const
export type Weekday = (typeof WEEKDAYS)[number]

export const SCHEDULE_EXCEPTION_KINDS = [
  'vacation',
  'sick',
  'training',
  'holiday',
  'other',
] as const
export type ScheduleExceptionKind = (typeof SCHEDULE_EXCEPTION_KINDS)[number]

export interface ProfessionalSchedule {
  id: string
  tenantId: string
  userId: string
  dayOfWeek: Weekday
  startTime: string // 'HH:MM:SS' do Postgres TIME
  endTime: string
  effectiveFrom: string // YYYY-MM-DD
  effectiveTo: string | null
  createdAt: string
  updatedAt: string
}

export interface ScheduleException {
  id: string
  tenantId: string
  userId: string
  startAt: string
  endAt: string
  kind: ScheduleExceptionKind
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface FreeSlot {
  startAt: string
  endAt: string
}

export interface CreateScheduleInput {
  userId: string
  dayOfWeek: Weekday
  startTime: string
  endTime: string
  effectiveFrom?: string
  effectiveTo?: string | null
}

export interface UpdateScheduleInput {
  startTime?: string
  endTime?: string
  effectiveFrom?: string
  effectiveTo?: string | null
}

export interface CreateExceptionInput {
  userId: string
  startAt: string
  endAt: string
  kind?: ScheduleExceptionKind
  notes?: string | null
}

export interface UpdateExceptionInput {
  startAt?: string
  endAt?: string
  kind?: ScheduleExceptionKind
  notes?: string | null
}

export interface FindSchedulesQuery {
  userId?: string
  dayOfWeek?: Weekday
}

export interface FindExceptionsQuery {
  userId?: string
  from?: string
  to?: string
}

export interface FreeSlotsQuery {
  userId: string
  date: string // YYYY-MM-DD
  durationMinutes: number
}

// =====================================================================
// Schedules
// =====================================================================

export async function fetchSchedules(
  query: FindSchedulesQuery = {},
): Promise<ProfessionalSchedule[]> {
  const res = await coreApi.get<{ items: ProfessionalSchedule[] }>(
    '/availability/schedules',
    { params: query },
  )
  return res.data.items
}

export async function createSchedule(
  input: CreateScheduleInput,
): Promise<ProfessionalSchedule> {
  const res = await coreApi.post<ProfessionalSchedule>(
    '/availability/schedules',
    input,
  )
  return res.data
}

export async function updateSchedule(
  id: string,
  input: UpdateScheduleInput,
): Promise<ProfessionalSchedule> {
  const res = await coreApi.patch<ProfessionalSchedule>(
    `/availability/schedules/${id}`,
    input,
  )
  return res.data
}

export async function deleteSchedule(id: string): Promise<void> {
  await coreApi.delete(`/availability/schedules/${id}`)
}

// =====================================================================
// Exceptions
// =====================================================================

export async function fetchExceptions(
  query: FindExceptionsQuery = {},
): Promise<ScheduleException[]> {
  const res = await coreApi.get<{ items: ScheduleException[] }>(
    '/availability/exceptions',
    { params: query },
  )
  return res.data.items
}

export async function createException(
  input: CreateExceptionInput,
): Promise<ScheduleException> {
  const res = await coreApi.post<ScheduleException>(
    '/availability/exceptions',
    input,
  )
  return res.data
}

export async function updateException(
  id: string,
  input: UpdateExceptionInput,
): Promise<ScheduleException> {
  const res = await coreApi.patch<ScheduleException>(
    `/availability/exceptions/${id}`,
    input,
  )
  return res.data
}

export async function deleteException(id: string): Promise<void> {
  await coreApi.delete(`/availability/exceptions/${id}`)
}

// =====================================================================
// Free slots (usado pelo calendário/agenda — fora desta página)
// =====================================================================

export async function fetchFreeSlots(query: FreeSlotsQuery): Promise<FreeSlot[]> {
  const res = await coreApi.get<{ items: FreeSlot[] }>(
    '/availability/free-slots',
    { params: query },
  )
  return res.data.items
}
