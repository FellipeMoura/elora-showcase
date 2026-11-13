import { PeriodFilter } from '@/components/data/PeriodFilter'
import { usePeriodFilter } from '@/hooks/usePeriodFilter'

// Header do dashboard — só hospeda o `PeriodFilter` no canto direito.
// Lógica de estado vive em `usePeriodFilter` (URL como source of truth);
// UI vive no componente reusável `<PeriodFilter>` em components/data/.
export function DashboardHeader(): React.ReactElement {
  const { period, from, to, setPeriod } = usePeriodFilter()

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <PeriodFilter
        period={period}
        from={from}
        to={to}
        onChange={setPeriod}
      />
    </div>
  )
}
