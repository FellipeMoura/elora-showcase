import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

// Filtro global de período compartilhado entre dashboard e relatórios.
// Estado persiste na URL — bookmark/share funciona sem fricção.
//
// Forma: `?period=30d` (preset) ou `?period=custom&from=...&to=...`. Default
// '30d' quando ausente. Type espelha shared/period/period.ts no backend.

export type Period =
  | 'today'
  | '7d'
  | '30d'
  | '90d'
  | '6m'
  | '12m'
  | 'current_month'
  | 'previous_month'
  | 'custom'

export const PERIOD_OPTIONS: ReadonlyArray<{
  value: Period
  label: string
}> = [
  { value: 'today', label: 'Hoje' },
  { value: '7d', label: '7 dias' },
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '90 dias' },
  { value: '6m', label: '6 meses' },
  { value: '12m', label: '12 meses' },
  { value: 'current_month', label: 'Mês atual' },
  { value: 'previous_month', label: 'Mês anterior' },
  { value: 'custom', label: 'Personalizado' },
]

const VALID_PERIODS = new Set<Period>(PERIOD_OPTIONS.map((o) => o.value))

export interface PeriodFilterState {
  period: Period
  from?: string
  to?: string
  setPeriod: (next: Period, customRange?: { from: string; to: string }) => void
}

export function usePeriodFilter(): PeriodFilterState {
  const [searchParams, setSearchParams] = useSearchParams()

  const rawPeriod = searchParams.get('period') as Period | null
  const period: Period =
    rawPeriod && VALID_PERIODS.has(rawPeriod) ? rawPeriod : '30d'
  const from = searchParams.get('from') ?? undefined
  const to = searchParams.get('to') ?? undefined

  const setPeriod = useCallback(
    (next: Period, customRange?: { from: string; to: string }) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev)
          params.set('period', next)
          if (next === 'custom' && customRange) {
            params.set('from', customRange.from)
            params.set('to', customRange.to)
          } else {
            // Presets não carregam from/to — limpa pra não vazar range antigo.
            params.delete('from')
            params.delete('to')
          }
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

  return { period, from, to, setPeriod }
}
