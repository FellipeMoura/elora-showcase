import { useMemo, useState } from 'react'
import { Ban, Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { RowActions, type RowAction } from '@/components/data/RowActions'
import { Table, type TableColumn } from '@/components/data/Table'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useConfirm } from '@/components/ui/confirm-context'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  useActivateMessageTemplate,
  useDeactivateMessageTemplate,
  useDeleteMessageTemplate,
  useMessageTemplates,
} from '@/hooks/useMessageTemplates'
import type {
  FindMessageTemplatesQuery,
  MessageTemplate,
} from '@/api/messageTemplates'
import { STAGE_BADGE_CLASS, STAGE_LABELS } from '@/pages/journeys/journeyLabels'
import { cn } from '@/lib/utils'
import { MessageTemplateFormSheet } from './MessageTemplateFormSheet'
import { apiErrorText } from '@/lib/apiError'

const PAGE_SIZE = 20

type StatusFilter = 'active' | 'inactive' | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
]

export function MessageTemplatesPage(): React.ReactElement {
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)
  const confirm = useConfirm()

  const query: FindMessageTemplatesQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedSearch || undefined,
      status,
    }),
    [page, debouncedSearch, status],
  )

  const { data, isLoading, isError, isFetching, refetch } =
    useMessageTemplates(query)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] =
    useState<MessageTemplate | null>(null)

  const openCreate = (): void => {
    setEditingTemplate(null)
    setSheetOpen(true)
  }

  const openEdit = (t: MessageTemplate): void => {
    setEditingTemplate(t)
    setSheetOpen(true)
  }

  const deactivateMutation = useDeactivateMessageTemplate()
  const activateMutation = useActivateMessageTemplate()
  const deleteMutation = useDeleteMessageTemplate()

  const handleToggleActive = async (t: MessageTemplate): Promise<void> => {
    const ok = await confirm({
      title: t.active ? 'Desativar template?' : 'Reativar template?',
      description: t.active
        ? `"${t.name}" deixa de aparecer no composer. O histórico das mensagens enviadas é preservado.`
        : `"${t.name}" volta a aparecer no composer.`,
      confirmLabel: t.active ? 'Desativar' : 'Reativar',
      variant: t.active ? 'destructive' : 'primary',
    })
    if (!ok) return

    try {
      if (t.active) {
        await deactivateMutation.mutateAsync(t.id)
        toast.success('Template desativado')
      } else {
        await activateMutation.mutateAsync(t.id)
        toast.success('Template reativado')
      }
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao alterar status do template')
    }
  }

  const handleDelete = async (t: MessageTemplate): Promise<void> => {
    const ok = await confirm({
      title: 'Excluir template?',
      description: `"${t.name}" será removido. Backend bloqueia exclusão se houver automação em uso — neste caso desative em vez de excluir.`,
      confirmLabel: 'Excluir',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      await deleteMutation.mutateAsync(t.id)
      toast.success('Template excluído')
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status
      const message = apiErrorText(err)
      if (status === 409) {
        toast.error(
          message ??
            'Template em uso por automation — desative em vez de excluir.',
        )
      } else {
        toast.error('Erro ao excluir template')
      }
    }
  }

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const rowActions = (t: MessageTemplate): RowAction[] => [
    {
      label: 'Editar',
      icon: <Pencil />,
      onClick: () => openEdit(t),
    },
    {
      label: t.active ? 'Desativar' : 'Reativar',
      icon: t.active ? <Ban /> : <Undo2 />,
      onClick: () => handleToggleActive(t),
      destructive: t.active,
    },
    {
      label: 'Excluir',
      icon: <Trash2 />,
      onClick: () => handleDelete(t),
      destructive: true,
    },
  ]

  const columns: TableColumn<MessageTemplate>[] = [
    {
      key: 'name',
      header: 'Nome',
      cell: (t) => <span className="font-medium">{t.name}</span>,
    },
    {
      key: 'body',
      header: 'Conteúdo',
      className: 'text-muted-foreground',
      cell: (t) => (
        <span className="line-clamp-2 max-w-md whitespace-pre-wrap">
          {t.body}
        </span>
      ),
    },
    {
      key: 'surfaceInStage',
      header: 'Sugerido em',
      cell: (t) => {
        const stages = t.surfaceInStage ?? []
        if (stages.length === 0) {
          return <span className="text-xs text-muted-foreground">Todos</span>
        }
        return (
          <div className="flex flex-wrap gap-1">
            {stages.map((s) => (
              <span
                key={s}
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs font-medium',
                  STAGE_BADGE_CLASS[s],
                )}
              >
                {STAGE_LABELS[s]}
              </span>
            ))}
          </div>
        )
      },
    },
    {
      key: 'status',
      header: 'Status',
      cell: (t) =>
        t.active ? (
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
      ? 'Nenhum template encontrado pros filtros atuais.'
      : 'Nenhum template cadastrado. Crie o primeiro pela toolbar.'

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Search
          value={searchInput}
          onChange={(v) => {
            setSearchInput(v)
            setPage(1)
          }}
          placeholder="Buscar por nome ou conteúdo"
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
          label="Novo template"
          onClick={openCreate}
        />
      </PageToolbar>

      <Table<MessageTemplate>
        columns={columns}
        data={items}
        rowKey={(t) => t.id}
        actions={rowActions}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar templates."
        mobileCard={(t, actions) => (
          <div className="flex items-start gap-3 p-4">
            <RowActions actions={actions} className="shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{t.name}</span>
                {t.active ? (
                  <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
                    Ativo
                  </span>
                ) : (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                    Inativo
                  </span>
                )}
              </div>
              <div className="line-clamp-2 text-sm text-muted-foreground whitespace-pre-wrap">
                {t.body}
              </div>
              {t.surfaceInStage && t.surfaceInStage.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {t.surfaceInStage.map((s) => (
                    <span
                      key={s}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs font-medium',
                        STAGE_BADGE_CLASS[s],
                      )}
                    >
                      {STAGE_LABELS[s]}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'template' : 'templates'}
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

      <MessageTemplateFormSheet
        open={sheetOpen}
        template={editingTemplate}
        onOpenChange={setSheetOpen}
      />
    </PageContainer>
  )
}
