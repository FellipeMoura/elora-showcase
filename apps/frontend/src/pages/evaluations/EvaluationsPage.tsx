import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardPen, ExternalLink, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { Table, type TableColumn } from '@/components/data/Table'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useEvaluations } from '@/hooks/useEvaluations'
import {
  EVALUATION_KIND_LABELS,
  EVALUATION_STATUS_BADGE_CLASS,
  EVALUATION_STATUS_LABELS,
  type EvaluationKind,
  type EvaluationListItem,
  type EvaluationSortField,
  type EvaluationStatus,
  type FindEvaluationsQuery,
} from '@/api/evaluations'
import {
  APPOINTMENT_STATUS_BADGE_CLASS,
  APPOINTMENT_STATUS_LABELS,
  formatAppointmentDateTime,
} from '@/pages/appointments/appointmentLabels'
import { displayPhone, displayRelativeTime } from '@/lib/format'
import { useSortState } from '@/lib/sorting'
import { cn } from '@/lib/utils'

// =====================================================================
// EvaluationsPage — listagem global das avaliações do tenant.
//
// Espelha a lógica de mesclagem do EvaluationsSection do ClientDetailPage:
// cada row cruza evaluation + appointment associado (latest não-cancelado).
// Mesclagem é feita no backend (GET /evaluations já vem com client +
// appointment embutidos), evitando N+1 no frontend.
//
// Quando o appointment existe, exibimos o status DELE + horário agendado;
// quando não existe (avaliação standalone), exibimos o status da própria
// evaluation com "Sem agendamento". Mesmo critério visual da section do
// detail.
//
// Criação não aparece aqui — requer journey ativa, então o fluxo continua
// indo de cliente → detail → "Nova avaliação".
// =====================================================================

const PAGE_SIZE = 20

const EVALUATION_STATUSES: readonly EvaluationStatus[] = [
  'pending',
  'performed',
  'cancelled',
] as const

const EVALUATION_KINDS: readonly EvaluationKind[] = [
  'initial',
  'reevaluation',
  'return',
] as const

type StatusFilter = EvaluationStatus | 'all'
type KindFilter = EvaluationKind | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  ...EVALUATION_STATUSES.map((s) => ({
    value: s,
    label: EVALUATION_STATUS_LABELS[s],
  })),
]

const KIND_OPTIONS: ReadonlyArray<{ value: KindFilter; label: string }> = [
  { value: 'all', label: 'Todos' },
  ...EVALUATION_KINDS.map((k) => ({
    value: k,
    label: EVALUATION_KIND_LABELS[k],
  })),
]

