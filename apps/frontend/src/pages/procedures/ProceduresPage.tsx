import { useMemo, useState } from 'react'
import { Ban, Pencil, Plus, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { RowActions, type RowAction } from '@/components/data/RowActions'
import { Table, type TableColumn } from '@/components/data/Table'
import { useConfirm } from '@/components/ui/confirm-context'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useSortState } from '@/lib/sorting'
import {
  useActivateProcedure,
  useDeactivateProcedure,
  useProcedures,
} from '@/hooks/useProcedures'
import type {
  FindProceduresQuery,
  Procedure,
  ProcedureSortField,
} from '@/api/procedures'
import { ProcedureFormSheet } from './ProcedureFormSheet'
import { apiErrorText } from '@/lib/apiError'

const PAGE_SIZE = 20

type StatusFilter = 'active' | 'inactive' | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
]

// Formatação BRL pra exibição. defaultPrice vem como string ("450.00").
function displayPrice(price: string | null): string {
  if (!price) return '—'
  const n = Number(price)
  if (!Number.isFinite(n)) return price
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  })
}

export function ProceduresPage(): React.ReactElement {
  const confirm = useConfirm()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)
  const { state: sortState, toggleSort } = useSortState<ProcedureSortField>()

  const query: FindProceduresQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedSearch || undefined,
      status,
      sortBy: sortState.sortBy ?? undefined,
      sortDir: sortState.sortDir ?? undefined,
    }),
    [page, debouncedSearch, status, sortState.sortBy, sortState.sortDir],
  )

  const { data, isLoading, isError, isFetching, refetch } = useProcedures(query)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingProcedure, setEditingProcedure] = useState<Procedure | null>(
    null,
  )

  const openCreate = () => {
    setEditingProcedure(null)
    setSheetOpen(true)
  }

  const openEdit = (procedure: Procedure) => {
    setEditingProcedure(procedure)
    setSheetOpen(true)
  }

  const deactivateMutation = useDeactivateProcedure()
  const activateMutation = useActivateProcedure()

  const handleToggleActive = async (p: Procedure) => {
    const ok = await confirm(
      p.active
        ? {
            title: `Desativar ${p.name}?`,
            description:
              'O procedimento fica oculto da lista padrão mas o histórico (orçamentos, sessões) é preservado.',
            confirmLabel: 'Desativar',
            variant: 'destructive',
          }
        : {
            title: `Reativar ${p.name}?`,
            confirmLabel: 'Reativar',
          },
    )
    if (!ok) return

    try {
      if (p.active) {
        await deactivateMutation.mutateAsync(p.id)
        toast.success('Procedimento desativado')
      } else {
        await activateMutation.mutateAsync(p.id)
        toast.success('Procedimento reativado')
      }
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao alterar status do procedimento')
    }
  }

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const rowActions = (p: Procedure): RowAction[] => [
    {
      label: 'Editar',
      icon: <Pencil />,
      onClick: () => openEdit(p),
    },
    {
      label: p.active ? 'Desativar' : 'Reativar',
      icon: p.active ? <Ban /> : <Undo2 />,
      onClick: () => handleToggleActive(p),
      destructive: p.active,
    },
  ]

  const columns: TableColumn<Procedure, ProcedureSortField>[] = [
    {
      key: 'name',
      header: 'Nome',
      sortField: 'name',
      cell: (p) => <span className="font-medium">{p.name}</span>,
    },
    {
      key: 'description',
      header: 'Descrição',
      className: 'text-muted-foreground',
      cell: (p) => (
        <span className="line-clamp-1">{p.description || '—'}</span>
      ),
    },
    {
      key: 'defaultSessions',
      header: 'Sessões padrão',
      sortField: 'defaultSessions',
      className: 'text-muted-foreground',
      cell: (p) => p.defaultSessions,
    },
    {
      key: 'defaultPrice',
      header: 'Preço sugerido',
      sortField: 'defaultPrice',
      className: 'text-muted-foreground',
      cell: (p) => displayPrice(p.defaultPrice),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (p) =>
        p.active ? (
          <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
            Ativo
          </span>
        ) : (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            Inativo
          </span>
        ),
    },
  ]

  const emptyText =
    debouncedSearch || status !== 'active'
      ? 'Nenhum procedimento encontrado pros filtros atuais.'
      : 'Nenhum procedimento cadastrado. Crie o primeiro pela toolbar.'

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Search
          value={searchInput}
          onChange={(v) => {
            setSearchInput(v)
            setPage(1)
          }}
          placeholder="Buscar por nome"
        />
        <PageToolbar.Filter label="Status" minWidth={260}>
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
        <PageToolbar.Action
          icon={<Plus />}
          label="Novo procedimento"
          onClick={openCreate}
        />
      </PageToolbar>

      <Table<Procedure, ProcedureSortField>
        columns={columns}
        data={items}
        rowKey={(p) => p.id}
        actions={rowActions}
        sortField={sortState.sortBy}
        sortDir={sortState.sortDir}
        onSort={toggleSort}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar procedimentos."
        mobileCard={(p, actions) => (
          <div className="flex items-start gap-3 p-4">
            <RowActions actions={actions} className="shrink-0" />
            <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate font-medium">{p.name}</div>
                {p.description && (
                  <div className="truncate text-sm text-muted-foreground">
                    {p.description}
                  </div>
                )}
                <div className="text-sm text-muted-foreground">
                  {p.defaultSessions}× • {displayPrice(p.defaultPrice)}
                </div>
              </div>
              {p.active ? (
                <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
                  Ativo
                </span>
              ) : (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  Inativo
                </span>
              )}
            </div>
          </div>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'procedimento' : 'procedimentos'}
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

      <ProcedureFormSheet
        open={sheetOpen}
        procedure={editingProcedure}
        onOpenChange={setSheetOpen}
      />
    </PageContainer>
  )
}
