import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { type RowAction } from '@/components/data/RowActions'
import { Table, type TableColumn } from '@/components/data/Table'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useSortState } from '@/lib/sorting'
import { displayRelativeTime } from '@/lib/format'
import { useJourneys } from '@/hooks/useJourneys'
import {
  JOURNEY_SOURCES,
  JOURNEY_STAGES,
  type FindJourneysQuery,
  type Journey,
  type JourneySortField,
  type JourneySource,
  type JourneyStage,
  type JourneyStatus,
} from '@/api/journeys'
import { ClientLabel } from './ClientLabel'
import {
  SOURCE_LABELS,
  STAGE_BADGE_CLASS,
  STAGE_LABELS,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
} from './journeyLabels'

const PAGE_SIZE = 20

type StatusFilter = JourneyStatus | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Ativas' },
  { value: 'won', label: 'Ganhas' },
  { value: 'lost', label: 'Perdidas' },
  { value: 'all', label: 'Todas' },
]

const STAGE_OPTIONS: ReadonlyArray<{ value: JourneyStage | 'all'; label: string }> =
  [
    { value: 'all', label: 'Todos' },
    ...JOURNEY_STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] })),
  ]

const SOURCE_OPTIONS: ReadonlyArray<{ value: JourneySource | 'all'; label: string }> =
  [
    { value: 'all', label: 'Todas' },
    ...JOURNEY_SOURCES.map((s) => ({ value: s, label: SOURCE_LABELS[s] })),
  ]

export function JourneysPage(): React.ReactElement {
  const navigate = useNavigate()

  const [status, setStatus] = useState<StatusFilter>('active')
  const [stage, setStage] = useState<JourneyStage | 'all'>('all')
  const [source, setSource] = useState<JourneySource | 'all'>('all')
  const [page, setPage] = useState(1)
  const { state: sortState, toggleSort } = useSortState<JourneySortField>()

  const query: FindJourneysQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      status,
      stage: stage === 'all' ? undefined : stage,
      source: source === 'all' ? undefined : source,
      sortBy: sortState.sortBy ?? undefined,
      sortDir: sortState.sortDir ?? undefined,
    }),
    [page, status, stage, source, sortState.sortBy, sortState.sortDir],
  )

  const { data, isLoading, isError, isFetching, refetch } = useJourneys(query)

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const rowActions = (j: Journey): RowAction[] => [
    {
      label: 'Ver detalhes',
      icon: <Eye />,
      onClick: () => navigate(`/journeys/${j.id}`),
    },
  ]

  const columns: TableColumn<Journey, JourneySortField>[] = [
    {
      key: 'client',
      header: 'Cliente',
      cell: (j) => <ClientLabel clientId={j.clientId} showPhone />,
    },
    {
      key: 'stage',
      header: 'Estágio',
      sortField: 'stage',
      cell: (j) => (
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${STAGE_BADGE_CLASS[j.stage]}`}
        >
          {STAGE_LABELS[j.stage]}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortField: 'status',
      cell: (j) => (
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[j.status]}`}
        >
          {STATUS_LABELS[j.status]}
          {j.status === 'lost' && j.lostReason ? ` · ${j.lostReason}` : ''}
        </span>
      ),
    },
    {
      key: 'source',
      header: 'Origem',
      className: 'text-muted-foreground',
      cell: (j) => SOURCE_LABELS[j.source],
    },
    {
      key: 'lastActivity',
      header: 'Última atividade',
      sortField: 'lastActivityAt',
      className: 'text-muted-foreground',
      cell: (j) => displayRelativeTime(j.lastActivityAt),
    },
    {
      key: 'createdAt',
      header: 'Criada',
      sortField: 'createdAt',
      className: 'text-muted-foreground',
      cell: (j) => displayRelativeTime(j.createdAt),
    },
  ]

  const emptyText =
    status !== 'active' || stage !== 'all' || source !== 'all'
      ? 'Nenhuma jornada encontrada pros filtros atuais.'
      : 'Nenhuma jornada ativa. Inbound do WhatsApp ou criação manual gera leads.'

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Filter label="Status" minWidth={320}>
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
        <PageToolbar.Filter label="Estágio" minWidth={460}>
          <ButtonGroup
            value={stage}
            onChange={(v) => {
              setStage(v)
              setPage(1)
            }}
            options={STAGE_OPTIONS}
            aria-label="Filtrar por estágio"
          />
        </PageToolbar.Filter>
        <PageToolbar.Filter label="Origem" minWidth={520} priority={-1}>
          <ButtonGroup
            value={source}
            onChange={(v) => {
              setSource(v)
              setPage(1)
            }}
            options={SOURCE_OPTIONS}
            aria-label="Filtrar por origem"
          />
        </PageToolbar.Filter>
      </PageToolbar>

      <Table<Journey, JourneySortField>
        columns={columns}
        data={items}
        rowKey={(j) => j.id}
        actions={rowActions}
        sortField={sortState.sortBy}
        sortDir={sortState.sortDir}
        onSort={toggleSort}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar jornadas."
        mobileCard={(j) => (
          <button
            type="button"
            onClick={() => navigate(`/journeys/${j.id}`)}
            className="flex w-full items-start gap-3 p-4 text-left hover:bg-accent/30"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <ClientLabel clientId={j.clientId} showPhone />
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${STAGE_BADGE_CLASS[j.stage]}`}
                >
                  {STAGE_LABELS[j.stage]}
                </span>
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[j.status]}`}
                >
                  {STATUS_LABELS[j.status]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {SOURCE_LABELS[j.source]} · {displayRelativeTime(j.lastActivityAt)}
                </span>
              </div>
            </div>
          </button>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'jornada' : 'jornadas'}
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
