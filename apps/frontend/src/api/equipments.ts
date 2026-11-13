import { coreApi } from '@/api/client'

// Espelha equipmentResponseSchema do backend
// (apps/core/src/modules/equipments/EquipmentsTypes.ts).
export interface Equipment {
  id: string
  tenantId: string
  name: string
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateEquipmentInput {
  name: string
}

export interface UpdateEquipmentInput {
  name?: string
}

export type EquipmentSortField = 'name' | 'createdAt' | 'updatedAt'

export interface FindEquipmentsQuery {
  page?: number
  pageSize?: number
  q?: string
  status?: 'active' | 'inactive' | 'all'
  sortBy?: EquipmentSortField
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedEquipments {
  items: Equipment[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function fetchEquipments(
  query: FindEquipmentsQuery = {},
): Promise<PaginatedEquipments> {
  const res = await coreApi.get<PaginatedEquipments>('/equipments', {
    params: query,
  })
  return res.data
}

export async function fetchEquipmentById(id: string): Promise<Equipment> {
  const res = await coreApi.get<Equipment>(`/equipments/${id}`)
  return res.data
}

export async function createEquipment(
  input: CreateEquipmentInput,
): Promise<Equipment> {
  const res = await coreApi.post<Equipment>('/equipments', input)
  return res.data
}

export async function updateEquipment(
  id: string,
  input: UpdateEquipmentInput,
): Promise<Equipment> {
  const res = await coreApi.patch<Equipment>(`/equipments/${id}`, input)
  return res.data
}

export async function deactivateEquipment(id: string): Promise<Equipment> {
  const res = await coreApi.post<Equipment>(`/equipments/${id}/deactivate`)
  return res.data
}

export async function activateEquipment(id: string): Promise<Equipment> {
  const res = await coreApi.post<Equipment>(`/equipments/${id}/activate`)
  return res.data
}

export async function deleteEquipment(id: string): Promise<void> {
  await coreApi.delete(`/equipments/${id}`)
}
