import { ResponsiveBar } from '@nivo/bar'
import { ResponsiveLine } from '@nivo/line'
import { ResponsivePie } from '@nivo/pie'
import type { DashboardDistribution } from '@/api/dashboard'
import { cn } from '@/lib/utils'
import { displayMoney } from '@/lib/format'
import {
  CATEGORICAL_PALETTE,
  LEAD_SUBSTAGE_COLORS,
  leadSubstageLabel,
  lostReasonLabel,
  paymentMethodLabel,
  sourceLabel,
} from './labels'
import { dashboardSeriesColors, glassSurface, gradientDef, nivoTheme } from './tokens'
import { useDashboardSummary } from './useDashboardSummary'

const intFmt = new Intl.NumberFormat('pt-BR')
const compactMoney = new Intl.NumberFormat('pt-BR', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const CARD = cn('flex flex-col p-4', glassSurface)

// 'YYYY-MM-DD' → 'dd/mm' (sem montar Date, evita shift de timezone).
function dm(iso: string): string {
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function ChartCard({
  title,
  empty,
  children,
  className,
}: {
  title: string
  empty: boolean
  children: React.ReactNode
  className?: string
}): React.ReactElement {
  return (
    <div className={cn(CARD, className)}>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      {empty ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border/60 text-sm text-muted-foreground">
          Sem dados no período.
        </div>
      ) : (
        children
      )}
    </div>
  )
}

function Tip({
  color,
  label,
  value,
}: {
  color: string
  label: string
  value: string
}): React.ReactElement {
  return (
    <div className="rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-muted-foreground">{label}:</span>
        <span className="font-medium tabular-nums">{value}</span>
      </span>
    </div>
  )
}

function CategoryLegend({
  items,
}: {
  items: Array<{ label: string; value: string; color: string }>
}): React.ReactElement {
  return (
    <div className="mt-3 space-y-1 border-t border-border/40 pt-3">
      {items.map((it) => (
        <div
          key={it.label}
          className="flex items-center justify-between gap-2 text-xs"
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: it.color }}
            />
            <span className="truncate text-muted-foreground">{it.label}</span>
          </span>
          <span className="shrink-0 font-medium tabular-nums">{it.value}</span>
        </div>
      ))}
    </div>
  )
}

// C1 — receita no período (granularidade adaptativa, vinda dos buckets de E).
function RevenueChart({
  data,
}: {
  data: DashboardDistribution['revenueByDay']
}): React.ReactElement {
  const empty = data.length === 0 || data.every((d) => d.amount === 0)
  const series = [
    { id: 'Receita', data: data.map((d) => ({ x: dm(d.date), y: d.amount })) },
  ]
  const step = Math.max(1, Math.ceil(data.length / 6))
  const tickValues = data.filter((_, i) => i % step === 0).map((d) => dm(d.date))

  return (
    <ChartCard title="Receita no período" empty={empty}>
      <div className="h-48">
        <ResponsiveLine
          data={series}
          theme={nivoTheme}
          margin={{ top: 8, right: 12, bottom: 28, left: 48 }}
          xScale={{ type: 'point' }}
          yScale={{ type: 'linear', min: 0, max: 'auto' }}
          curve="monotoneX"
          colors={[dashboardSeriesColors.salesAmount]}
          lineWidth={2}
          enablePoints={false}
          enableGridX={false}
          enableArea
          areaOpacity={0.12}
          defs={[gradientDef('dist-revenue', dashboardSeriesColors.salesAmount)]}
          fill={[{ match: '*', id: 'dist-revenue' }]}
          axisLeft={{
            tickSize: 0,
            tickPadding: 6,
            tickValues: 4,
            format: (v) => compactMoney.format(Number(v)),
          }}
          axisBottom={{ tickSize: 0, tickPadding: 6, tickValues, tickRotation: 0 }}
          enableSlices="x"
          sliceTooltip={({ slice }) => {
            const p = slice.points[0]
            if (!p) return null
            return (
              <Tip
                color={dashboardSeriesColors.salesAmount}
                label={String(p.data.x)}
                value={displayMoney(Number(p.data.y))}
              />
            )
          }}
          isInteractive
          animate
        />
      </div>
    </ChartCard>
  )
}

// C2 — leads por origem (donut).
function SourcePie({
  data,
}: {
  data: DashboardDistribution['leadsBySource']
}): React.ReactElement {
  const items = data.map((s, i) => ({
    label: sourceLabel(s.source),
    value: s.count,
    color: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]!,
  }))
  const pieData = items.map((it) => ({ id: it.label, value: it.value, color: it.color }))

  return (
    <ChartCard title="Leads por origem" empty={items.length === 0}>
      <div className="h-48">
        <ResponsivePie
          data={pieData}
          theme={nivoTheme}
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
          innerRadius={0.6}
          padAngle={1}
          cornerRadius={2}
          colors={(d) => d.data.color}
          enableArcLabels={false}
          enableArcLinkLabels={false}
          borderWidth={0}
          tooltip={({ datum }) => (
            <Tip
              color={datum.color}
              label={String(datum.id)}
              value={intFmt.format(datum.value)}
            />
          )}
          isInteractive
          animate
        />
      </div>
      <CategoryLegend
        items={items.map((it) => ({
          label: it.label,
          value: intFmt.format(it.value),
          color: it.color,
        }))}
      />
    </ChartCard>
  )
}

