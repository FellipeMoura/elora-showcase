import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  Ban,
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  PlusSquare,
  Trash2,
  Undo2,
} from 'lucide-react'
import { ButtonGroup } from '@/components/ui/button-group'
import { type RowAction } from '@/components/data/RowActions'
import { SubTable, type SubTableColumn } from '@/components/data/SubTable'
import { Table, type TableColumn } from '@/components/data/Table'
import { useConfirm } from '@/components/ui/confirm-context'
import LucideIcon from '@/components/layout/LucideIcon'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  useActivateMenu,
  useDeactivateMenu,
  useDeleteMenu,
  useMenuTree,
} from '@/hooks/useMenus'
import type { Menu, MenuNode } from '@/api/menus'
import { MenuFormSheet } from './MenuFormSheet'
import { apiErrorText } from '@/lib/apiError'

type StatusFilter = 'active' | 'inactive' | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
]

export function MenusPage(): React.ReactElement {
  const confirm = useConfirm()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim().toLowerCase(), 300)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingMenu, setEditingMenu] = useState<Menu | null>(null)
  const [defaultParentId, setDefaultParentId] = useState<string | null>(null)

  const { data: tree = [], isLoading, isError, isFetching, refetch } =
    useMenuTree()

  const deactivateMutation = useDeactivateMenu()
  const activateMutation = useActivateMenu()
  const deleteMutation = useDeleteMenu()

  // Aplica filtros no cliente — tree é pequena (dezenas de itens),
  // não precisa de paginação/servidor pra essa tela.
  const filtered = useMemo(() => {
    const matchStatus = (m: MenuNode) =>
      status === 'all' ? true : status === 'active' ? m.active : !m.active

    const matchSearch = (m: MenuNode) =>
      !debouncedSearch ||
      m.label.toLowerCase().includes(debouncedSearch) ||
      (m.path ?? '').toLowerCase().includes(debouncedSearch)

    return tree
      .filter((parent) => {
        // Inclui o pai se: (a) pai bate, OU (b) algum filho bate (mesmo
        // status do filtro). Garante que busca em "schedule/list" mostra
        // a hierarquia toda — não esconde o pai.
        const parentMatches = matchSearch(parent) && matchStatus(parent)
        const childMatches = parent.children.some(
          (c) => matchSearch(c) && matchStatus(c),
        )
        return parentMatches || childMatches
      })
      .map((parent) => ({
        ...parent,
        // Quando há busca ativa: filtra os filhos exibidos pra coincidir
        // com a query. Sem busca: mantém todos os filhos visíveis (o
        // filtro de status já filtra o pai).
        children: debouncedSearch
          ? parent.children.filter((c) => matchSearch(c) && matchStatus(c))
          : parent.children.filter((c) => matchStatus(c)),
      }))
  }, [tree, debouncedSearch, status])

  // Auto-expand: quando o usuário busca, expande todo pai que tem filho
  // matching — economiza um clique pra ver o resultado.
  const effectiveExpanded = useMemo(() => {
    if (!debouncedSearch) return expanded
    const next = new Set(expanded)
    filtered.forEach((p) => {
      if (p.children.length > 0) next.add(p.id)
    })
    return next
  }, [expanded, filtered, debouncedSearch])

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openCreate = (parentId: string | null = null) => {
    setEditingMenu(null)
    setDefaultParentId(parentId)
    setSheetOpen(true)
  }

  const openEdit = (menu: Menu) => {
    setEditingMenu(menu)
    setDefaultParentId(null)
    setSheetOpen(true)
  }

  const handleToggleActive = async (menu: Menu) => {
    const ok = await confirm(
      menu.active
        ? {
            title: `Desativar "${menu.label}"?`,
            description: 'Some do sidebar dos usuários mas é preservado.',
            confirmLabel: 'Desativar',
            variant: 'destructive',
          }
        : {
            title: `Reativar "${menu.label}"?`,
            confirmLabel: 'Reativar',
          },
    )
    if (!ok) return

    try {
      if (menu.active) {
        await deactivateMutation.mutateAsync(menu.id)
        toast.success('Menu desativado')
      } else {
        await activateMutation.mutateAsync(menu.id)
        toast.success('Menu reativado')
      }
    } catch (err) {
      const message =
        apiErrorText(err)
      toast.error(message ?? 'Erro ao alterar status')
    }
  }

  const handleDelete = async (menu: Menu) => {
    const childrenWarning = tree
      .find((m) => m.id === menu.id)
      ?.children.length
      ? 'Os submenus serão removidos junto (cascade).'
      : ''
    const ok = await confirm({
      title: `Remover "${menu.label}" definitivamente?`,
      description: childrenWarning || undefined,
      confirmLabel: 'Remover',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      await deleteMutation.mutateAsync(menu.id)
      toast.success('Menu removido')
    } catch (err) {
      const message =
        apiErrorText(err)
      toast.error(message ?? 'Erro ao remover menu')
    }
  }

  // Colunas compartilhadas entre tabela principal e SubTable — garante
  // que sub-tabela alinhe visualmente com o pai (label, path, position,
  // status). Sub-rows usam o mesmo render.
  const parentColumns: TableColumn<MenuNode>[] = [
    {
      key: 'label',
      header: 'Label',
      cell: (m) => <MenuLabel menu={m} />,
    },
    {
      key: 'path',
      header: 'Path',
      cell: (m) => (
        <span className="font-mono text-xs text-muted-foreground">
          {m.path ?? '—'}
        </span>
      ),
    },
    {
      key: 'position',
      header: 'Posição',
      className: 'w-20 text-center text-muted-foreground',
      cell: (m) => m.position,
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-28',
      cell: (m) => <StatusBadge active={m.active} />,
    },
  ]

  // Mesma estrutura pra SubTable — recebe colunas em formato próprio mas
  // os renders são compartilhados.
  const subColumns: SubTableColumn<MenuNode>[] = parentColumns.map((col) => ({
    key: col.key,
    header: col.header,
    className: col.className,
    cell: col.cell,
  }))

  const parentActions = (parent: MenuNode): RowAction[] => [
    {
      label: 'Adicionar submenu',
      icon: <PlusSquare />,
      onClick: () => openCreate(parent.id),
    },
    {
      label: 'Editar',
      icon: <Pencil />,
      onClick: () => openEdit(parent),
    },
    {
      label: parent.active ? 'Desativar' : 'Reativar',
      icon: parent.active ? <Ban /> : <Undo2 />,
      onClick: () => handleToggleActive(parent),
      destructive: parent.active,
    },
    {
      label: 'Remover',
      icon: <Trash2 />,
      onClick: () => handleDelete(parent),
      destructive: true,
    },
  ]

  const childActions = (child: MenuNode): RowAction[] => [
    {
      label: 'Editar',
      icon: <Pencil />,
      onClick: () => openEdit(child),
    },
    {
      label: child.active ? 'Desativar' : 'Reativar',
      icon: child.active ? <Ban /> : <Undo2 />,
      onClick: () => handleToggleActive(child),
      destructive: child.active,
    },
    {
      label: 'Remover',
      icon: <Trash2 />,
      onClick: () => handleDelete(child),
      destructive: true,
    },
  ]

  const emptyText =
    debouncedSearch || status !== 'active'
      ? 'Nenhum menu encontrado pros filtros atuais.'
      : 'Nenhum menu ainda. Cadastre o primeiro pela toolbar.'

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Search
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Buscar por label ou path"
        />
        <PageToolbar.Filter label="Status" minWidth={260}>
          <ButtonGroup
            value={status}
            onChange={setStatus}
            options={STATUS_OPTIONS}
            aria-label="Filtrar por status"
          />
        </PageToolbar.Filter>
        <PageToolbar.Action
          icon={<Plus />}
          label="Novo menu"
          onClick={() => openCreate(null)}
        />
      </PageToolbar>

      <Table<MenuNode>
        columns={parentColumns}
        data={filtered}
        rowKey={(m) => m.id}
        actions={parentActions}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar menus."
        renderRowLead={(parent) => {
          const hasChildren = parent.children.length > 0
          const isOpen = effectiveExpanded.has(parent.id)
          if (!hasChildren)
            return <span className="inline-block size-7" aria-hidden />
          return (
            <button
              type="button"
              onClick={() => toggleExpand(parent.id)}
              aria-label={isOpen ? 'Recolher' : 'Expandir'}
              aria-expanded={isOpen}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {isOpen ? (
                <ChevronDown className="size-4" />
              ) : (
                <ChevronRight className="size-4" />
              )}
            </button>
          )
        }}
        renderRowAddon={(parent, totalCols) => {
          const isOpen = effectiveExpanded.has(parent.id)
          if (!isOpen || parent.children.length === 0) return null
          return (
            <SubTable<MenuNode>
              colSpan={totalCols}
              columns={subColumns}
              data={parent.children}
              rowKey={(row) => row.id}
              actions={childActions}
              emptyText="Nenhum submenu corresponde ao filtro atual"
            />
          )
        }}
        footer={
          !isLoading && !isError ? (
            <div className="text-muted-foreground">
              {filtered.length}{' '}
              {filtered.length === 1 ? 'menu raiz' : 'menus raiz'}
              {isFetching ? ' • atualizando…' : ''}
            </div>
          ) : null
        }
      />

      <MenuFormSheet
        open={sheetOpen}
        menu={editingMenu}
        defaultParentId={defaultParentId}
        parents={tree}
        onOpenChange={setSheetOpen}
      />
    </PageContainer>
  )
}

// Label do menu com ícone resolvido pelo nome — replica o look do sidebar.
// Se `menu.color` estiver setado, usa a cor customizada; senão herda a cor
// muted padrão da tabela.
function MenuLabel({ menu }: { menu: Menu }): React.ReactElement {
  return (
    <div className="flex items-center gap-2">
      {menu.icon ? (
        <LucideIcon
          icon={menu.icon}
          className={menu.color ? 'size-4' : 'size-4 text-muted-foreground'}
          color={menu.color ?? undefined}
          aria-hidden
        />
      ) : (
        <span className="inline-block size-4" aria-hidden />
      )}
      <span className="font-medium">{menu.label}</span>
    </div>
  )
}

function StatusBadge({ active }: { active: boolean }): React.ReactElement {
  return active ? (
    <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
      Ativo
    </span>
  ) : (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
      Inativo
    </span>
  )
}
