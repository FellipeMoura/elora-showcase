import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
// eslint-disable-next-line no-restricted-imports -- inputs de data do filtro de período (não é campo de form)
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { Table, type TableColumn } from '@/components/data/Table'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useCashierEntries, useCashierSummary } from '@/hooks/useCashier'
import {
  PAYMENT_METHODS,
  type PaymentMethod,
} from '@/api/sales'
import type { CashierEntry } from '@/api/cashier'
import { displayDateTime, displayMoney, displayPhone } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/pages/sales/saleLabels'

const PAGE_SIZE = 50

type Preset = 'today' | 'week' | 'month' | 'custom'

interface DateRange {
  from: string // ISO datetime
  to: string // ISO datetime
}

const presetLabel: Record<Preset, string> = {
  today: 'Hoje',
  week: '7 dias',
  month: 'Mês atual',
  custom: 'Personalizado',
}

const PRESET_OPTIONS: ReadonlyArray<{ value: Preset; label: string }> = [
  { value: 'today', label: presetLabel.today },
  { value: 'week', label: presetLabel.week },
  { value: 'month', label: presetLabel.month },
  { value: 'custom', label: presetLabel.custom },
]

type MethodFilter = PaymentMethod | 'all'

const METHOD_OPTIONS: ReadonlyArray<{ value: MethodFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  ...PAYMENT_METHODS.map((m) => ({ value: m, label: PAYMENT_METHOD_LABELS[m] })),
]

// Resolve range a partir do preset. `custom` é tratado fora (caller mantém
// próprio state). Sempre cobre [00:00, 23:59:59.999] no extremo do range.
function resolveRangeFromPreset(preset: Exclude<Preset, 'custom'>): DateRange {
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0)
  const end = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999,
  )
  if (preset === 'today') {
    return { from: start.toISOString(), to: end.toISOString() }
  }
  if (preset === 'week') {
    const weekAgo = new Date(start)
    weekAgo.setDate(weekAgo.getDate() - 6) // últimos 7 dias incluindo hoje
    return { from: weekAgo.toISOString(), to: end.toISOString() }
  }
  // month: 1º dia do mês corrente → fim de hoje
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  return { from: monthStart.toISOString(), to: end.toISOString() }
}

// Conversores entre ISO datetime e YYYY-MM-DD pro input type=date.
const isoToDate = (iso: string): string => iso.slice(0, 10)

const dateToIso = (date: string, endOfDay: boolean): string => {
  const dt = endOfDay
    ? new Date(`${date}T23:59:59.999`)
    : new Date(`${date}T00:00:00`)
  return dt.toISOString()
}

