import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Ban, Pencil, Plus, Undo2 } from 'lucide-react'
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
  useActivateUnit,
  useDeactivateUnit,
  useUnits,
} from '@/hooks/useUnits'
import type { FindUnitsQuery, Unit, UnitSortField } from '@/api/units'
import { UnitFormSheet } from './UnitFormSheet'
import { apiErrorText } from '@/lib/apiError'

const PAGE_SIZE = 20

type StatusFilter = 'active' | 'inactive' | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Ativas' },
  { value: 'inactive', label: 'Inativas' },
  { value: 'all', label: 'Todas' },
]

export function UnitsPage(): React.ReactElement {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)
  const { state: sortState, toggleSort } = useSortState<UnitSortField>()

  const query: FindUnitsQuery = useMemo(
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

  const { data, isLoading, isError, isFetching, refetch } = useUnits(query)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null)

  const openCreate = () => {
    setEditingUnit(null)
    setSheetOpen(true)
  }

  const openEdit = (unit: Unit) => {
    setEditingUnit(unit)
    setSheetOpen(true)
  }

  const deactivateMutation = useDeactivateUnit()
  const activateMutation = useActivateUnit()

  const handleToggleActive = async (u: Unit) => {
    const ok = await confirm(
      u.active
        ? {
            title: `Desativar ${u.name}?`,
            description:
              'A sala fica oculta da seleção padrão mas o histórico de agendamentos é preservado.',
            confirmLabel: 'Desativar',
            variant: 'destructive',
          }
        : {
            title: `Reativar ${u.name}?`,
            confirmLabel: 'Reativar',
          },
    )
    if (!ok) return

    try {
      if (u.active) {
        await deactivateMutation.mutateAsync(u.id)
        toast.success('Sala desativada')
      } else {
        await activateMutation.mutateAsync(u.id)
        toast.success('Sala reativada')
      }
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao alterar status da sala')
    }
  }

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const rowActions = (u: Unit): RowAction[] => [
    { label: 'Editar', icon: <Pencil />, onClick: () => openEdit(u) },
    {
      label: u.active ? 'Desativar' : 'Reativar',
      icon: u.active ? <Ban /> : <Undo2 />,
      onClick: () => handleToggleActive(u),
      destructive: u.active,
    },
  ]

  const columns: TableColumn<Unit, UnitSortField>[] = [
    {
      key: 'name',
      header: 'Nome',
      sortField: 'name',
      cell: (u) => <span className="font-medium">{u.name}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (u) =>
        u.active ? (
          <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
            Ativa
          </span>
        ) : (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            Inativa
          </span>
        ),
    },
  ]

  const emptyText =
    debouncedSearch || status !== 'active'
      ? 'Nenhuma sala encontrada pros filtros atuais.'
      : 'Nenhuma sala cadastrada. Crie a primeira pela toolbar — selecioná-la em agendamentos é opcional.'

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Action
          icon={<ArrowLeft />}
          onClick={() => navigate('/agenda')}
          variant="ghost"
          placement="leading"
          aria-label="Voltar para agenda"
        />
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
          label="Nova sala"
          onClick={openCreate}
        />
      </PageToolbar>

      <Table<Unit, UnitSortField>
        columns={columns}
        data={items}
        rowKey={(u) => u.id}
        actions={rowActions}
        sortField={sortState.sortBy}
        sortDir={sortState.sortDir}
        onSort={toggleSort}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar salas."
        mobileCard={(u, actions) => (
          <div className="flex items-start gap-3 p-4">
            <RowActions actions={actions} className="shrink-0" />
            <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
              <div className="truncate font-medium">{u.name}</div>
              {u.active ? (
                <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
                  Ativa
                </span>
              ) : (
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                  Inativa
                </span>
              )}
            </div>
          </div>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'sala' : 'salas'}
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

      <UnitFormSheet
        open={sheetOpen}
        unit={editingUnit}
        onOpenChange={setSheetOpen}
      />
    </PageContainer>
  )
}
