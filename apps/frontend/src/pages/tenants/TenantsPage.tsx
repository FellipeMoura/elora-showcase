import { useMemo, useState } from 'react'
import { Pencil, Plus } from 'lucide-react'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { RowActions, type RowAction } from '@/components/data/RowActions'
import { Table, type TableColumn } from '@/components/data/Table'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useTenants } from '@/hooks/useTenants'
import type { TenantSummary } from '@/api/tenants'
import { TenantFormSheet } from './TenantFormSheet'

// Sem paginação — admin scope com dezenas de tenants. Busca é client-side
// por nome/slug; ordem default vem do backend (nome asc).
export function TenantsPage(): React.ReactElement {
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim().toLowerCase(), 200)

  const { data, isLoading, isError, isFetching, refetch } = useTenants()

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const openCreate = (): void => {
    setEditingId(null)
    setSheetOpen(true)
  }

  const openEdit = (t: TenantSummary): void => {
    setEditingId(t.id)
    setSheetOpen(true)
  }

  const filtered = useMemo(() => {
    const all = data ?? []
    if (!debouncedSearch) return all
    return all.filter(
      (t) =>
        t.name.toLowerCase().includes(debouncedSearch) ||
        t.slug.toLowerCase().includes(debouncedSearch),
    )
  }, [data, debouncedSearch])

  const rowActions = (t: TenantSummary): RowAction[] => [
    {
      label: 'Editar',
      icon: <Pencil />,
      onClick: () => openEdit(t),
    },
  ]

  const columns: TableColumn<TenantSummary>[] = [
    {
      key: 'name',
      header: 'Nome',
      cell: (t) => <span className="font-medium">{t.name}</span>,
    },
    {
      key: 'slug',
      header: 'Slug',
      className: 'text-muted-foreground font-mono text-xs',
      cell: (t) => t.slug,
    },
  ]

  const emptyText = debouncedSearch
    ? 'Nenhum tenant encontrado pra esta busca.'
    : 'Nenhum tenant cadastrado ainda. Crie o primeiro pela toolbar.'

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Search
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Buscar por nome ou slug"
        />
        <PageToolbar.Action
          icon={<Plus />}
          label="Novo tenant"
          onClick={openCreate}
        />
      </PageToolbar>

      <Table<TenantSummary>
        columns={columns}
        data={filtered}
        rowKey={(t) => t.id}
        actions={rowActions}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar tenants."
        mobileCard={(t, actions) => (
          <div className="flex items-start gap-3 p-4">
            <RowActions actions={actions} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{t.name}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">
                {t.slug}
              </div>
            </div>
          </div>
        )}
        footer={
          (data?.length ?? 0) > 0 ? (
            <div className="text-muted-foreground">
              {filtered.length} de {data?.length ?? 0}{' '}
              {(data?.length ?? 0) === 1 ? 'tenant' : 'tenants'}
              {isFetching ? ' • atualizando…' : ''}
            </div>
          ) : null
        }
      />

      <TenantFormSheet
        open={sheetOpen}
        tenantId={editingId}
        onOpenChange={setSheetOpen}
      />
    </PageContainer>
  )
}
