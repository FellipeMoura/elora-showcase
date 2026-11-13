import { coreApi } from '@/api/client'

// Espelha procedureResponseSchema do backend
// (apps/core/src/modules/procedures/ProceduresTypes.ts).
// defaultPrice vem como string (Drizzle decimal) — formato "1234.56".
export interface Procedure {
  id: string
  tenantId: string
  name: string
  description: string | null
  defaultSessions: number
  defaultPrice: string | null
  color: string | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateProcedureInput {
  name: string
  description?: string | null
  defaultSessions: number
  defaultPrice?: number | null
  color?: string | null
}

export interface UpdateProcedureInput {
  name?: string
  description?: string | null
  defaultSessions?: number
  defaultPrice?: number | null
  color?: string | null
}

// Espelha proceduresSortSpec do backend.
export type ProcedureSortField =
  | 'name'
  | 'defaultSessions'
  | 'defaultPrice'
  | 'createdAt'
  | 'updatedAt'

export interface FindProceduresQuery {
  page?: number
  pageSize?: number
  q?: string
  status?: 'active' | 'inactive' | 'all'
  sortBy?: ProcedureSortField
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedProcedures {
  items: Procedure[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function fetchProcedures(
  query: FindProceduresQuery = {},
): Promise<PaginatedProcedures> {
  const res = await coreApi.get<PaginatedProcedures>('/procedures', {
    params: query,
  })
  return res.data
}

export async function fetchProcedureById(id: string): Promise<Procedure> {
  const res = await coreApi.get<Procedure>(`/procedures/${id}`)
  return res.data
}

export async function createProcedure(
  input: CreateProcedureInput,
): Promise<Procedure> {
  const res = await coreApi.post<Procedure>('/procedures', input)
  return res.data
}

export async function updateProcedure(
  id: string,
  input: UpdateProcedureInput,
): Promise<Procedure> {
  const res = await coreApi.patch<Procedure>(`/procedures/${id}`, input)
  return res.data
}

export async function deactivateProcedure(id: string): Promise<Procedure> {
  const res = await coreApi.post<Procedure>(`/procedures/${id}/deactivate`)
  return res.data
}

export async function activateProcedure(id: string): Promise<Procedure> {
  const res = await coreApi.post<Procedure>(`/procedures/${id}/activate`)
  return res.data
}

export async function deleteProcedure(id: string): Promise<void> {
  await coreApi.delete(`/procedures/${id}`)
}
