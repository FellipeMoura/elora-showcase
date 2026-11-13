import type { RunReportResponse } from '@/api/reports'
import { cn } from '@/lib/utils'
import { ReportSection } from '../components/ReportSection'
import { ComparisonCell } from './ComparisonCell'
import {
  compareDelta,
  deltaToStatus,
  formatInt,
  formatMoney,
  formatPct,
} from './leadsSummaryHelpers'

// =====================================================================
// Shape do data — espelha SalesSummaryData do backend
// (apps/core/src/modules/reports/handlers/salesSummary.ts).
// =====================================================================

interface SalesSummaryKpis {
  totalSales: number
  totalRevenue: number
  totalDiscount: number
  totalReceived: number
  totalPending: number
  avgTicket: number | null
  discountRate: number | null
  paidSales: number
  openSales: number
  cancelledSales: number
}

interface SalesSummaryData {
  period: { from: string; to: string }
  previousPeriod: { from: string; to: string }
  summary: {
    current: SalesSummaryKpis
    previous: SalesSummaryKpis
  }
  byProcedure: Array<{
    procedureId: string
    procedureName: string
    salesCount: number
    totalSessions: number
    revenue: number
    avgPricePerSession: number | null
  }>
  byPaymentMethod: Array<{
    method: string
    installments: number
    amount: number
    pct: number
  }>
  bySalesperson: Array<{
    userId: string | null
    userName: string | null
    salesCount: number
    revenue: number
    avgTicket: number | null
    discountRate: number | null
  }>
}

// =====================================================================
// Comparativo: ±5% relativo ao período anterior. Pra qualquer KPI
// numérico (count, R$, taxa). Quando previous = 0, sem comparativo
// (mostra valor "limpo" sem seta nem cor).
// =====================================================================
const COMPARISON_PCT = 0.05

interface RendererProps {
  result: RunReportResponse<unknown>
}

export function SalesSummaryRenderer({
  result,
}: RendererProps): React.ReactElement {
  const data = result.data as SalesSummaryData
  const { summary, byProcedure, byPaymentMethod, bySalesperson, previousPeriod } =
    data

  return (
    <div className="flex flex-col gap-2">
      <ReportSection
        title="KPIs do período"
        subtitle={`Comparativo vs ${formatRange(previousPeriod)} (mesma duração)`}
        defaultOpen
      >
        <KpisGrid current={summary.current} previous={summary.previous} />
      </ReportSection>

      <ReportSection
        title="Por procedimento"
        subtitle={`${byProcedure.length} ${byProcedure.length === 1 ? 'procedimento' : 'procedimentos'} vendidos no período`}
      >
        <ByProcedureTable rows={byProcedure} />
      </ReportSection>

      <ReportSection
        title="Por método de pagamento"
        subtitle="Distribuição das parcelas planejadas nas vendas do período"
      >
        <ByPaymentMethodTable rows={byPaymentMethod} />
      </ReportSection>

      <ReportSection
        title="Por vendedor"
        subtitle={`${bySalesperson.length} ${bySalesperson.length === 1 ? 'vendedor' : 'vendedores'} fecharam vendas no período`}
      >
        <BySalespersonTable rows={bySalesperson} />
      </ReportSection>
    </div>
  )
}

// =====================================================================
// KPIs grid — 3 linhas (Volume, R$, Status). Cards usam ComparisonCell
// quando há delta significativo; status row mostra badges sem delta.
// =====================================================================

interface KpisGridProps {
  current: SalesSummaryKpis
  previous: SalesSummaryKpis
}

function KpisGrid({ current, previous }: KpisGridProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      {/* Linha 1: Volume */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <KpiCard
          label="Vendas fechadas"
          value={formatInt(current.totalSales)}
          current={current.totalSales}
          previous={previous.totalSales}
        />
        <KpiCard
          label="Ticket médio"
          value={formatMoney(current.avgTicket)}
          current={current.avgTicket}
          previous={previous.avgTicket}
        />
        <KpiCard
          label="% de desconto"
          value={formatPct(current.discountRate)}
          current={current.discountRate}
          previous={previous.discountRate}
        />
      </div>

      {/* Linha 2: R$ */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Receita"
          value={formatMoney(current.totalRevenue)}
          current={current.totalRevenue}
          previous={previous.totalRevenue}
          accent="primary"
        />
        <KpiCard
          label="Desconto concedido"
          value={formatMoney(current.totalDiscount)}
          current={current.totalDiscount}
          previous={previous.totalDiscount}
        />
        <KpiCard
          label="Recebido"
          value={formatMoney(current.totalReceived)}
          current={current.totalReceived}
          previous={previous.totalReceived}
          accent="success"
        />
        <KpiCard
          label="Em aberto"
          value={formatMoney(current.totalPending)}
          current={current.totalPending}
          previous={previous.totalPending}
        />
      </div>

      {/* Linha 3: Status badges (sem delta) */}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <StatusBadge
          label="Quitadas"
          value={current.paidSales}
          dotClass="bg-success"
        />
        <StatusBadge
          label="Em aberto"
          value={current.openSales}
          dotClass="bg-primary"
        />
        <StatusBadge
          label="Canceladas"
          value={current.cancelledSales}
          dotClass="bg-error"
        />
      </div>
    </div>
  )
}

interface KpiCardProps {
  label: string
  value: string
  current: number | null
  previous: number | null
  // Cor neutra do label/valor quando não há comparativo.
  accent?: 'primary' | 'success'
}

function KpiCard({
  label,
  value,
  current,
  previous,
  accent,
}: KpiCardProps): React.ReactElement {
  // Sem comparativo quando previous é null, 0, ou current é null.
  const hasComparison =
    current !== null && previous !== null && previous > 0
  const threshold = hasComparison ? Math.abs(previous) * COMPARISON_PCT : 0
  const direction = hasComparison
    ? compareDelta(current, previous, threshold)
    : null
  const status = direction ? deltaToStatus(direction) : null

  return (
    <div className="flex flex-col gap-1 rounded-md border bg-card p-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {direction && status ? (
        <ComparisonCell
          value={value}
          status={status}
          direction={direction}
          align="left"
          className="text-lg"
        />
      ) : (
        <span
          className={cn(
            'text-lg font-medium tabular-nums',
            accent === 'primary' && 'text-primary',
            accent === 'success' && 'text-success',
          )}
        >
          {value}
        </span>
      )}
    </div>
  )
}

