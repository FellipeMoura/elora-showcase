import type { DashboardCards } from '@/api/dashboard'
import { cn } from '@/lib/utils'
import { KpiCard, KpiCardSkeleton } from './KpiCard'
import { dashboardSeriesColors } from './tokens'
import { useDashboardSummary } from './useDashboardSummary'
import { usePeriodFilter } from '@/hooks/usePeriodFilter'

const GRID_CLASS = 'grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-6'

// Breakdown compacto do card "Agendamentos hoje" (A3). Sem delta nem
// sparkline — é snapshot do dia. Mostra os status mais acionáveis pra recepção.
function TodayBreakdown({
  breakdown,
}: {
  breakdown: DashboardCards['todayAppointments']['breakdown']
}): React.ReactElement {
  const items: Array<{ label: string; value: number; color?: string }> = [
    { label: 'compareceu', value: breakdown.attended, color: 'text-success' },
    { label: 'agendados', value: breakdown.scheduled + breakdown.confirmed },
    { label: 'faltas', value: breakdown.noShow, color: 'text-destructive' },
  ]
  return (
    <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
      {items.map((it) => (
        <span key={it.label}>
          <span className={cn('font-medium', it.color ?? 'text-foreground')}>
            {it.value}
          </span>{' '}
          {it.label}
        </span>
      ))}
    </div>
  )
}

// Bloco A — faixa superior de 6 KPI cards. Responsivo: 2 colunas no mobile,
// 3 no sm, 6 no lg. O `key` por período força o remount dos cards pra o
// counter reanimar quando o filtro muda.
export function KpiCardsRow(): React.ReactElement {
  const { period } = usePeriodFilter()
  const { data, isLoading } = useDashboardSummary()

  if (!data) {
    return (
      <div className={GRID_CLASS} aria-busy={isLoading}>
        {Array.from({ length: 6 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  const c = data.cards

  return (
    <div className={GRID_CLASS}>
      <KpiCard
        key={`sales-${period}`}
        label="Vendas no período"
        value={c.salesAmount.value}
        format="money"
        deltaPct={c.salesAmount.deltaPct}
        sparkline={c.sparklines.salesAmount}
        seriesColor={dashboardSeriesColors.salesAmount}
        gradientId="spark-sales"
        secondary={
          <span className="text-xs text-muted-foreground">
            {c.salesAmount.count} venda{c.salesAmount.count === 1 ? '' : 's'}
          </span>
        }
      />
      <KpiCard
        key={`received-${period}`}
        label="Recebido (caixa)"
        value={c.receivedAmount.value}
        format="money"
        deltaPct={c.receivedAmount.deltaPct}
        sparkline={c.sparklines.receivedAmount}
        seriesColor={dashboardSeriesColors.salesCount}
        gradientId="spark-received"
      />
      <KpiCard
        key={`today-${period}`}
        label="Agendamentos hoje"
        value={c.todayAppointments.total}
        format="number"
        secondary={<TodayBreakdown breakdown={c.todayAppointments.breakdown} />}
      />
      <KpiCard
        key={`leads-${period}`}
        label="Leads novos"
        value={c.newLeads.count}
        format="number"
        deltaPct={c.newLeads.deltaPct}
        sparkline={c.sparklines.newLeads}
        seriesColor={dashboardSeriesColors.leads}
        gradientId="spark-leads"
      />
      <KpiCard
        key={`conv-${period}`}
        label="Conversão lead→venda"
        value={c.leadToSaleRate.value}
        format="percent"
        deltaPct={c.leadToSaleRate.deltaPct}
      />
      <KpiCard
        key={`ticket-${period}`}
        label="Ticket médio"
        value={c.averageTicket.value}
        format="money"
        deltaPct={c.averageTicket.deltaPct}
        sparkline={c.sparklines.averageTicket}
        seriesColor={dashboardSeriesColors.salesAmount}
        gradientId="spark-ticket"
      />
    </div>
  )
}
