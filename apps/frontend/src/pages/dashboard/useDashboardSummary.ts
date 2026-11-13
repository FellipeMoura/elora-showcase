import { useQuery } from '@tanstack/react-query'
import { fetchDashboardSummary, type DashboardSummary } from '@/api/dashboard'
import { usePeriodFilter } from '@/hooks/usePeriodFilter'

export const DASHBOARD_QUERY_KEY = ['dashboard'] as const

export function dashboardSummaryKey(
  period: string,
  from?: string,
  to?: string,
) {
  return [...DASHBOARD_QUERY_KEY, 'summary', period, from, to] as const
}

// Lê o filtro de período da URL e busca o resumo. staleTime de 1min — o
// dashboard não precisa ser tempo real. `placeholderData` mantém o frame
// anterior visível enquanto o novo período carrega (sem flash de layout).
export function useDashboardSummary() {
  const { period, from, to } = usePeriodFilter()

  // Para custom sem range completo ainda, não dispara (evita 400 do backend).
  const enabled = period !== 'custom' || Boolean(from && to)

  return useQuery<DashboardSummary, Error>({
    queryKey: dashboardSummaryKey(period, from, to),
    queryFn: () => fetchDashboardSummary({ period, from, to }),
    enabled,
    placeholderData: (prev) => prev,
    staleTime: 60_000,
  })
}
