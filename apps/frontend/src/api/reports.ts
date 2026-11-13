import { coreApi } from '@/api/client'

// Espelha shape de Report do backend (apps/core/src/modules/reports/ReportsTypes.ts).
// Catálogo é GLOBAL; o que o user vê é filtrado por report_tenants +
// report_groups no backend (mesma matriz dos menus).
export interface Report {
  id: string
  slug: string
  name: string
  description: string | null
  category: string
  active: boolean
  createdAt: string
  updatedAt: string
}

// Resposta padrão do POST /reports/:slug/run. `data` varia por slug —
// renderers dedicados em pages/reports/renderers/ conhecem o shape exato.
export interface RunReportResponse<TData = unknown> {
  meta: {
    generatedAt: string
    tenantId: string
    userId: string
    slug: string
  }
  data: TData
}

interface ItemsResponse<T> {
  items: T[]
}

// Lista de relatórios visíveis ao user autenticado no tenant atual.
export async function fetchVisibleReports(): Promise<Report[]> {
  const res = await coreApi.get<ItemsResponse<Report>>('/reports')
  return res.data.items
}

// Metadata do relatório. Backend retorna 404 se o user não enxerga.
export async function fetchReportBySlug(slug: string): Promise<Report> {
  const res = await coreApi.get<Report>(`/reports/${slug}`)
  return res.data
}

// Executa o relatório. `params` shape varia por slug — backend valida via
// `paramsSchema` do handler (Zod). Retorna `{ meta, data }`.
export async function runReport<TData = unknown>(
  slug: string,
  params: Record<string, unknown>,
): Promise<RunReportResponse<TData>> {
  const res = await coreApi.post<RunReportResponse<TData>>(
    `/reports/${slug}/run`,
    params,
  )
  return res.data
}
