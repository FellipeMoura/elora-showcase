import { useMemo } from 'react'
import type { RunReportResponse } from '@/api/reports'
import { cn } from '@/lib/utils'
import { ReportSection } from '../components/ReportSection'
import { ComparisonCell, PlainNumericCell } from './ComparisonCell'
import {
  compareDelta,
  deltaToStatus,
  formatDayShort,
  formatInt,
  formatMinutes,
  formatMoney,
  formatPct,
  lostReasonLabel,
  responseTimeThreshold,
  sourceLabel,
} from './leadsSummaryHelpers'

// =====================================================================
// Shape do data — espelha LeadsSummaryData do backend
// (apps/core/src/modules/reports/handlers/leadsSummary.ts).
// =====================================================================

interface LeadsSummaryDay {
  date: string
  total: number
  won: number
  wonRate: number | null
  lost: number
  lostRate: number | null
  pending: number
  pendingRate: number | null
  avgResponseTimeMin: number | null
  convertedValue: number
  avgTicket: number | null
}

interface LeadsSummaryData {
  period: { from: string; to: string }
  summary: {
    totalEntered: number
    won: number
    lost: number
    active: number
    conversionRate: number
    lossRate: number
    totalConvertedValue: number
  }
  daily: LeadsSummaryDay[]
  dailyAverages: {
    total: number
    won: number
    wonRate: number
    lost: number
    lostRate: number
    avgResponseTimeMin: number | null
    convertedValue: number
    avgTicket: number | null
  }
  bySource: Array<{
    source: string
    total: number
    won: number
    lost: number
    active: number
    conversionRate: number
  }>
  lostReasons: Array<{ reason: string | null; count: number; pct: number }>
}

// =====================================================================
// Thresholds (definidos pelo usuário no plano)
// =====================================================================

// Total: ±1.5 leads
const THRESHOLD_TOTAL = 1.5
// Convertidos % e Perdidos %: ±10 pontos percentuais
const THRESHOLD_RATE = 0.1
// Valor convertido: ±R$500
const THRESHOLD_CONVERTED_VALUE = 500
// Ticket médio: ±R$10
const THRESHOLD_AVG_TICKET = 10
// Tempo médio de resposta: ±20% da média (calculado dinamicamente)

// =====================================================================

interface RendererProps {
  result: RunReportResponse<unknown>
}

export function LeadsSummaryRenderer({
  result,
}: RendererProps): React.ReactElement {
  const data = result.data as LeadsSummaryData
  const { summary, daily, dailyAverages, bySource, lostReasons } = data

  // Pre-computa threshold do tempo de resposta uma vez (depende da média).
  const responseThresholdMin = useMemo(() => {
    if (dailyAverages.avgResponseTimeMin === null) return null
    return responseTimeThreshold(dailyAverages.avgResponseTimeMin)
  }, [dailyAverages.avgResponseTimeMin])

  return (
    <div className="flex flex-col gap-2">
      {/* ---- Tabela diária (defaultOpen) — totais na linha do rodapé ---- */}
      <ReportSection
        title="Por dia"
        subtitle={`${daily.length} ${daily.length === 1 ? 'dia' : 'dias'} no período · valores fora da média indicados visualmente`}
        defaultOpen
      >
        <DailyTable
          daily={daily}
          averages={dailyAverages}
          summary={summary}
          responseThresholdMin={responseThresholdMin}
        />
        <AveragesFootnote
          averages={dailyAverages}
          responseThresholdMin={responseThresholdMin}
        />
      </ReportSection>

      {/* ---- Por origem (colapsada) ---- */}
      <ReportSection
        title="Por origem"
        subtitle={`${bySource.length} ${bySource.length === 1 ? 'origem' : 'origens'} no período`}
      >
        <BySourceTable rows={bySource} />
      </ReportSection>

      {/* ---- Motivos de perda (colapsada) ---- */}
      <ReportSection
        title="Motivos de perda"
        subtitle={`${summary.lost} ${summary.lost === 1 ? 'perdido' : 'perdidos'} no período`}
      >
        <LostReasonsList rows={lostReasons} />
      </ReportSection>
    </div>
  )
}

// =====================================================================
// Tabela diária com comparativos + linha de totais no rodapé
// =====================================================================

interface DailyTableProps {
  daily: LeadsSummaryDay[]
  averages: LeadsSummaryData['dailyAverages']
  summary: LeadsSummaryData['summary']
  responseThresholdMin: number | null
}

