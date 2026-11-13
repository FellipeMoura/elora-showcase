import { useMutation, useQuery } from '@tanstack/react-query'
import {
  fetchReportBySlug,
  fetchVisibleReports,
  runReport,
  type Report,
  type RunReportResponse,
} from '@/api/reports'

// Chave raiz das queries do recurso. Execução do relatório é mutation,
// não query — refetch automático não faz sentido (user aperta "Executar"
// explicitamente).
export const REPORTS_QUERY_KEY = ['reports'] as const

export function visibleReportsKey() {
  return [...REPORTS_QUERY_KEY, 'visible'] as const
}

export function reportDetailKey(slug: string) {
  return [...REPORTS_QUERY_KEY, 'detail', slug] as const
}

export function useVisibleReports() {
  return useQuery<Report[], Error>({
    queryKey: visibleReportsKey(),
    queryFn: fetchVisibleReports,
    staleTime: 60 * 1000,
  })
}

export function useReportDetail(slug: string | undefined) {
  return useQuery<Report, Error>({
    queryKey: reportDetailKey(slug ?? ''),
    queryFn: () => fetchReportBySlug(slug as string),
    enabled: Boolean(slug),
    staleTime: 60 * 1000,
  })
}

// Execução é mutation — user dispara explicitamente. Sem invalidação
// automática porque o resultado não fica em cache (cada run pode ter
// params diferentes).
export function useRunReport<TData = unknown>() {
  return useMutation<
    RunReportResponse<TData>,
    Error,
    { slug: string; params: Record<string, unknown> }
  >({
    mutationFn: ({ slug, params }) => runReport<TData>(slug, params),
  })
}
