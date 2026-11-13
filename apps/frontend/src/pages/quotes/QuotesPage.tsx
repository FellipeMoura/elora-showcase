import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Banknote, FileText, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { Table, type TableColumn } from '@/components/data/Table'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useQuotes } from '@/hooks/useQuotes'
import {
  QUOTE_ORIGINS,
  QUOTE_STATUSES,
  type FindQuotesQuery,
  type QuoteListItem,
  type QuoteOrigin,
  type QuoteSortField,
  type QuoteStatus,
} from '@/api/quotes'
import { displayMoney, displayPhone, displayRelativeTime } from '@/lib/format'
import { useSortState } from '@/lib/sorting'
import {
  ORIGIN_LABELS,
  STATUS_LABELS,
} from './quoteLabels'
import { QuoteFormSheet } from './QuoteFormSheet'

const PAGE_SIZE = 20

type StatusFilter = QuoteStatus | 'all'
type OriginFilter = QuoteOrigin | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  ...QUOTE_STATUSES.map((s) => ({ value: s, label: STATUS_LABELS[s] })),
]

const ORIGIN_OPTIONS: ReadonlyArray<{ value: OriginFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  ...QUOTE_ORIGINS.map((o) => ({ value: o, label: ORIGIN_LABELS[o] })),
]

export function QuotesPage(): React.ReactElement {
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [origin, setOrigin] = useState<OriginFilter>('all')
  const [page, setPage] = useState(1)
  const { state: sortState, toggleSort } = useSortState<QuoteSortField>()

  const query: FindQuotesQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedSearch || undefined,
      status: status === 'all' ? undefined : status,
      origin: origin === 'all' ? undefined : origin,
      sortBy: sortState.sortBy ?? undefined,
      sortDir: sortState.sortDir ?? undefined,
    }),
    [page, debouncedSearch, status, origin, sortState.sortBy, sortState.sortDir],
  )

  const { data, isLoading, isError, isFetching, refetch } = useQuotes(query)

  const [sheetOpen, setSheetOpen] = useState(false)

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const columns: TableColumn<QuoteListItem, QuoteSortField>[] = [
     {
      key: 'status',
      header: '',
      // Quote accepted sempre tem sale 1:1. Trocamos o chip por um botão que
      // navega pro detalhe da venda — auditoria do admin segue acessível
      // em /sales, mas o fluxo normal entra pelo orçamento.
      cell: (q) =>
        q.status === 'accepted' && q.saleId ? (
          <Button
            asChild
            size="sm"
            className="h-7 gap-1 bg-success/20 text-success hover:bg-success/10"
          >

            <Link to={ q.status === 'accepted' && q.saleId ? `/sales/${q.saleId}` : `/quotes/${q.id}`}>
              <Banknote className="h-3.5 w-3.5" />
              Venda
            </Link>
          </Button>
        ) : (
          <Button
            asChild
            size="sm"
            className="h-7 gap-1 bg-primary/20 text-primary hover:bg-primary/10"
          >

            <Link to={ q.status === 'accepted' && q.saleId ? `/sales/${q.saleId}` : `/quotes/${q.id}`}>
              <FileText className="h-3.5 w-3.5" />
              Aberto
            </Link>
          </Button>
        ),
    },
    {
      key: 'client',
      header: 'Cliente',
      cell: (q) => (
        <div className="flex flex-col">
          <Link
            to={`/clients/${q.clientId}`}
            className="font-medium hover:underline"
          >
            {q.clientName}
          </Link>
          <span className="text-xs text-muted-foreground">
            {displayPhone(q.clientPhoneE164)}
          </span>
        </div>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      sortField: 'totalAmount',
      className: 'text-right tabular-nums',
      // Quando há venda fechada, exibe o total efetivamente vendido (pode
      // divergir do quote por items "perdidos" no fechamento) destacado em
      // success. Sem venda: total do quote em estilo neutro.
      cell: (q) =>
        q.saleTotalAmount != null ? (
          <span className="font-semibold text-success">
            {displayMoney(q.saleTotalAmount)}
          </span>
        ) : (
          displayMoney(q.totalAmount)
        ),
    },
    {
      key: 'createdAt',
      header: 'Criado em',
      sortField: 'createdAt',
      className: 'text-muted-foreground',
      cell: (q) => (
        <div className="flex flex-col">
          <span>{new Date(q.createdAt).toLocaleDateString('pt-BR')}</span>
          {q.saleClosedAt && (
            <span className="text-xs font-semibold text-success">
              Vendido: {displayRelativeTime(q.saleClosedAt)}
            </span>
          )}
        </div>
      ),
    },
  ]

  const hasFilter =
    debouncedSearch !== '' || status !== 'all' || origin !== 'all'
  const emptyText = hasFilter
    ? 'Nenhum orçamento encontrado pros filtros atuais.'
    : 'Nenhum orçamento ainda. Crie o primeiro pela toolbar.'

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
        <PageToolbar.Filter label="Status" minWidth={460} priority={10}>
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
        <PageToolbar.Filter label="Origem" minWidth={380}>
          <ButtonGroup
            value={origin}
            onChange={(v) => {
              setOrigin(v)
              setPage(1)
            }}
            options={ORIGIN_OPTIONS}
            aria-label="Filtrar por origem"
          />
        </PageToolbar.Filter>
        <PageToolbar.Action
          icon={<Plus />}
          label="Novo orçamento"
          onClick={() => setSheetOpen(true)}
        />
      </PageToolbar>

      <Table<QuoteListItem, QuoteSortField>
        columns={columns}
        data={items}
        rowKey={(q) => q.id}
        sortField={sortState.sortBy}
        sortDir={sortState.sortDir}
        onSort={toggleSort}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar orçamentos."
        mobileCard={(q) => (
          <div className="flex items-start gap-3 p-4" onClick={() => navigate(q.status === 'accepted' && q.saleId ? `/sales/${q.saleId}` : `/quotes/${q.id}`)}>
            
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center gap-2">
                {q.status === 'accepted' && q.saleId ? (
          <Button
            asChild
            size="sm"
            className="h-7 gap-1 bg-success/20 text-success hover:bg-success/10"
          >

            <Link to={ q.status === 'accepted' && q.saleId ? `/sales/${q.saleId}` : `/quotes/${q.id}`}>
              <Banknote className="h-3.5 w-3.5" />
              Venda
            </Link>
          </Button>
        ) : (
          <Button
            asChild
            size="sm"
            className="h-7 gap-1 bg-primary/20 text-primary hover:bg-primary/10"
          >

            <Link to={ q.status === 'accepted' && q.saleId ? `/sales/${q.saleId}` : `/quotes/${q.id}`}>
              <FileText className="h-3.5 w-3.5" />
              Aberto
            </Link>
          </Button>
        )}
              </div>
              <div className="truncate font-medium">{q.clientName}</div>
              <div className="text-xs text-muted-foreground">
                {displayPhone(q.clientPhoneE164)}
              </div>
              {q.saleTotalAmount != null ? (
                <div className="font-semibold tabular-nums text-success">
                  {displayMoney(q.saleTotalAmount)}
                </div>
              ) : (
                <div className="font-medium tabular-nums">
                  {displayMoney(q.totalAmount)}
                </div>
              )}
              <div className="text-xs text-muted-foreground">
                {new Date(q.createdAt).toLocaleDateString('pt-BR')}
                {q.saleClosedAt && (
                  <span className="ml-1 font-semibold text-success">
                    • Vendido: {displayRelativeTime(q.saleClosedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'orçamento' : 'orçamentos'}
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

      <QuoteFormSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </PageContainer>
  )
}
