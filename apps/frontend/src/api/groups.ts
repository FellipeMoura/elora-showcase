import { coreApi } from '@/api/client'

// Espelha Group do backend. Grupos são GLOBAIS (1:1 com role_code) —
// gerenciados pela equipe Elora. Tenants leem pra membership e UI.
export type RoleCode =
  | 'admin'
  | 'manager'
  | 'professional'
  | 'reception'
  | 'viewer'

export interface Group {
  id: string
  name: string
  description: string | null
  roleCode: RoleCode
  active: boolean
  createdAt: string
  updatedAt: string
}

interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// Catálogo só tem 5 grupos hoje (1:1 com role_code) — pageSize=100 garante
// pegar tudo numa request, sem precisar paginar na UI.
export async function fetchGroups(): Promise<Group[]> {
  const res = await coreApi.get<PaginatedResponse<Group>>('/groups', {
    params: { pageSize: 100, status: 'active' },
  })
  return res.data.items
}
