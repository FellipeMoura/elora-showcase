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
  useActivateEquipment,
  useDeactivateEquipment,
  useEquipments,
} from '@/hooks/useEquipments'
import type {
  Equipment,
  EquipmentSortField,
  FindEquipmentsQuery,
} from '@/api/equipments'
import { EquipmentFormSheet } from './EquipmentFormSheet'
import { apiErrorText } from '@/lib/apiError'

const PAGE_SIZE = 20

type StatusFilter = 'active' | 'inactive' | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
]

export function EquipmentsPage(): React.ReactElement {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)
  const { state: sortState, toggleSort } = useSortState<EquipmentSortField>()

  const query: FindEquipmentsQuery = useMemo(
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

  const { data, isLoading, isError, isFetching, refetch } = useEquipments(query)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingEquipment, setEditingEquipment] = useState<Equipment | null>(
    null,
  )

  const openCreate = () => {
    setEditingEquipment(null)
    setSheetOpen(true)
  }

  const openEdit = (equipment: Equipment) => {
    setEditingEquipment(equipment)
    setSheetOpen(true)
  }

  const deactivateMutation = useDeactivateEquipment()
  const activateMutation = useActivateEquipment()

  const handleToggleActive = async (e: Equipment) => {
    const ok = await confirm(
      e.active
        ? {
            title: `Desativar ${e.name}?`,
            description:
              'O equipamento fica oculto da seleção padrão mas o histórico de agendamentos é preservado.',
            confirmLabel: 'Desativar',
            variant: 'destructive',
          }
        : {
            title: `Reativar ${e.name}?`,
            confirmLabel: 'Reativar',
          },
    )
    if (!ok) return

    try {
      if (e.active) {
        await deactivateMutation.mutateAsync(e.id)
        toast.success('Equipamento desativado')
      } else {
        await activateMutation.mutateAsync(e.id)
        toast.success('Equipamento reativado')
      }
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao alterar status do equipamento')
    }
  }

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const rowActions = (e: Equipment): RowAction[] => [
    { label: 'Editar', icon: <Pencil />, onClick: () => openEdit(e) },
    {
      label: e.active ? 'Desativar' : 'Reativar',
      icon: e.active ? <Ban /> : <Undo2 />,
      onClick: () => handleToggleActive(e),
      destructive: e.active,
    },
  ]

  const columns: TableColumn<Equipment, EquipmentSortField>[] = [
    {
      key: 'name',
      header: 'Nome',
      sortField: 'name',
      cell: (e) => <span className="font-medium">{e.name}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (e) =>
        e.active ? (
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
      ? 'Nenhum equipamento encontrado pros filtros atuais.'
      : 'Nenhum equipamento cadastrado. Crie o primeiro pela toolbar — selecioná-lo em agendamentos é opcional.'

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
          label="Novo equipamento"
          onClick={openCreate}
        />
      </PageToolbar>

      <Table<Equipment, EquipmentSortField>
        columns={columns}
        data={items}
        rowKey={(e) => e.id}
        actions={rowActions}
        sortField={sortState.sortBy}
        sortDir={sortState.sortDir}
        onSort={toggleSort}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar equipamentos."
        mobileCard={(e, actions) => (
          <div className="flex items-start gap-3 p-4">
            <RowActions actions={actions} className="shrink-0" />
            <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
              <div className="truncate font-medium">{e.name}</div>
              {e.active ? (
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
                {total} {total === 1 ? 'equipamento' : 'equipamentos'}
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

      <EquipmentFormSheet
        open={sheetOpen}
        equipment={editingEquipment}
        onOpenChange={setSheetOpen}
      />
    </PageContainer>
  )
}
