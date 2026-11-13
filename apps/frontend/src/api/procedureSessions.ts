import { coreApi } from '@/api/client'

// Espelha apps/core/src/modules/procedureSessions/ProcedureSessionsTypes.ts.
// Sessions são criadas eagerly em quotes.closeSale; UI lista + edita notes.

export const PROCEDURE_SESSION_STATUSES = [
  'pending',
  'signed',
  'done',
  'cancelled',
] as const
export type ProcedureSessionStatus = (typeof PROCEDURE_SESSION_STATUSES)[number]

export interface ProcedureSession {
  id: string
  tenantId: string
  clientId: string
  procedureId: string
  status: ProcedureSessionStatus
  executedAt: string | null
  executedByUserId: string | null
  evolutionNotes: string | null
  createdAt: string
  updatedAt: string
}

export interface FindProcedureSessionsQuery {
  page?: number
  pageSize?: number
  clientId?: string
  procedureId?: string
  treatmentId?: string
  status?: ProcedureSessionStatus
  sortBy?: 'createdAt' | 'updatedAt' | 'executedAt'
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedProcedureSessions {
  items: ProcedureSession[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface UpdateProcedureSessionInput {
  evolutionNotes?: string | null
}

// Body do POST /procedure-sessions/:id/evolve. Nota obrigatória — sessão
// sem nota só vai pra done via override admin (`/done`).
export interface EvolveProcedureSessionInput {
  evolutionNotes: string
}

export async function fetchProcedureSessions(
  query: FindProcedureSessionsQuery = {},
): Promise<PaginatedProcedureSessions> {
  const res = await coreApi.get<PaginatedProcedureSessions>(
    '/procedure-sessions',
    { params: query },
  )
  return res.data
}

export async function fetchProcedureSessionById(
  id: string,
): Promise<ProcedureSession> {
  const res = await coreApi.get<ProcedureSession>(`/procedure-sessions/${id}`)
  return res.data
}

export async function updateProcedureSessionNotes(
  id: string,
  input: UpdateProcedureSessionInput,
): Promise<ProcedureSession> {
  const res = await coreApi.patch<ProcedureSession>(
    `/procedure-sessions/${id}`,
    input,
  )
  return res.data
}

export async function cancelProcedureSession(id: string): Promise<ProcedureSession> {
  const res = await coreApi.post<ProcedureSession>(
    `/procedure-sessions/${id}/cancel`,
  )
  return res.data
}

export async function markProcedureSessionDoneManual(
  id: string,
): Promise<ProcedureSession> {
  const res = await coreApi.post<ProcedureSession>(
    `/procedure-sessions/${id}/done`,
  )
  return res.data
}

export async function evolveProcedureSession(
  id: string,
  input: EvolveProcedureSessionInput,
): Promise<ProcedureSession> {
  const res = await coreApi.post<ProcedureSession>(
    `/procedure-sessions/${id}/evolve`,
    input,
  )
  return res.data
}
