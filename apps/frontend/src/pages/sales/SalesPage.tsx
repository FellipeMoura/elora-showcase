import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { Table, type TableColumn } from '@/components/data/Table'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useSales } from '@/hooks/useSales'
import {
  SALE_STATUSES,
  type FindSalesQuery,
  type SaleListItem,
  type SaleSortField,
  type SaleStatus,
} from '@/api/sales'
import { displayMoney, displayPhone, displayRelativeTime } from '@/lib/format'
import { useSortState } from '@/lib/sorting'
import {
  SALE_STATUS_BADGE_CLASS,
  SALE_STATUS_LABELS,
} from './saleLabels'

const PAGE_SIZE = 20

type StatusFilter = SaleStatus | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  ...SALE_STATUSES.map((s) => ({ value: s, label: SALE_STATUS_LABELS[s] })),
]

export function SalesPage(): React.ReactElement {
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [page, setPage] = useState(1)
  const { state: sortState, toggleSort } = useSortState<SaleSortField>()

  const query: FindSalesQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedSearch || undefined,
      status: status === 'all' ? undefined : status,
      sortBy: sortState.sortBy ?? undefined,
      sortDir: sortState.sortDir ?? undefined,
    }),
    [page, debouncedSearch, status, sortState.sortBy, sortState.sortDir],
  )

  const { data, isLoading, isError, isFetching, refetch } = useSales(query)

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const columns: TableColumn<SaleListItem, SaleSortField>[] = [
    {
      key: 'status',
      header: 'Status',
      cell: (s) => (
        <div className="flex flex-col items-start gap-0.5">
          <span
            className={`rounded px-1.5 py-0.5 text-xs font-medium ${SALE_STATUS_BADGE_CLASS[s.status]}`}
          >
            {SALE_STATUS_LABELS[s.status]}
          </span>
          {s.overdueInstallments > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-error">
              <AlertTriangle className="h-3 w-3" />
              {s.overdueInstallments} vencida
              {s.overdueInstallments === 1 ? '' : 's'}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Cliente',
      cell: (s) => (
        <div className="flex flex-col">
          <Link
            to={`/clients/${s.clientId}`}
            className="font-medium hover:underline"
          >
            {s.clientName}
          </Link>
          <span className="text-xs text-muted-foreground">
            {displayPhone(s.clientPhoneE164)}
          </span>
        </div>
      ),
    },
    {
      key: 'quote',
      header: 'Orçamento',
      cell: (s) => (
        <Link
          to={`/quotes/${s.quoteId}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          ver orçamento
        </Link>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      sortField: 'totalAmount',
      className: 'text-right tabular-nums',
      cell: (s) => displayMoney(s.totalAmount),
    },
    {
      key: 'paid',
      header: 'Recebido',
      sortField: 'paidAmount',
      className: 'text-right tabular-nums',
      cell: (s) => {
        const total = Number(s.totalAmount)
        const paid = Number(s.paidAmount)
        const pct = total > 0 ? Math.round((paid / total) * 100) : 0
        return (
          <div className="flex flex-col items-end">
            <span>{displayMoney(paid)}</span>
            <span className="text-xs text-muted-foreground">{pct}%</span>
          </div>
        )
      },
    },
    {
      key: 'pending',
      header: 'Parcelas',
      className: 'text-right tabular-nums',
      cell: (s) => (
        <span className="text-muted-foreground">
          {s.pendingInstallments > 0
            ? `${s.pendingInstallments} pendente${s.pendingInstallments === 1 ? '' : 's'}`
            : '—'}
        </span>
      ),
    },
    {
      key: 'closedAt',
      header: 'Fechada',
      sortField: 'closedAt',
      className: 'text-muted-foreground',
      cell: (s) => displayRelativeTime(s.closedAt),
    },
    {
      key: 'open',
      header: '',
      className: 'w-16 text-right',
      cell: (s) => (
        <Button asChild variant="ghost" size="sm">
          <Link to={`/sales/${s.id}`}>Abrir</Link>
        </Button>
      ),
    },
  ]

  const hasFilter = debouncedSearch !== '' || status !== 'all'
  const emptyText = hasFilter
    ? 'Nenhuma venda encontrada pros filtros atuais.'
    : 'Nenhuma venda fechada ainda. Vendas são geradas a partir de orçamentos.'

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
        <PageToolbar.Filter label="Status" minWidth={420} priority={10}>
          <ButtonGroup
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            options={STATUS_OPTIONS}
            aria-label="Filtrar por status"
          />
        </PageToolbar.Filter>
      </PageToolbar>

      <Table<SaleListItem, SaleSortField>
        columns={columns}
        data={items}
        rowKey={(s) => s.id}
        sortField={sortState.sortBy}
        sortDir={sortState.sortDir}
        onSort={toggleSort}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar vendas."
        mobileCard={(s) => (
          <Link
            to={`/sales/${s.id}`}
            className="flex items-start gap-3 p-4 hover:bg-muted/40"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${SALE_STATUS_BADGE_CLASS[s.status]}`}
                >
                  {SALE_STATUS_LABELS[s.status]}
                </span>
                {s.overdueInstallments > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs text-error">
                    <AlertTriangle className="h-3 w-3" />
                    {s.overdueInstallments} vencida
                  </span>
                )}
              </div>
              <div className="truncate font-medium">{s.clientName}</div>
              <div className="text-xs text-muted-foreground">
                {displayPhone(s.clientPhoneE164)}
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-medium tabular-nums">
                  {displayMoney(s.paidAmount)}
                </span>
                <span className="text-xs text-muted-foreground">
                  de {displayMoney(s.totalAmount)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {displayRelativeTime(s.closedAt)}
              </div>
            </div>
          </Link>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'venda' : 'vendas'}
                {isFetching ? ' • atualizando…' : ''}
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
