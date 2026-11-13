import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SquareArrowOutUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { RowActions, type RowAction } from '@/components/data/RowActions'
import { Table, type TableColumn } from '@/components/data/Table'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useTreatments } from '@/hooks/useTreatments'
import type {
  FindTreatmentsQuery,
  TreatmentListItem,
  TreatmentSortField,
  TreatmentStatus,
} from '@/api/treatments'
import { displayRelativeTime } from '@/lib/format'
import { useSortState } from '@/lib/sorting'
import { cn } from '@/lib/utils'
import {
  TREATMENT_STATUS_BADGE_CLASS,
  TREATMENT_STATUS_LABELS,
} from './treatmentLabels'

const PAGE_SIZE = 20

type StatusFilter = TreatmentStatus | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Ativos' },
  { value: 'completed', label: 'Concluídos' },
  { value: 'manually_closed', label: 'Fechados' },
  { value: 'all', label: 'Todos' },
]

export function TreatmentsPage(): React.ReactElement {
  const navigate = useNavigate()
  const [status, setStatus] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)
  const { state: sortState, toggleSort } = useSortState<TreatmentSortField>()

  const query: FindTreatmentsQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      status: status === 'all' ? undefined : status,
      sortBy: sortState.sortBy ?? undefined,
      sortDir: sortState.sortDir ?? undefined,
    }),
    [page, status, sortState.sortBy, sortState.sortDir],
  )

  const { data, isLoading, isError, isFetching, refetch } = useTreatments(query)

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const rowActions = (t: TreatmentListItem): RowAction[] => [
    {
      label: 'Abrir detalhes',
      icon: <SquareArrowOutUpRight />,
      onClick: () => navigate(`/treatments/${t.id}`),
    },
  ]

  const columns: TableColumn<TreatmentListItem, TreatmentSortField>[] = [
    {
      key: 'client',
      header: 'Cliente',
      cell: (t) => <span className="font-medium">{t.clientName}</span>,
    },
    {
      key: 'name',
      header: 'Tratamento',
      cell: (t) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate">{t.name}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium',
              TREATMENT_STATUS_BADGE_CLASS[t.status],
            )}
          >
            {TREATMENT_STATUS_LABELS[t.status]}
          </span>
        </div>
      ),
    },
    {
      key: 'progress',
      header: 'Progresso',
      className: 'text-muted-foreground',
      cell: (t) => <ProgressCell item={t} />,
    },
    {
      key: 'startedAt',
      header: 'Iniciado',
      sortField: 'startedAt',
      className: 'text-muted-foreground',
      cell: (t) =>
        t.startedAt ? displayRelativeTime(t.startedAt) : '—',
    },
    {
      key: 'updatedAt',
      header: 'Atualizado',
      sortField: 'updatedAt',
      className: 'text-muted-foreground',
      cell: (t) => displayRelativeTime(t.updatedAt),
    },
  ]

  const emptyText =
    status === 'active'
      ? 'Nenhum tratamento ativo. Marcar a 1ª presença de uma sessão vendida cria o tratamento automaticamente.'
      : 'Nenhum tratamento encontrado pros filtros atuais.'

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Filter label="Status" minWidth={400}>
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

      <Table<TreatmentListItem, TreatmentSortField>
        columns={columns}
        data={items}
        rowKey={(t) => t.id}
        actions={rowActions}
        sortField={sortState.sortBy}
        sortDir={sortState.sortDir}
        onSort={toggleSort}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar tratamentos."
        mobileCard={(t, actions) => (
          <div className="flex items-start gap-3 p-4">
            <RowActions actions={actions} className="shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate font-medium">{t.clientName}</span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-medium',
                    TREATMENT_STATUS_BADGE_CLASS[t.status],
                  )}
                >
                  {TREATMENT_STATUS_LABELS[t.status]}
                </span>
              </div>
              <span className="truncate text-sm text-muted-foreground">
                {t.name}
              </span>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <ProgressCell item={t} />
                <span>
                  Iniciado{' '}
                  {t.startedAt ? displayRelativeTime(t.startedAt) : '—'}
                </span>
              </div>
            </div>
          </div>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'tratamento' : 'tratamentos'}
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

function ProgressCell({ item }: { item: TreatmentListItem }): React.ReactElement {
  const { sessionsDone, sessionsTotal } = item
  const pct =
    sessionsTotal > 0 ? Math.round((sessionsDone / sessionsTotal) * 100) : 0
  return (
    <span className="inline-flex items-center gap-2">
      <span>
        {sessionsDone}/{sessionsTotal}{' '}
        {sessionsTotal === 1 ? 'sessão' : 'sessões'}
      </span>
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full bg-success transition-all"
          style={{ width: `${pct}%` }}
        />
      </span>
    </span>
  )
}