export function CashierPage(): React.ReactElement {
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [preset, setPreset] = useState<Preset>('today')
  const [method, setMethod] = useState<MethodFilter>('all')
  const [page, setPage] = useState(1)

  // Range custom (só usado quando preset === 'custom')
  const [customFromDate, setCustomFromDate] = useState(() =>
    isoToDate(resolveRangeFromPreset('today').from),
  )
  const [customToDate, setCustomToDate] = useState(() =>
    isoToDate(resolveRangeFromPreset('today').to),
  )

  const range: DateRange = useMemo(() => {
    if (preset === 'custom') {
      return {
        from: dateToIso(customFromDate, false),
        to: dateToIso(customToDate, true),
      }
    }
    return resolveRangeFromPreset(preset)
  }, [preset, customFromDate, customToDate])

  const baseQuery = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      paymentMethod: method === 'all' ? undefined : method,
      q: debouncedSearch || undefined,
    }),
    [range.from, range.to, method, debouncedSearch],
  )

  const entriesQuery = useCashierEntries({
    ...baseQuery,
    page,
    pageSize: PAGE_SIZE,
  })

  // Summary ignora paginação + filtros de cliente/método (mostra panorama
  // do range completo). Frontend toma decisão deliberada: cards refletem
  // o range, não a busca textual.
  const summaryQuery = useCashierSummary({
    from: range.from,
    to: range.to,
  })

  const items = entriesQuery.data?.items ?? []
  const totalPages = entriesQuery.data?.totalPages ?? 0
  const total = entriesQuery.data?.total ?? 0
  const summary = summaryQuery.data

  const columns: TableColumn<CashierEntry, never>[] = [
    {
      key: 'paidAt',
      header: 'Hora',
      className: 'whitespace-nowrap tabular-nums',
      cell: (e) => displayDateTime(e.paidAt),
    },
    {
      key: 'client',
      header: 'Cliente',
      cell: (e) => (
        <div className="flex flex-col">
          <Link
            to={`/clients/${e.clientId}`}
            className="font-medium hover:underline"
          >
            {e.clientName}
          </Link>
          <span className="text-xs text-muted-foreground">
            {displayPhone(e.clientPhoneE164)}
          </span>
        </div>
      ),
    },
    {
      key: 'method',
      header: 'Método',
      className: 'text-muted-foreground',
      cell: (e) => PAYMENT_METHOD_LABELS[e.paymentMethod],
    },
    {
      key: 'installment',
      header: 'Parcela',
      className: 'text-muted-foreground tabular-nums',
      cell: (e) =>
        e.totalInstallments > 1
          ? `${e.installmentNumber}/${e.totalInstallments}`
          : 'à vista',
    },
    {
      key: 'amount',
      header: 'Valor',
      className: 'text-right tabular-nums font-medium',
      cell: (e) => displayMoney(e.amount),
    },
    {
      key: 'sale',
      header: '',
      className: 'w-24 text-right',
      cell: (e) => (
        <Button asChild variant="ghost" size="sm">
          <Link to={`/sales/${e.saleId}`}>
            <ExternalLink className="mr-1 h-3 w-3" />
            Venda
          </Link>
        </Button>
      ),
    },
  ]

  const hasFilter =
    debouncedSearch !== '' || method !== 'all' || preset !== 'today'
  const emptyText = hasFilter
    ? 'Nenhuma entrada encontrada pros filtros atuais.'
    : 'Nenhuma entrada de caixa hoje ainda.'

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Search
          value={searchInput}
          onChange={(v) => {
            setSearchInput(v)
            setPage(1)
          }}
          placeholder="Buscar por cliente ou telefone"
        />
        <PageToolbar.Filter label="Período" minWidth={360} priority={10}>
          <ButtonGroup
            value={preset}
            onChange={(v) => {
              setPreset(v)
              setPage(1)
            }}
            options={PRESET_OPTIONS}
            aria-label="Filtrar por período"
          />
        </PageToolbar.Filter>
        <PageToolbar.Filter label="Método" minWidth={420}>
          <ButtonGroup
            value={method}
            onChange={(v) => {
              setMethod(v)
              setPage(1)
            }}
            options={METHOD_OPTIONS}
            aria-label="Filtrar por método"
          />
        </PageToolbar.Filter>
      </PageToolbar>

      {/* Range custom: aparece só quando preset === 'custom' */}
      {preset === 'custom' && (
        <div className="flex items-center gap-3 rounded-md border bg-background px-3 py-2">
          <div className="flex items-center gap-2">
            <Label htmlFor="cashier-from" className="text-xs text-muted-foreground">
              De
            </Label>
            <Input
              id="cashier-from"
              type="date"
              className="h-9 w-40"
              value={customFromDate}
              onChange={(e) => {
                setCustomFromDate(e.target.value)
                setPage(1)
              }}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="cashier-to" className="text-xs text-muted-foreground">
              Até
            </Label>
            <Input
              id="cashier-to"
              type="date"
              className="h-9 w-40"
              value={customToDate}
              onChange={(e) => {
                setCustomToDate(e.target.value)
                setPage(1)
              }}
            />
          </div>
        </div>
      )}

      {/* Cards de resumo: Total + breakdown por método */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-5">
        <div className="flex flex-col gap-0.5 rounded-md border bg-background p-3">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Wallet className="h-3 w-3" />
            Total recebido
          </div>
          <span className="tabular-nums text-lg font-semibold text-success">
            {displayMoney(summary?.totalAmount ?? '0')}
          </span>
          <span className="text-xs text-muted-foreground">
            {summary?.totalCount ?? 0}{' '}
            {(summary?.totalCount ?? 0) === 1 ? 'parcela' : 'parcelas'}
          </span>
        </div>
        {PAYMENT_METHODS.slice(0, 4).map((m) => {
          const row = summary?.byMethod.find((r) => r.paymentMethod === m)
          return (
            <div
              key={m}
              className="flex flex-col gap-0.5 rounded-md border bg-background p-3"
            >
              <span className="text-xs text-muted-foreground">
                {PAYMENT_METHOD_LABELS[m]}
              </span>
              <span className="tabular-nums text-base font-medium">
                {displayMoney(row?.total ?? '0')}
              </span>
              <span className="text-xs text-muted-foreground">
                {row?.count ?? 0}{' '}
                {(row?.count ?? 0) === 1 ? 'parcela' : 'parcelas'}
              </span>
            </div>
          )
        })}
      </div>

      <Table<CashierEntry, never>
        columns={columns}
        data={items}
        rowKey={(e) => e.paymentId}
        isLoading={entriesQuery.isLoading}
        isError={entriesQuery.isError}
        onRetry={() => entriesQuery.refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar entradas de caixa."
        mobileCard={(e) => (
          <Link
            to={`/sales/${e.saleId}`}
            className="flex items-start gap-3 p-4 hover:bg-muted/40"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-medium">{e.clientName}</span>
                <span className="shrink-0 tabular-nums font-medium">
                  {displayMoney(e.amount)}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{displayDateTime(e.paidAt)}</span>
                <span>·</span>
                <span>{PAYMENT_METHOD_LABELS[e.paymentMethod]}</span>
                {e.totalInstallments > 1 && (
                  <>
                    <span>·</span>
                    <span className="tabular-nums">
                      {e.installmentNumber}/{e.totalInstallments}
                    </span>
                  </>
                )}
              </div>
            </div>
          </Link>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'entrada' : 'entradas'}
                {entriesQuery.isFetching ? ' • atualizando…' : ''}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Anterior
                </Button>
                <span className="text-muted-foreground">
                  Página {page} de {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                >
                  Próxima
                </Button>
              </div>
            </>
          ) : null
        }
      />
    </PageContainer>
  )
}
