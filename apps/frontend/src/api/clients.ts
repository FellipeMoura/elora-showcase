import { coreApi } from '@/api/client'
import type { JourneyStage } from '@/api/journeys'

// Espelho do ClientAddress armazenado em jsonb no backend
// (packages/db/src/schema.ts → ClientAddress). Todos campos opcionais.
// CEP em dígitos apenas (sem máscara), UF em 2 letras maiúsculas.
export interface ClientAddress {
  zipCode?: string
  street?: string
  number?: string
  complement?: string
  neighborhood?: string
  city?: string
  state?: string
  country?: string
}

// Espelha o shape de Client do backend
// (apps/core/src/modules/clients/ClientsTypes.ts → clientResponseSchema).
// Datas vêm como ISO strings na rede; birth_date como `YYYY-MM-DD`.
export interface Client {
  id: string
  tenantId: string
  name: string
  phoneE164: string
  email: string | null
  birthDate: string | null
  // CPF armazenado em dígitos apenas. UI formata na apresentação.
  document: string | null
  address: ClientAddress | null
  notes: string | null
  isVip: boolean
  active: boolean
  createdAt: string
  updatedAt: string
  // Contact ativo do cliente (1 por cliente por regra). Null quando o
  // cliente não tem WhatsApp cadastrado.
  whatsappContactId: string | null
  // Canal WhatsApp do contact ativo. Frontend usa pra criar conversation
  // lazy (POST /conversations) quando o contact existe mas ainda não há
  // conversa registrada.
  whatsappChannelId: string | null
  // Conversa mais recente do cliente — alimenta o ícone "abrir chat"
  // na lista. Null quando contact existe mas ainda não houve mensagem.
  conversationId: string | null
  // Stage da journey ativa do cliente. Null quando o cliente não tem
  // journey ativa (cadastro novo sem lead ou todas fechadas).
  currentJourneyStage: JourneyStage | null
}

export interface CreateClientInput {
  name: string
  phoneE164: string
  email?: string | null
  birthDate?: string | null
  document?: string | null
  address?: ClientAddress | null
  notes?: string | null
  isVip?: boolean
}

export interface UpdateClientInput {
  name?: string
  phoneE164?: string
  email?: string | null
  birthDate?: string | null
  document?: string | null
  address?: ClientAddress | null
  notes?: string | null
  isVip?: boolean
}

// Campos sortáveis — espelha `clientsSortSpec` no backend
// (apps/core/src/modules/clients/ClientsTypes.ts). Manter sincronizado:
// se um campo é adicionado/removido no spec do backend, atualizar aqui.
export type ClientSortField =
  | 'name'
  | 'phoneE164'
  | 'email'
  | 'birthDate'
  | 'createdAt'
  | 'updatedAt'

export interface FindClientsQuery {
  page?: number
  pageSize?: number
  q?: string
  status?: 'active' | 'inactive' | 'all'
  isVip?: boolean
  sortBy?: ClientSortField
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedClients {
  items: Client[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function fetchClients(
  query: FindClientsQuery = {},
): Promise<PaginatedClients> {
  const res = await coreApi.get<PaginatedClients>('/clients', { params: query })
  return res.data
}

export async function fetchClientById(id: string): Promise<Client> {
  const res = await coreApi.get<Client>(`/clients/${id}`)
  return res.data
}

export async function createClient(input: CreateClientInput): Promise<Client> {
  const res = await coreApi.post<Client>('/clients', input)
  return res.data
}

export async function updateClient(
  id: string,
  input: UpdateClientInput,
): Promise<Client> {
  const res = await coreApi.patch<Client>(`/clients/${id}`, input)
  return res.data
}

export async function deactivateClient(id: string): Promise<Client> {
  const res = await coreApi.post<Client>(`/clients/${id}/deactivate`)
  return res.data
}

export async function activateClient(id: string): Promise<Client> {
  const res = await coreApi.post<Client>(`/clients/${id}/activate`)
  return res.data
}

export async function deleteClient(id: string): Promise<void> {
  await coreApi.delete(`/clients/${id}`)
}

// Lookup pelo telefone — usado no cadastro pra feedback em tempo real.
// Não 404 quando ausente: backend devolve `{ exists: false, client: null }`.
export interface CheckClientByPhoneResponse {
  exists: boolean
  client: { id: string; name: string; active: boolean } | null
}

export async function checkClientByPhone(
  phoneE164: string,
): Promise<CheckClientByPhoneResponse> {
  const res = await coreApi.get<CheckClientByPhoneResponse>('/clients/check', {
    params: { phoneE164 },
  })
  return res.data
}
