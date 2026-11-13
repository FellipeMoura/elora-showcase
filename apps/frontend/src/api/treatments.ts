import { coreApi } from '@/api/client'
import type { ProcedureSession } from '@/api/procedureSessions'

// Espelha apps/core/src/modules/treatments/TreatmentsTypes.ts.
// Treatment é o "pacote clínico" do cliente: nasce na 1ª presença assinada
// (ensureTreatmentForJourney) e agrupa as procedure_sessions pendentes do
// cliente na journey. Status indica curso/fechamento.

export const TREATMENT_STATUSES = [
  'active',
  'completed',
  'abandoned',
  'manually_closed',
] as const
export type TreatmentStatus = (typeof TREATMENT_STATUSES)[number]

export interface Treatment {
  id: string
  tenantId: string
  journeyId: string
  clientId: string
  name: string
  status: TreatmentStatus
  startedAt: string | null
  completedAt: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

// Resposta da listagem `/treatments` — extende Treatment com dados
// denormalizados pra economizar N+1 no frontend (clientName, contagens
// de sessões). Detalhe (`/treatments/:id`) continua devolvendo Treatment
// puro + sessions embedded.
export interface TreatmentListItem extends Treatment {
  clientName: string
  sessionsTotal: number
  sessionsDone: number
  sessionsPending: number
}

export interface TreatmentWithSessions {
  treatment: Treatment
  sessions: ProcedureSession[]
}

export type TreatmentSortField =
  | 'createdAt'
  | 'updatedAt'
  | 'startedAt'
  | 'completedAt'

export interface FindTreatmentsQuery {
  page?: number
  pageSize?: number
  journeyId?: string
  clientId?: string
  status?: TreatmentStatus
  sortBy?: TreatmentSortField
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedTreatments {
  items: TreatmentListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface UpdateTreatmentInput {
  name?: string
  notes?: string | null
}

export interface CloseTreatmentManuallyInput {
  reason?: string | null
}

export async function fetchTreatments(
  query: FindTreatmentsQuery = {},
): Promise<PaginatedTreatments> {
  const res = await coreApi.get<PaginatedTreatments>('/treatments', {
    params: query,
  })
  return res.data
}

export async function fetchTreatmentById(
  id: string,
): Promise<TreatmentWithSessions> {
  const res = await coreApi.get<TreatmentWithSessions>(`/treatments/${id}`)
  return res.data
}

export async function updateTreatment(
  id: string,
  input: UpdateTreatmentInput,
): Promise<Treatment> {
  const res = await coreApi.patch<Treatment>(`/treatments/${id}`, input)
  return res.data
}

export async function closeTreatmentManually(
  id: string,
  input: CloseTreatmentManuallyInput = {},
): Promise<Treatment> {
  const res = await coreApi.post<Treatment>(
    `/treatments/${id}/close-manually`,
    input,
  )
  return res.data
}

export async function reopenTreatment(id: string): Promise<Treatment> {
  const res = await coreApi.post<Treatment>(`/treatments/${id}/reopen`)
  return res.data
}