export function EvaluationsPage(): React.ReactElement {
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [kind, setKind] = useState<KindFilter>('all')
  const [page, setPage] = useState(1)
  const { state: sortState, toggleSort } = useSortState<EvaluationSortField>()

  const query: FindEvaluationsQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedSearch || undefined,
      status: status === 'all' ? undefined : status,
      kind: kind === 'all' ? undefined : kind,
      sortBy: sortState.sortBy ?? undefined,
      sortDir: sortState.sortDir ?? undefined,
    }),
    [page, debouncedSearch, status, kind, sortState.sortBy, sortState.sortDir],
  )

  const { data, isLoading, isError, isFetching, refetch } = useEvaluations(query)

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const columns: TableColumn<EvaluationListItem, EvaluationSortField>[] = [
    {
      key: 'status',
      header: 'Status',
      cell: (ev) =>
        ev.appointmentId && ev.appointmentStatus ? (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium',
              APPOINTMENT_STATUS_BADGE_CLASS[ev.appointmentStatus],
            )}
          >
            {APPOINTMENT_STATUS_LABELS[ev.appointmentStatus]}
          </span>
        ) : (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium',
              EVALUATION_STATUS_BADGE_CLASS[ev.status],
            )}
          >
            {EVALUATION_STATUS_LABELS[ev.status]}
          </span>
        ),
    },
    {
      key: 'kind',
      header: 'Tipo',
      cell: (ev) => (
        <span className="inline-flex items-center gap-1.5 text-sm">
          <ClipboardPen className="size-4 text-muted-foreground" />
          {EVALUATION_KIND_LABELS[ev.kind]}
        </span>
      ),
    },
    {
      key: 'client',
      header: 'Cliente',
      cell: (ev) => (
        <div className="flex flex-col">
          <Link
            to={`/clients/${ev.clientId}`}
            className="font-medium hover:underline"
          >
            {ev.clientName}
          </Link>
          <span className="text-xs text-muted-foreground">
            {displayPhone(ev.clientPhoneE164)}
          </span>
        </div>
      ),
    },
    {
      key: 'scheduledAt',
      header: 'Agendamento',
      className: 'text-muted-foreground',
      cell: (ev) =>
        ev.appointmentScheduledAt ? (
          formatAppointmentDateTime(ev.appointmentScheduledAt)
        ) : (
          <span className="italic">Sem agendamento</span>
        ),
    },
    {
      key: 'journey',
      header: 'Jornada',
      cell: (ev) => (
        <Link
          to={`/journeys/${ev.journeyId}`}
          className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
        >
          <ExternalLink className="size-3" />
          ver jornada
        </Link>
      ),
    },
    {
      key: 'createdAt',
      header: 'Criada',
      sortField: 'createdAt',
      className: 'text-muted-foreground',
      cell: (ev) => displayRelativeTime(ev.createdAt),
    },
    {
      key: 'forms',
      header: '',
      className: 'w-32 text-right',
      cell: (ev) => (
        <Button asChild variant="ghost" size="sm">
          <Link to={`/evaluations/${ev.id}/forms`}>
            <FileText className="mr-1 size-3.5" />
            Fichas
          </Link>
        </Button>
      ),
    },
  ]

  const hasFilter =
    debouncedSearch !== '' || status !== 'all' || kind !== 'all'
  const emptyText = hasFilter
    ? 'Nenhuma avaliação encontrada pros filtros atuais.'
    : 'Nenhuma avaliação registrada. Crie pela tela do cliente.'

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
        <PageToolbar.Filter label="Tipo" minWidth={360}>
          <ButtonGroup
            value={kind}
            onChange={(v) => {
              setKind(v)
              setPage(1)
            }}
            options={KIND_OPTIONS}
            aria-label="Filtrar por tipo"
          />
        </PageToolbar.Filter>
      </PageToolbar>

      <Table<EvaluationListItem, EvaluationSortField>
        columns={columns}
        data={items}
        rowKey={(ev) => ev.id}
        sortField={sortState.sortBy}
        sortDir={sortState.sortDir}
        onSort={toggleSort}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar avaliações."
        mobileCard={(ev) => (
          <Link
            to={`/evaluations/${ev.id}/forms`}
            className="flex flex-col gap-1.5 p-4 hover:bg-muted/40"
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {ev.appointmentId && ev.appointmentStatus ? (
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-medium',
                    APPOINTMENT_STATUS_BADGE_CLASS[ev.appointmentStatus],
                  )}
                >
                  {APPOINTMENT_STATUS_LABELS[ev.appointmentStatus]}
                </span>
              ) : (
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-medium',
                    EVALUATION_STATUS_BADGE_CLASS[ev.status],
                  )}
                >
                  {EVALUATION_STATUS_LABELS[ev.status]}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {EVALUATION_KIND_LABELS[ev.kind]}
              </span>
            </div>
            <span className="truncate font-medium">{ev.clientName}</span>
            <span className="text-xs text-muted-foreground">
              {displayPhone(ev.clientPhoneE164)}
            </span>
            <span className="text-xs text-muted-foreground">
              {ev.appointmentScheduledAt
                ? formatAppointmentDateTime(ev.appointmentScheduledAt)
                : 'Sem agendamento'}
            </span>
          </Link>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'avaliação' : 'avaliações'}
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