function StatusBadge({
  label,
  value,
  dotClass,
}: {
  label: string
  value: number
  dotClass: string
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className={cn('inline-block size-2 rounded-full', dotClass)} />
        <span className="text-sm">{label}</span>
      </div>
      <span className="text-base font-semibold tabular-nums">
        {formatInt(value)}
      </span>
    </div>
  )
}

// =====================================================================
// Por procedimento
// =====================================================================

function ByProcedureTable({
  rows,
}: {
  rows: SalesSummaryData['byProcedure']
}): React.ReactElement {
  if (rows.length === 0) {
    return <EmptyBlock message="Nenhum procedimento vendido no período." />
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-2 text-left">Procedimento</th>
            <th className="px-2 py-2 text-right">Vendas</th>
            <th className="px-2 py-2 text-right">Sessões</th>
            <th className="px-2 py-2 text-right">Receita</th>
            <th className="px-2 py-2 text-right">Preço médio/sessão</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.procedureId} className="border-b last:border-b-0">
              <td className="px-2 py-2 text-left font-medium">
                {r.procedureName}
              </td>
              <td className="px-2 py-2 text-right">{formatInt(r.salesCount)}</td>
              <td className="px-2 py-2 text-right">
                {formatInt(r.totalSessions)}
              </td>
              <td className="px-2 py-2 text-right text-primary">
                {formatMoney(r.revenue)}
              </td>
              <td className="px-2 py-2 text-right">
                {formatMoney(r.avgPricePerSession)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// =====================================================================
// Por método de pagamento
// =====================================================================

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  cash: 'Dinheiro',
  bank_transfer: 'Transferência bancária',
  other: 'Outros',
}

function paymentMethodLabel(method: string): string {
  return PAYMENT_METHOD_LABELS[method] ?? method
}

function ByPaymentMethodTable({
  rows,
}: {
  rows: SalesSummaryData['byPaymentMethod']
}): React.ReactElement {
  if (rows.length === 0) {
    return <EmptyBlock message="Nenhum pagamento planejado no período." />
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-2 text-left">Método</th>
            <th className="px-2 py-2 text-right">Parcelas</th>
            <th className="px-2 py-2 text-right">Total</th>
            <th className="px-2 py-2 text-right">% do total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.method} className="border-b last:border-b-0">
              <td className="px-2 py-2 text-left font-medium">
                {paymentMethodLabel(r.method)}
              </td>
              <td className="px-2 py-2 text-right">
                {formatInt(r.installments)}
              </td>
              <td className="px-2 py-2 text-right">{formatMoney(r.amount)}</td>
              <td className="px-2 py-2 text-right font-medium">
                {formatPct(r.pct)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// =====================================================================
// Por vendedor
// =====================================================================

function BySalespersonTable({
  rows,
}: {
  rows: SalesSummaryData['bySalesperson']
}): React.ReactElement {
  if (rows.length === 0) {
    return <EmptyBlock message="Nenhuma venda registrada no período." />
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm tabular-nums">
        <thead>
          <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-2 py-2 text-left">Vendedor</th>
            <th className="px-2 py-2 text-right">Vendas</th>
            <th className="px-2 py-2 text-right">Receita</th>
            <th className="px-2 py-2 text-right">Ticket médio</th>
            <th className="px-2 py-2 text-right">% desconto</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.userId ?? '__null__'}
              className="border-b last:border-b-0"
            >
              <td className="px-2 py-2 text-left font-medium">
                {r.userName ?? 'Sem vendedor registrado'}
              </td>
              <td className="px-2 py-2 text-right">{formatInt(r.salesCount)}</td>
              <td className="px-2 py-2 text-right text-primary">
                {formatMoney(r.revenue)}
              </td>
              <td className="px-2 py-2 text-right">
                {formatMoney(r.avgTicket)}
              </td>
              <td className="px-2 py-2 text-right">
                {formatPct(r.discountRate)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// =====================================================================
// Helpers locais
// =====================================================================

function EmptyBlock({ message }: { message: string }): React.ReactElement {
  return (
    <div className="rounded-md bg-muted/30 p-4 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

// Formata range ISO (YYYY-MM-DD → DD/MM/YYYY) pro subtitle do comparativo.
function formatRange(range: { from: string; to: string }): string {
  return `${formatBr(range.from)} – ${formatBr(range.to)}`
}

function formatBr(yyyymmdd: string): string {
  const [y, m, d] = yyyymmdd.split('-')
  if (!y || !m || !d) return yyyymmdd
  return `${d}/${m}/${y}`
}
