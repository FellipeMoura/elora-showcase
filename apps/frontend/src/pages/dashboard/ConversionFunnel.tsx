import { ResponsiveFunnel } from '@nivo/funnel'
import type { DashboardFunnel } from '@/api/dashboard'
import { cn } from '@/lib/utils'
import { glassSurface, nivoTheme } from './tokens'
import { useDashboardSummary } from './useDashboardSummary'

// Cor por etapa (id estável vindo do backend). Vai do primary (entrada) ao
// success (venda) — leitura semântica do funil. var(--token) = OKLCH do tema.
const STAGE_COLORS: Record<string, string> = {
  leads: 'var(--primary)',
  evalScheduled: 'var(--journey-evaluation)',
  evalPerformed: 'var(--info)',
  quoteSent: 'var(--warning)',
  salesClosed: 'var(--success)',
}

const intFmt = new Intl.NumberFormat('pt-BR')

function pct(value: number, base: number): string {
  if (base <= 0) return '—'
  return `${((value / base) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
}

function Shell({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className={cn('flex h-full flex-col p-4', glassSurface)}>{children}</div>
}

// Legenda HTML: dot + etapa + valor absoluto + conversão vs topo (leads).
function Legend({
  stages,
}: {
  stages: DashboardFunnel['stages']
}): React.ReactElement {
  const top = stages[0]?.value ?? 0
  return (
    <div className="mt-3 grid grid-cols-1 gap-1 border-t border-border/40 pt-3 sm:grid-cols-2">
      {stages.map((s) => (
        <div key={s.id} className="flex items-center justify-between gap-2 text-xs">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: STAGE_COLORS[s.id] ?? 'var(--primary)' }}
            />
            <span className="truncate text-muted-foreground">{s.label}</span>
          </span>
          <span className="shrink-0 tabular-nums">
            <span className="font-medium">{intFmt.format(s.value)}</span>{' '}
            <span className="text-muted-foreground">({pct(s.value, top)})</span>
          </span>
        </div>
      ))}
    </div>
  )
}

function TransitionsBanner({
  transitions,
}: {
  transitions: DashboardFunnel['transitionsTimeAvgDays']
}): React.ReactElement {
  const items = [
    { label: 'Lead → avaliação', value: transitions.leadToEvaluation },
    { label: 'Avaliação → orçamento', value: transitions.evaluationToQuote },
    { label: 'Orçamento → venda', value: transitions.quoteToSale },
  ]
  return (
    <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-border/40 pt-3">
      {items.map((it) => (
        <div key={it.label}>
          <p className="truncate text-xs text-muted-foreground">{it.label}</p>
          <p className="text-sm font-semibold tabular-nums">
            {it.value == null
              ? '—'
              : `${it.value.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`}
          </p>
        </div>
      ))}
    </div>
  )
}

// Bloco B — funil de conversão (5 etapas, trapezoides decrescentes via
// @nivo/funnel). Cada etapa filtra pelo timestamp do próprio evento no range
// (não coorte) — pode ser não-monotônico, é esperado no V1. Tooltip mostra
// qtd absoluta, % do topo e % vs etapa anterior; banner com tempos médios.
export function ConversionFunnel(): React.ReactElement {
  const { data, isLoading } = useDashboardSummary()

  if (!data) {
    return (
      <Shell>
        <div className={isLoading ? 'h-72 animate-pulse' : 'h-72'} />
      </Shell>
    )
  }

  const funnel = data.funnel
  const stages = funnel.stages
  const hasData = stages.some((s) => s.value > 0)

  return (
    <Shell>
      <h3 className="mb-3 text-sm font-semibold">Funil de conversão</h3>

      {hasData ? (
        <div className="h-72">
          <ResponsiveFunnel
            data={stages.map((s) => ({ id: s.id, value: s.value, label: s.label }))}
            theme={nivoTheme}
            direction="vertical"
            margin={{ top: 8, right: 8, bottom: 8, left: 8 }}
            colors={stages.map((s) => STAGE_COLORS[s.id] ?? 'var(--primary)')}
            borderWidth={0}
            valueFormat={(v) => intFmt.format(v)}
            labelColor={{ theme: 'background' }}
            beforeSeparatorLength={0}
            afterSeparatorLength={0}
            motionConfig="gentle"
            tooltip={({ part }) => {
              const idx = stages.findIndex((s) => s.id === part.data.id)
              const stage = stages[idx]
              if (!stage) return null
              const top = stages[0]?.value ?? 0
              const prev = idx > 0 ? stages[idx - 1]!.value : null
              return (
                <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
                  <div className="mb-1 font-medium">{stage.label}</div>
                  <div className="space-y-0.5 tabular-nums">
                    <div>
                      <span className="text-muted-foreground">Total: </span>
                      <span className="font-medium">{intFmt.format(stage.value)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">% do topo: </span>
                      <span className="font-medium">{pct(stage.value, top)}</span>
                    </div>
                    {prev !== null && (
                      <div>
                        <span className="text-muted-foreground">vs etapa anterior: </span>
                        <span className="font-medium">{pct(stage.value, prev)}</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            }}
          />
        </div>
      ) : (
        <div className="flex h-72 items-center justify-center rounded-xl border border-dashed border-border/60 text-sm text-muted-foreground">
          Sem dados no período.
        </div>
      )}

      <Legend stages={stages} />
      <TransitionsBanner transitions={funnel.transitionsTimeAvgDays} />
    </Shell>
  )
}
