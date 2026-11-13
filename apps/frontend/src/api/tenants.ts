import { coreApi } from '@/api/client'

// Espelha o shape do backend
// (apps/core/src/modules/tenants/TenantsTypes.ts → tenantResponseSchema).
// Endpoints platform-only — gateados por requirePlatformAccess no backend.
//
// `name` é o rótulo curto (sidebar/header). `legalName` (razão social) e
// `tradeName` (nome fantasia) alimentam cabeçalho de contratos/recibos.
// `document` armazena CNPJ em dígitos apenas. `logoUrl` guarda o objectKey
// do MinIO — NÃO é URL renderizável; use fetchTenantLogoUrl pra receber
// presigned URL.
//
// Espelho de `BusinessHours` em @elora/db. Mantido inline pra evitar
// importar o pacote @elora/db no bundle do frontend.
export interface BusinessHours {
  timezone: string
  schedule: Array<{
    dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6
    open: string
    close: string
  }>
}

export interface Tenant {
  id: string
  slug: string
  name: string
  legalName: string | null
  tradeName: string | null
  document: string | null
  representativeName: string | null
  logoUrl: string | null
  skipEvaluation: boolean
  agentEnabled: boolean
  agentIdleMinutes: number
  agentPersona: string | null
  businessHours: BusinessHours | null
  createdAt: string
  updatedAt: string
}

// Resumo retornado por GET /tenants — não traz skipEvaluation/timestamps.
// Endpoint /tenants é restrito a super-admin (tenant `platform`).
export interface TenantSummary {
  id: string
  slug: string
  name: string
}

export interface CreateTenantInput {
  slug: string
  name: string
  legalName?: string | null
  tradeName?: string | null
  document?: string | null
  representativeName?: string | null
  logoUrl?: string | null
  skipEvaluation?: boolean
  agentEnabled?: boolean
  agentIdleMinutes?: number
  agentPersona?: string | null
  businessHours?: BusinessHours | null
}

// Slug é imutável no update — está embutido no subdomínio e nos JWTs ativos.
export interface UpdateTenantInput {
  name?: string
  legalName?: string | null
  tradeName?: string | null
  document?: string | null
  representativeName?: string | null
  logoUrl?: string | null
  skipEvaluation?: boolean
  agentEnabled?: boolean
  agentIdleMinutes?: number
  agentPersona?: string | null
  businessHours?: BusinessHours | null
}

interface ItemsResponse<T> {
  items: T[]
}

export async function fetchTenants(): Promise<TenantSummary[]> {
  const res = await coreApi.get<ItemsResponse<TenantSummary>>('/tenants')
  return res.data.items
}

export async function fetchTenantById(id: string): Promise<Tenant> {
  const res = await coreApi.get<Tenant>(`/tenants/${id}`)
  return res.data
}

export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const res = await coreApi.post<Tenant>('/tenants', input)
  return res.data
}

export async function updateTenant(
  id: string,
  input: UpdateTenantInput,
): Promise<Tenant> {
  const res = await coreApi.patch<Tenant>(`/tenants/${id}`, input)
  return res.data
}

// ---------------------------------------------------------------------
// Logo — upload multipart, delete, presigned URL. Mesmo padrão do
// upload de mídia do chat (api/messages.ts).
// ---------------------------------------------------------------------

export interface UploadLogoResponse {
  objectKey: string
  size: number
  mimeType: string
}

export interface LogoUrlResponse {
  url: string | null
  expiresInSec: number
}

export async function uploadTenantLogo(
  id: string,
  file: File,
): Promise<UploadLogoResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await coreApi.post<UploadLogoResponse>(
    `/tenants/${id}/logo`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  )
  return res.data
}

export async function deleteTenantLogo(id: string): Promise<Tenant> {
  const res = await coreApi.delete<Tenant>(`/tenants/${id}/logo`)
  return res.data
}

export async function fetchTenantLogoUrl(id: string): Promise<LogoUrlResponse> {
  const res = await coreApi.get<LogoUrlResponse>(`/tenants/${id}/logo-url`)
  return res.data
}
