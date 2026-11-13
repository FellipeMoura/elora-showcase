import { ResponsiveLine } from '@nivo/line'
import CountUpDefault from 'react-countup'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { glassHover, glassSurface, gradientDef } from './tokens'

// react-countup é empacotado como UMD sem campo `exports`/`module`. O Vite
// (esbuild, em dev) expõe o `module.exports` inteiro como default — ou seja,
// `import CountUp` chega como objeto `{ default, useCountUp }`, não o
// componente, e `<CountUp/>` quebra ("Element type is invalid ... got:
// object"). Desempacotamos `.default` quando presente (dev) e caímos no
// próprio import quando já é o componente (build via Rollup).
const CountUp = ((CountUpDefault as unknown as { default?: typeof CountUpDefault })
  .default ?? CountUpDefault) as typeof CountUpDefault

export type KpiFormat = 'money' | 'number' | 'percent'

interface KpiCardProps {
  label: string
  value: number
  format: KpiFormat
  // null = base 0 no período anterior (delta não calculável); undefined =
  // card sem comparativo (ex: agendamentos de hoje).
  deltaPct?: number | null
  sparkline?: number[]
  seriesColor?: string
  // Id único do gradiente Nivo (defs colidem se repetidos na página).
  gradientId?: string
  secondary?: React.ReactNode
}

// Props do CountUp por formato. Monetário com R$ + 2 casas; percentual com
// sufixo % e 1 casa; contagem inteira. Separadores pt-BR (milhar '.', dec ',').
function countUpProps(
  format: KpiFormat,
): {
  decimals: number
  separator: string
  decimal: string
  prefix?: string
  suffix?: string
} {
  switch (format) {
    case 'money':
      return { decimals: 2, separator: '.', decimal: ',', prefix: 'R$ ' }
    case 'percent':
      return { decimals: 1, separator: '.', decimal: ',', suffix: '%' }
    case 'number':
      return { decimals: 0, separator: '.', decimal: ',' }
  }
}

function DeltaBadge({ pct }: { pct: number }): React.ReactElement {
  const neutral = pct === 0
  const up = pct > 0
  const Icon = neutral ? Minus : up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium tabular-nums',
        neutral && 'bg-muted text-muted-foreground',
        !neutral && up && 'bg-success/15 text-success',
        !neutral && !up && 'bg-destructive/15 text-destructive',
      )}
    >
      <Icon className="h-3 w-3" />
      {Math.abs(pct).toLocaleString('pt-BR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      })}
      %
    </span>
  )
}

// Card de KPI do dashboard. Glass morphism + counter animado (react-countup,
// reanima no remount por período) + sparkline embarcada no canto. É um
// primitivo próprio do dashboard (não o <Card> shadcn) — exceção ao design
// system documentada em docs/dashboard-domain.md.
export function KpiCard({
  label,
  value,
  format,
  deltaPct,
  sparkline,
  seriesColor = 'var(--primary)',
  gradientId = 'kpi-spark',
  secondary,
}: KpiCardProps): React.ReactElement {
  const cu = countUpProps(format)
  const hasSparkline = sparkline !== undefined && sparkline.length > 0

  return (
    <div className={cn('relative overflow-hidden p-4', glassSurface, glassHover)}>
      {hasSparkline && (
        <div className="pointer-events-none absolute bottom-0 right-0 h-12 w-24 opacity-60">
          <ResponsiveLine
            data={[
              {
                id: gradientId,
                data: sparkline.map((v, i) => ({ x: i, y: v })),
              },
            ]}
            margin={{ top: 4, right: 4, bottom: 4, left: 4 }}
            xScale={{ type: 'point' }}
            yScale={{ type: 'linear', min: 'auto', max: 'auto' }}
            curve="monotoneX"
            enableArea
            enablePoints={false}
            enableGridX={false}
            enableGridY={false}
            axisTop={null}
            axisBottom={null}
            axisLeft={null}
            axisRight={null}
            isInteractive={false}
            animate
            colors={[seriesColor]}
            defs={[gradientDef(gradientId, seriesColor)]}
            fill={[{ match: '*', id: gradientId }]}
          />
        </div>
      )}

      <div className="relative space-y-1">
        <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold tracking-tight tabular-nums">
          <CountUp
            end={value}
            duration={1.2}
            preserveValue
            decimals={cu.decimals}
            separator={cu.separator}
            decimal={cu.decimal}
            prefix={cu.prefix}
            suffix={cu.suffix}
          />
        </p>
        <div className="flex min-h-5 flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {deltaPct !== undefined && deltaPct !== null && <DeltaBadge pct={deltaPct} />}
          {secondary}
        </div>
      </div>
    </div>
  )
}

// Skeleton do card (mesma moldura glass, conteúdo pulsando) — usado enquanto
// o summary carrega.
export function KpiCardSkeleton(): React.ReactElement {
  return (
    <div className={cn('relative overflow-hidden p-4', glassSurface)}>
      <div className="animate-pulse space-y-2">
        <div className="h-3 w-20 rounded bg-muted" />
        <div className="h-7 w-24 rounded bg-muted" />
        <div className="h-4 w-16 rounded bg-muted" />
      </div>
    </div>
  )
}
