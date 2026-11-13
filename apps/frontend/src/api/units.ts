import { coreApi } from '@/api/client'

// Espelha unitResponseSchema do backend
// (apps/core/src/modules/units/UnitsTypes.ts).
export interface Unit {
  id: string
  tenantId: string
  name: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateUnitInput {
  name: string
}

export interface UpdateUnitInput {
  name?: string
}

export type UnitSortField = 'name' | 'createdAt' | 'updatedAt'

export interface FindUnitsQuery {
  page?: number
  pageSize?: number
  q?: string
  status?: 'active' | 'inactive' | 'all'
  sortBy?: UnitSortField
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedUnits {
  items: Unit[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function fetchUnits(
  query: FindUnitsQuery = {},
): Promise<PaginatedUnits> {
  const res = await coreApi.get<PaginatedUnits>('/units', { params: query })
  return res.data
}

export async function fetchUnitById(id: string): Promise<Unit> {
  const res = await coreApi.get<Unit>(`/units/${id}`)
  return res.data
}

export async function createUnit(input: CreateUnitInput): Promise<Unit> {
  const res = await coreApi.post<Unit>('/units', input)
  return res.data
}

export async function updateUnit(
  id: string,
  input: UpdateUnitInput,
): Promise<Unit> {
  const res = await coreApi.patch<Unit>(`/units/${id}`, input)
  return res.data
}

export async function deactivateUnit(id: string): Promise<Unit> {
  const res = await coreApi.post<Unit>(`/units/${id}/deactivate`)
  return res.data
}

export async function activateUnit(id: string): Promise<Unit> {
  const res = await coreApi.post<Unit>(`/units/${id}/activate`)
  return res.data
}

export async function deleteUnit(id: string): Promise<void> {
  await coreApi.delete(`/units/${id}`)
}
