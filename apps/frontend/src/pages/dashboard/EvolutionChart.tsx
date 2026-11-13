import { ResponsiveLine } from '@nivo/line'
import type { DashboardEvolution } from '@/api/dashboard'
import { cn } from '@/lib/utils'
import { displayMoney } from '@/lib/format'
import { dashboardSeriesColors, glassSurface, gradientDef, nivoTheme } from './tokens'
import { normalizeToIndex100 } from './normalize'
import { useDashboardSummary } from './useDashboardSummary'

const SERIES = [
  { id: 'Leads', key: 'leadsCount', color: dashboardSeriesColors.leads, gradId: 'evo-leads', money: false },
  { id: 'Vendas (qtd)', key: 'salesCount', color: dashboardSeriesColors.salesCount, gradId: 'evo-sales-count', money: false },
  { id: 'Vendas (R$)', key: 'salesAmount', color: dashboardSeriesColors.salesAmount, gradId: 'evo-sales-amount', money: true },
] as const

const intFmt = new Intl.NumberFormat('pt-BR')

// Card wrapper compartilhado (mesma moldura glass dos KPI cards).
function Shell({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className={cn('p-4', glassSurface)}>{children}</div>
}

function Legend(): React.ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {SERIES.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: s.color }}
          />
          {s.id}
        </span>
      ))}
    </div>
  )
}

function DerivedKpis({
  derived,
}: {
  derived: DashboardEvolution['derived']
}): React.ReactElement {
  const items = [
    { label: 'Ticket médio', value: displayMoney(derived.averageTicket) },
    {
      label: 'Conversão lead→venda',
      value: `${derived.leadToSaleRate.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
    },
    {
      label: 'Ciclo lead→venda',
      value:
        derived.leadToSaleCycleDays == null
          ? '—'
          : `${derived.leadToSaleCycleDays.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`,
    },
  ]
  return (
    <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-border/40 pt-3">
      {items.map((it) => (
        <div key={it.label}>
          <p className="truncate text-xs text-muted-foreground">{it.label}</p>
          <p className="text-sm font-semibold tabular-nums">{it.value}</p>
        </div>
      ))}
    </div>
  )
}

// Bloco E — evolução comercial (full-width, destaque). 3 séries normalizadas
// (índice 100 no primeiro bucket) pra comparar trajetória; o tooltip mostra
// os valores absolutos. Empty state em ranges < 14d (granularity 'daily').
export function EvolutionChart(): React.ReactElement {
  const { data, isLoading } = useDashboardSummary()

  if (!data) {
    return (
      <Shell>
        <div className={cn('h-64', isLoading && 'animate-pulse')} />
      </Shell>
    )
  }

  const evolution = data.evolution
  const buckets = evolution.buckets
  const showEmpty = evolution.granularity === 'daily' || buckets.length < 4

  return (
    <Shell>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Evolução comercial</h3>
        {!showEmpty && <Legend />}
      </div>

      {showEmpty ? (
        <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-border/60 px-4 text-center text-sm text-muted-foreground">
          Selecione um período de pelo menos 14 dias pra visualizar a evolução.
        </div>
      ) : (
        <EvolutionLine buckets={buckets} />
      )}

      <DerivedKpis derived={evolution.derived} />
    </Shell>
  )
}

function EvolutionLine({
  buckets,
}: {
  buckets: DashboardEvolution['buckets']
}): React.ReactElement {
  // Cada série normalizada pra índice 100; os absolutos ficam no `buckets`
  // pra o tooltip recuperar por índice/label.
  const chartData = SERIES.map((s) => ({
    id: s.id,
    data: normalizeToIndex100(buckets.map((b) => b[s.key])).map((y, i) => ({
      x: buckets[i]!.bucketLabel,
      y,
    })),
  }))

  // Cap de ~6 labels no eixo X pra não colidir em ranges longos.
  const step = Math.max(1, Math.ceil(buckets.length / 6))
  const tickValues = buckets
    .filter((_, i) => i % step === 0)
    .map((b) => b.bucketLabel)

  return (
    <div className="h-64">
      <ResponsiveLine
        data={chartData}
        theme={nivoTheme}
        margin={{ top: 8, right: 16, bottom: 36, left: 36 }}
        xScale={{ type: 'point' }}
        yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
        curve="monotoneX"
        colors={SERIES.map((s) => s.color)}
        lineWidth={2}
        enablePoints={false}
        enableGridX={false}
        enableGridY
        enableArea
        areaOpacity={0.1}
        defs={SERIES.map((s) => gradientDef(s.gradId, s.color))}
        fill={SERIES.map((s) => ({ match: { id: s.id }, id: s.gradId }))}
        axisLeft={{ tickSize: 0, tickPadding: 8, tickValues: 4 }}
        axisBottom={{ tickSize: 0, tickPadding: 8, tickValues, tickRotation: 0 }}
        enableSlices="x"
        sliceTooltip={({ slice }) => {
          const label = String(slice.points[0]?.data.x ?? '')
          const b = buckets.find((bk) => bk.bucketLabel === label)
          if (!b) return null
          return (
            <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
              <div className="mb-1 font-medium">{label}</div>
              <div className="space-y-0.5">
                {SERIES.map((s) => (
                  <div key={s.id} className="flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-muted-foreground">{s.id}:</span>
                    <span className="font-medium tabular-nums">
                      {s.money
                        ? displayMoney(b[s.key])
                        : intFmt.format(b[s.key])}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        }}
        isInteractive
        animate
      />
    </div>
  )
}
