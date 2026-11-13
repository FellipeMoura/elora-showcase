import { coreApi } from '@/api/client'

// Espelha UserWithGroups do backend. Mesma forma de PublicUser + groupIds
// embedded — endpoint /users retorna sempre com groupIds populados (uma
// query agregada no service, sem N+1).
export interface UserPreferences {
  chatNotificationLevel?: 'quiet' | 'medium' | 'aggressive'
}

export interface User {
  id: string
  tenantId: string
  username: string
  // Opcional agora — usado só como contato/recuperação. Null quando o user
  // não cadastrou endereço.
  email: string | null
  name: string
  active: boolean
  // Capacidades profissionais. Filtragem do dropdown de profissional em
  // agendamentos depende dessas flags + appointment.kind.
  canEvaluate: boolean
  canApplyProcedures: boolean
  preferences: UserPreferences
  groupIds: string[]
  createdAt: string
  updatedAt: string
}

export interface CreateUserInput {
  username: string
  email?: string | null
  name: string
  password: string
  canEvaluate?: boolean
  canApplyProcedures?: boolean
}

export interface UpdateUserInput {
  username?: string
  // `null` remove o email; string atualiza.
  email?: string | null
  name?: string
  password?: string
  canEvaluate?: boolean
  canApplyProcedures?: boolean
}

export interface FindUsersQuery {
  page?: number
  pageSize?: number
  q?: string
  status?: 'active' | 'inactive' | 'all'
}

export interface PaginatedUsers {
  items: User[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function fetchUsers(
  query: FindUsersQuery = {},
): Promise<PaginatedUsers> {
  const res = await coreApi.get<PaginatedUsers>('/users', { params: query })
  return res.data
}

export async function createUser(input: CreateUserInput): Promise<User> {
  const res = await coreApi.post<User>('/users', input)
  return res.data
}

export async function updateUser(
  id: string,
  input: UpdateUserInput,
): Promise<User> {
  const res = await coreApi.patch<User>(`/users/${id}`, input)
  return res.data
}

export async function deleteUser(id: string): Promise<void> {
  await coreApi.delete(`/users/${id}`)
}

export async function activateUser(id: string): Promise<User> {
  const res = await coreApi.post<User>(`/users/${id}/activate`)
  return res.data
}

export async function deactivateUser(id: string): Promise<User> {
  const res = await coreApi.post<User>(`/users/${id}/deactivate`)
  return res.data
}

// Set idempotente — backend faz diff entre lista atual e desejada.
export async function setUserGroups(
  id: string,
  groupIds: string[],
): Promise<User> {
  const res = await coreApi.put<User>(`/users/${id}/groups`, { groupIds })
  return res.data
}
