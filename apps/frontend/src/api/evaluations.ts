import { coreApi } from '@/api/client'
import type { AppointmentStatus } from '@/api/appointments'

// Espelha apps/core/src/modules/evaluations/EvaluationsTypes.ts.
// Avaliação é entidade clínica (separada do slot da agenda). Cada
// evaluation é o "guarda-chuva" sob o qual fichas (client_forms) vivem.

export type EvaluationStatus = 'pending' | 'performed' | 'cancelled'
export type EvaluationKind = 'initial' | 'reevaluation' | 'return'

export interface Evaluation {
  id: string
  tenantId: string
  journeyId: string
  clientId: string
  kind: EvaluationKind
  status: EvaluationStatus
  performedAt: string | null
  performedByUserId: string | null
  generalNotes: string | null
  createdAt: string
  updatedAt: string
}

// Item da listagem GET /evaluations — vem com client + appointment associado
// (latest não-cancelado) embutidos. Backend já faz a mesclagem que o
// EvaluationsSection do ClientDetail faz no frontend, evitando N+1.
export interface EvaluationListItem extends Evaluation {
  clientName: string
  clientPhoneE164: string
  appointmentId: string | null
  appointmentStatus: AppointmentStatus | null
  appointmentScheduledAt: string | null
}

export type EvaluationSortField = 'createdAt' | 'updatedAt' | 'performedAt'

export interface FindEvaluationsQuery {
  page?: number
  pageSize?: number
  journeyId?: string
  clientId?: string
  status?: EvaluationStatus
  kind?: EvaluationKind
  // Busca textual em client.name + client.phoneE164.
  q?: string
  sortBy?: EvaluationSortField
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedEvaluations {
  items: EvaluationListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface CreateEvaluationInput {
  journeyId: string
  kind?: EvaluationKind
  generalNotes?: string | null
}

export interface UpdateEvaluationInput {
  kind?: EvaluationKind
  generalNotes?: string | null
}

export async function fetchEvaluations(
  query: FindEvaluationsQuery = {},
): Promise<PaginatedEvaluations> {
  const res = await coreApi.get<PaginatedEvaluations>('/evaluations', {
    params: query,
  })
  return res.data
}

export async function createEvaluation(
  input: CreateEvaluationInput,
): Promise<Evaluation> {
  const res = await coreApi.post<Evaluation>('/evaluations', input)
  return res.data
}

export async function fetchEvaluationById(id: string): Promise<Evaluation> {
  const res = await coreApi.get<Evaluation>(`/evaluations/${id}`)
  return res.data
}

export async function updateEvaluation(
  id: string,
  input: UpdateEvaluationInput,
): Promise<Evaluation> {
  const res = await coreApi.patch<Evaluation>(`/evaluations/${id}`, input)
  return res.data
}

export async function cancelEvaluation(id: string): Promise<Evaluation> {
  const res = await coreApi.post<Evaluation>(`/evaluations/${id}/cancel`)
  return res.data
}

export const EVALUATION_KIND_LABELS: Record<EvaluationKind, string> = {
  initial: 'Inicial',
  reevaluation: 'Reavaliação',
  return: 'Retorno',
}

export const EVALUATION_STATUS_LABELS: Record<EvaluationStatus, string> = {
  pending: 'Pendente',
  performed: 'Realizada',
  cancelled: 'Cancelada',
}

export const EVALUATION_STATUS_BADGE_CLASS: Record<EvaluationStatus, string> = {
  pending: 'bg-muted text-muted-foreground',
  performed: 'bg-success/15 text-success',
  cancelled: 'bg-error/15 text-error',
}