// C3 — top 5 motivos de perda (barra horizontal, cor única de perda).
function LostReasonsBar({
  data,
}: {
  data: DashboardDistribution['lostReasons']
}): React.ReactElement {
  // Reverte: nivo horizontal renderiza o índice 0 embaixo; queremos o maior
  // (já vem ordenado desc do backend) no topo.
  const barData = data
    .map((r) => ({ reason: lostReasonLabel(r.reason), count: r.count }))
    .reverse()

  return (
    <ChartCard title="Motivos de perda" empty={data.length === 0}>
      <div className="h-48">
        <ResponsiveBar
          data={barData}
          theme={nivoTheme}
          keys={['count']}
          indexBy="reason"
          layout="horizontal"
          margin={{ top: 4, right: 16, bottom: 24, left: 100 }}
          padding={0.3}
          colors={['var(--destructive)']}
          enableGridY={false}
          axisLeft={{ tickSize: 0, tickPadding: 6 }}
          axisBottom={{ tickSize: 0, tickPadding: 6, tickValues: 4 }}
          labelSkipWidth={20}
          tooltip={({ indexValue, value }) => (
            <Tip
              color="var(--destructive)"
              label={String(indexValue)}
              value={intFmt.format(value)}
            />
          )}
          isInteractive
          animate
        />
      </div>
    </ChartCard>
  )
}

// C4 — mix de métodos de pagamento (donut por valor R$).
function PaymentMethodsPie({
  data,
}: {
  data: DashboardDistribution['paymentMethods']
}): React.ReactElement {
  const items = data.map((p, i) => ({
    label: paymentMethodLabel(p.method),
    amount: p.amount,
    color: CATEGORICAL_PALETTE[i % CATEGORICAL_PALETTE.length]!,
  }))
  const pieData = items.map((it) => ({ id: it.label, value: it.amount, color: it.color }))
  const empty = items.length === 0 || items.every((it) => it.amount === 0)

  return (
    <ChartCard title="Métodos de pagamento" empty={empty}>
      <div className="h-48">
        <ResponsivePie
          data={pieData}
          theme={nivoTheme}
          margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
          innerRadius={0.6}
          padAngle={1}
          cornerRadius={2}
          colors={(d) => d.data.color}
          enableArcLabels={false}
          enableArcLinkLabels={false}
          borderWidth={0}
          tooltip={({ datum }) => (
            <Tip
              color={datum.color}
              label={String(datum.id)}
              value={displayMoney(datum.value)}
            />
          )}
          isInteractive
          animate
        />
      </div>
      <CategoryLegend
        items={items.map((it) => ({
          label: it.label,
          value: displayMoney(it.amount),
          color: it.color,
        }))}
      />
    </ChartCard>
  )
}

// C5 — distribuição de leads por substage (snapshot do kanban, IGNORA o
// filtro global). Barra única empilhada + legenda.
function SubstagesBar({
  data,
}: {
  data: DashboardDistribution['leadSubstages']
}): React.ReactElement {
  const keys = data.map((d) => d.substage)
  const row: Record<string, string | number> = { group: 'leads' }
  data.forEach((d) => {
    row[d.substage] = d.count
  })

  return (
    <ChartCard
      title="Leads por etapa (atual)"
      empty={data.length === 0}
      className="sm:col-span-2 lg:col-span-1"
    >
      <div className="h-16">
        <ResponsiveBar
          data={[row]}
          theme={nivoTheme}
          keys={keys}
          indexBy="group"
          layout="horizontal"
          margin={{ top: 0, right: 4, bottom: 0, left: 4 }}
          colors={(bar) => LEAD_SUBSTAGE_COLORS[String(bar.id)] ?? 'var(--primary)'}
          enableGridX={false}
          enableGridY={false}
          axisLeft={null}
          axisBottom={null}
          enableLabel={false}
          tooltip={({ id, value }) => (
            <Tip
              color={LEAD_SUBSTAGE_COLORS[String(id)] ?? 'var(--primary)'}
              label={leadSubstageLabel(String(id))}
              value={intFmt.format(value)}
            />
          )}
          isInteractive
          animate
        />
      </div>
      <CategoryLegend
        items={data.map((d) => ({
          label: leadSubstageLabel(d.substage),
          value: intFmt.format(d.count),
          color: LEAD_SUBSTAGE_COLORS[d.substage] ?? 'var(--primary)',
        }))}
      />
    </ChartCard>
  )
}

const GRID = 'grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3'

// Bloco C — grid de 5 charts de distribuição.
export function DistributionGrid(): React.ReactElement {
  const { data, isLoading } = useDashboardSummary()

  if (!data) {
    return (
      <div className={GRID} aria-busy={isLoading}>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={cn(CARD, 'h-64', isLoading && 'animate-pulse', i === 4 && 'sm:col-span-2 lg:col-span-1')}
          />
        ))}
      </div>
    )
  }

  const d = data.distribution

  return (
    <div className={GRID}>
      <RevenueChart data={d.revenueByDay} />
      <SourcePie data={d.leadsBySource} />
      <LostReasonsBar data={d.lostReasons} />
      <PaymentMethodsPie data={d.paymentMethods} />
      <SubstagesBar data={d.leadSubstages} />
    </div>
  )
}
