import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Ban, Pencil, Plus, Shield, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { RowActions, type RowAction } from '@/components/data/RowActions'
import { Table, type TableColumn } from '@/components/data/Table'
import { useConfirm } from '@/components/ui/confirm-context'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useGroups } from '@/hooks/useGroups'
import {
  useActivateUser,
  useDeactivateUser,
  useUsers,
} from '@/hooks/useUsers'
import type { Group } from '@/api/groups'
import type { FindUsersQuery, User } from '@/api/users'
import { UserFormSheet } from './UserFormSheet'
import { GroupsSheet } from './GroupsSheet'
import { apiErrorText } from '@/lib/apiError'

const PAGE_SIZE = 20

type StatusFilter = 'active' | 'inactive' | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
]

export function UsersPage(): React.ReactElement {
  const confirm = useConfirm()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)

  const query: FindUsersQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedSearch || undefined,
      status,
    }),
    [page, debouncedSearch, status],
  )

  const { data, isLoading, isError, isFetching, refetch } = useUsers(query)
  // Catálogo global de grupos: usado pra resolver groupIds → nomes na coluna
  // "Grupos". Cache longo (5 min) compartilhado com UserFormSheet / GroupsSheet.
  const { data: groups } = useGroups()
  const groupById = useMemo(() => {
    const map = new Map<string, Group>()
    for (const g of groups ?? []) map.set(g.id, g)
    return map
  }, [groups])

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<User | null>(null)

  const [groupsSheetOpen, setGroupsSheetOpen] = useState(false)

  const openCreate = () => {
    setEditingUser(null)
    setSheetOpen(true)
  }

  const openEdit = (user: User) => {
    setEditingUser(user)
    setSheetOpen(true)
  }

  const deactivateMutation = useDeactivateUser()
  const activateMutation = useActivateUser()

  const handleToggleActive = async (user: User) => {
    const ok = await confirm(
      user.active
        ? {
            title: `Desativar ${user.name}?`,
            description:
              'O usuário não conseguirá mais fazer login, mas histórico é preservado.',
            confirmLabel: 'Desativar',
            variant: 'destructive',
          }
        : {
            title: `Reativar ${user.name}?`,
            confirmLabel: 'Reativar',
          },
    )
    if (!ok) return

    try {
      if (user.active) {
        await deactivateMutation.mutateAsync(user.id)
        toast.success('Usuário desativado')
      } else {
        await activateMutation.mutateAsync(user.id)
        toast.success('Usuário reativado')
      }
    } catch (err) {
      const message =
        apiErrorText(err)
      toast.error(message ?? 'Erro ao alterar status do usuário')
    }
  }

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const rowActions = (u: User): RowAction[] => [
    {
      label: 'Editar',
      icon: <Pencil />,
      onClick: () => openEdit(u),
    },
    {
      label: u.active ? 'Desativar' : 'Reativar',
      icon: u.active ? <Ban /> : <Undo2 />,
      onClick: () => handleToggleActive(u),
      destructive: u.active,
    },
  ]

  const columns: TableColumn<User>[] = [
    {
      key: 'name',
      header: 'Nome',
      cell: (u) => <span className="font-medium">{u.name}</span>,
    },
    {
      key: 'username',
      header: 'Usuário',
      className: 'text-muted-foreground font-mono text-xs',
      cell: (u) => u.username,
    },
    {
      key: 'groups',
      header: 'Grupos',
      cell: (u) => <UserGroupsCell groupIds={u.groupIds} groupById={groupById} />,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (u) =>
        u.active ? (
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
      ? 'Nenhum usuário encontrado pros filtros atuais.'
      : 'Nenhum usuário ainda. Crie o primeiro pela toolbar.'

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Search
          value={searchInput}
          onChange={(v) => {
            setSearchInput(v)
            setPage(1)
          }}
          placeholder="Buscar por nome ou usuário"
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
        {/* Grupos é catálogo de leitura/super-admin — vive em sheet acessada
            pela toolbar pra evitar item exclusivo no menu lateral. */}
        <PageToolbar.Action
          icon={<Shield />}
          label="Grupos"
          variant="outline"
          onClick={() => setGroupsSheetOpen(true)}
        />
        <PageToolbar.Action
          icon={<Plus />}
          label="Novo usuário"
          onClick={openCreate}
        />
      </PageToolbar>

      <Table<User>
        columns={columns}
        data={items}
        rowKey={(u) => u.id}
        actions={rowActions}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar usuários."
        mobileCard={(u, actions) => (
          <div className="flex items-start gap-3 p-4">
            <RowActions actions={actions} className="shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <span className="truncate font-medium">{u.name}</span>
                {u.active ? (
                  <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
                    Ativo
                  </span>
                ) : (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Inativo
                  </span>
                )}
              </div>
              <div className="truncate font-mono text-xs text-muted-foreground">
                {u.username}
              </div>
              <UserGroupsCell groupIds={u.groupIds} groupById={groupById} />
            </div>
          </div>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'usuário' : 'usuários'}
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

      <UserFormSheet
        open={sheetOpen}
        user={editingUser}
        onOpenChange={setSheetOpen}
      />
      <GroupsSheet open={groupsSheetOpen} onOpenChange={setGroupsSheetOpen} />
    </PageContainer>
  )
}

// Lista compacta de grupos com chip pra cada — resolve groupId → nome via
// cache de useGroups(). Mostra placeholder quando user não tem nenhum.
function UserGroupsCell({
  groupIds,
  groupById,
}: {
  groupIds: string[]
  groupById: Map<string, Group>
}): React.ReactElement {
  if (groupIds.length === 0) {
    return (
      <span className="text-xs italic text-muted-foreground">Sem grupos</span>
    )
  }
  return (
    <div className="flex flex-wrap gap-1">
      {groupIds.map((id) => {
        const g = groupById.get(id)
        const label = g?.name ?? id.slice(0, 8)
        return (
          <span
            key={id}
            className="rounded bg-tertiary px-1.5 py-0.5 text-xs font-medium text-tertiary-foreground"
            title={g?.description ?? undefined}
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}