function DailyTable({
  daily,
  averages,
  summary,
  responseThresholdMin,
}: DailyTableProps): React.ReactElement {
  if (daily.length === 0) {
    return (
      <div className="rounded-md border bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        Nenhum dado no período.
      </div>
    )
  }

  // Pendentes % geral — não vem pronto em summary; deriva aqui.
  const pendingRateOverall =
    summary.totalEntered > 0 ? summary.active / summary.totalEntered : null

  // Ticket médio geral — média ponderada pelo total convertido. Mais
  // honesto que avg-of-averages (dias com 1 venda não pesam o mesmo
  // que dias com 10).
  const avgTicketOverall =
    summary.won > 0 ? summary.totalConvertedValue / summary.won : null

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-2 text-left">Dia</th>
            <th className="px-2 py-2 text-right">Total</th>
            <th className="px-2 py-2 text-right">Convertidos</th>
            <th className="px-2 py-2 text-right">Perdidos</th>
            <th className="px-2 py-2 text-right">Pendentes</th>
            <th className="px-2 py-2 text-right">Resposta</th>
            <th className="px-2 py-2 text-right">Valor R$</th>
            <th className="px-2 py-2 text-right">Ticket médio</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((d) => (
            <DailyRow
              key={d.date}
              day={d}
              averages={averages}
              responseThresholdMin={responseThresholdMin}
            />
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 bg-muted/40 text-sm font-semibold">
            <td className="px-2 py-2 text-left uppercase tracking-wide text-xs">
              Total
            </td>
            <td className="px-2 py-2 text-right">
              {formatInt(summary.totalEntered)}
            </td>
            <td className="px-2 py-2 text-right text-success">
              {formatInt(summary.won)} ·{' '}
              <span className="text-xs">{formatPct(summary.conversionRate)}</span>
            </td>
            <td className="px-2 py-2 text-right text-error">
              {formatInt(summary.lost)} ·{' '}
              <span className="text-xs">{formatPct(summary.lossRate)}</span>
            </td>
            <td className="px-2 py-2 text-right">
              {formatInt(summary.active)} ·{' '}
              <span className="text-xs">{formatPct(pendingRateOverall)}</span>
            </td>
            <td className="px-2 py-2 text-right">
              {formatMinutes(averages.avgResponseTimeMin)}
            </td>
            <td className="px-2 py-2 text-right text-primary">
              {formatMoney(summary.totalConvertedValue)}
            </td>
            <td className="px-2 py-2 text-right">
              {formatMoney(avgTicketOverall)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function DailyRow({
  day,
  averages,
  responseThresholdMin,
}: {
  day: LeadsSummaryDay
  averages: LeadsSummaryData['dailyAverages']
  responseThresholdMin: number | null
}): React.ReactElement {
  const hasData = day.total > 0

  // Total — ±1.5
  const totalDir = compareDelta(day.total, averages.total, THRESHOLD_TOTAL)
  const totalStatus = deltaToStatus(totalDir)

  // Convertidos: comparar TAXA (pp), não absoluto. Pra dia com total=0,
  // rate=null → mostra "—" sem comparação.
  const wonDir =
    day.wonRate !== null
      ? compareDelta(day.wonRate, averages.wonRate, THRESHOLD_RATE)
      : null
  const wonStatus = wonDir ? deltaToStatus(wonDir) : null

  const lostDir =
    day.lostRate !== null
      ? compareDelta(day.lostRate, averages.lostRate, THRESHOLD_RATE)
      : null
  const lostStatus =
    lostDir
      ? deltaToStatus(lostDir, /* inverted */ true) // mais perdas = ruim
      : null

  // Pendentes: sem comparativo (decisão do usuário)
  // Tempo de resposta: ±20% da média, INVERTIDO (menor = melhor)
  const responseDir =
    day.avgResponseTimeMin !== null &&
    averages.avgResponseTimeMin !== null &&
    responseThresholdMin !== null
      ? compareDelta(
          day.avgResponseTimeMin,
          averages.avgResponseTimeMin,
          responseThresholdMin,
        )
      : null
  const responseStatus = responseDir
    ? deltaToStatus(responseDir, /* inverted */ true)
    : null

  // Valor convertido: ±R$500
  const convDir = compareDelta(
    day.convertedValue,
    averages.convertedValue,
    THRESHOLD_CONVERTED_VALUE,
  )
  const convStatus = deltaToStatus(convDir)

  // Ticket médio: ±R$10, só se houver dado
  const ticketDir =
    day.avgTicket !== null && averages.avgTicket !== null
      ? compareDelta(day.avgTicket, averages.avgTicket, THRESHOLD_AVG_TICKET)
      : null
  const ticketStatus = ticketDir ? deltaToStatus(ticketDir) : null

  return (
    <tr
      className={cn(
        'border-b last:border-b-0',
        !hasData && 'text-muted-foreground',
      )}
    >
      <td className="px-2 py-2 text-left text-xs">{formatDayShort(day.date)}</td>

      <td className="px-2 py-2">
        {hasData ? (
          <ComparisonCell
            value={formatInt(day.total)}
            status={totalStatus}
            direction={totalDir}
          />
        ) : (
          <PlainNumericCell value="0" />
        )}
      </td>

      <td className="px-2 py-2">
        {wonDir && wonStatus ? (
          <ComparisonCell
            value={`${formatInt(day.won)} · ${formatPct(day.wonRate)}`}
            status={wonStatus}
            direction={wonDir}
          />
        ) : (
          <PlainNumericCell value={hasData ? '0' : '—'} />
        )}
      </td>

      <td className="px-2 py-2">
        {lostDir && lostStatus ? (
          <ComparisonCell
            value={`${formatInt(day.lost)} · ${formatPct(day.lostRate)}`}
            status={lostStatus}
            direction={lostDir}
          />
        ) : (
          <PlainNumericCell value={hasData ? '0' : '—'} />
        )}
      </td>

      <td className="px-2 py-2">
        <PlainNumericCell
          value={
            hasData
              ? `${formatInt(day.pending)} · ${formatPct(day.pendingRate)}`
              : '—'
          }
        />
      </td>

      <td className="px-2 py-2">
        {responseDir && responseStatus ? (
          <ComparisonCell
            value={formatMinutes(day.avgResponseTimeMin)}
            status={responseStatus}
            direction={responseDir}
          />
        ) : (
          <PlainNumericCell value={formatMinutes(day.avgResponseTimeMin)} />
        )}
      </td>

      <td className="px-2 py-2">
        {hasData && day.convertedValue > 0 ? (
          <ComparisonCell
            value={formatMoney(day.convertedValue)}
            status={convStatus}
            direction={convDir}
          />
        ) : (
          <PlainNumericCell value={formatMoney(day.convertedValue)} />
        )}
      </td>

      <td className="px-2 py-2">
        {ticketDir && ticketStatus ? (
          <ComparisonCell
            value={formatMoney(day.avgTicket)}
            status={ticketStatus}
            direction={ticketDir}
          />
        ) : (
          <PlainNumericCell value={formatMoney(day.avgTicket)} />
        )}
      </td>
    </tr>
  )
}

// Rodapé com as médias usadas como referência. Mostra explicitamente os
// thresholds pra o usuário saber qual é a faixa "na média" de cada coluna.
function AveragesFootnote({
  averages,
  responseThresholdMin,
}: {
  averages: LeadsSummaryData['dailyAverages']
  responseThresholdMin: number | null
}): React.ReactElement {
  return (
    <div className="mt-3 flex flex-col gap-1 rounded-md bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Média do período (referência)</span>
      <div className="flex flex-wrap gap-x-4 gap-y-0.5">
        <span>
          Total: <strong className="text-foreground">{averages.total.toFixed(1)}</strong> ±1.5
        </span>
        <span>
          Convertidos %: <strong className="text-foreground">{formatPct(averages.wonRate)}</strong> ±10pp
        </span>
        <span>
          Perdidos %: <strong className="text-foreground">{formatPct(averages.lostRate)}</strong> ±10pp
        </span>
        <span>
          Resposta:{' '}
          <strong className="text-foreground">
            {formatMinutes(averages.avgResponseTimeMin)}
          </strong>{' '}
          {responseThresholdMin !== null
            ? `±${formatMinutes(responseThresholdMin)}`
            : '(sem dado)'}
        </span>
        <span>
          Valor: <strong className="text-foreground">{formatMoney(averages.convertedValue)}</strong> ±{formatMoney(500)}
        </span>
        <span>
          Ticket: <strong className="text-foreground">{formatMoney(averages.avgTicket)}</strong> ±{formatMoney(10)}
        </span>
      </div>
    </div>
  )
}

// =====================================================================
// Por origem
// =====================================================================

function BySourceTable({
  rows,
}: {
  rows: LeadsSummaryData['bySource']
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <div className="rounded-md bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        Nenhum dado no período.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-2 text-left">Origem</th>
            <th className="px-2 py-2 text-right">Total</th>
            <th className="px-2 py-2 text-right">Convertidos</th>
            <th className="px-2 py-2 text-right">Perdidos</th>
            <th className="px-2 py-2 text-right">Ativos</th>
            <th className="px-2 py-2 text-right">Taxa conv.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.source} className="border-b last:border-b-0">
              <td className="px-2 py-2 text-left font-medium">
                {sourceLabel(r.source)}
              </td>
              <td className="px-2 py-2 text-right">{formatInt(r.total)}</td>
              <td className="px-2 py-2 text-right text-success">
                {formatInt(r.won)}
              </td>
              <td className="px-2 py-2 text-right text-error">
                {formatInt(r.lost)}
              </td>
              <td className="px-2 py-2 text-right">{formatInt(r.active)}</td>
              <td className="px-2 py-2 text-right font-medium">
                {formatPct(r.conversionRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// =====================================================================
// Motivos de perda — barras horizontais
// =====================================================================

function LostReasonsList({
  rows,
}: {
  rows: LeadsSummaryData['lostReasons']
}): React.ReactElement {
  if (rows.length === 0) {
    return (
      <div className="rounded-md bg-muted/30 p-4 text-center text-sm text-muted-foreground">
        Nenhuma perda registrada no período.
      </div>
    )
  }
  const maxPct = Math.max(...rows.map((r) => r.pct), 0.01)

  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.reason ?? '__null__'} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {lostReasonLabel(r.reason)}
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatInt(r.count)} · {formatPct(r.pct)}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-error/60 print:bg-error"
              style={{ width: `${Math.max(2, (r.pct / maxPct) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
