import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Ban, ExternalLink, Pencil, Plus, Trash2, Undo2 } from 'lucide-react'
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
  useActivateFormTemplate,
  useDeactivateFormTemplate,
  useDeleteFormTemplate,
  useFormTemplates,
} from '@/hooks/useFormTemplates'
import type {
  FindFormTemplatesQuery,
  FormTemplate,
} from '@/api/formTemplates'
import { FormTemplateFormSheet } from './FormTemplateFormSheet'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// Listagem de templates de ficha (anamneses customizáveis do tenant).
// Cada template tem N perguntas tipadas — gerenciadas na rota de detalhe
// (/form-templates/:id). Aqui só o CRUD do "envelope".
// =====================================================================

const PAGE_SIZE = 20

type StatusFilter = 'active' | 'inactive' | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
]

export function FormTemplatesPage(): React.ReactElement {
  const navigate = useNavigate()
  const confirm = useConfirm()

  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)

  const query: FindFormTemplatesQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedSearch || undefined,
      status,
    }),
    [page, debouncedSearch, status],
  )

  const { data, isLoading, isError, isFetching, refetch } =
    useFormTemplates(query)

  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<FormTemplate | null>(
    null,
  )

  const openCreate = (): void => {
    setEditingTemplate(null)
    setSheetOpen(true)
  }

  const openEdit = (t: FormTemplate): void => {
    setEditingTemplate(t)
    setSheetOpen(true)
  }

  const deactivateMutation = useDeactivateFormTemplate()
  const activateMutation = useActivateFormTemplate()
  const deleteMutation = useDeleteFormTemplate()

  const handleToggleActive = async (t: FormTemplate): Promise<void> => {
    const ok = await confirm({
      title: t.active ? 'Desativar template?' : 'Reativar template?',
      description: t.active
        ? `"${t.name}" deixa de aparecer ao criar novas fichas. Fichas já preenchidas continuam acessíveis.`
        : `"${t.name}" volta a aparecer ao criar novas fichas.`,
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

  const handleDelete = async (t: FormTemplate): Promise<void> => {
    const ok = await confirm({
      title: 'Excluir template?',
      description: `"${t.name}" será removido. Se já houver fichas preenchidas, o backend bloqueia a exclusão — nesse caso, desative em vez de excluir.`,
      confirmLabel: 'Excluir',
      variant: 'destructive',
    })
    if (!ok) return

    try {
      await deleteMutation.mutateAsync(t.id)
      toast.success('Template excluído')
    } catch (err) {
      const httpStatus = (err as { response?: { status?: number } })?.response
        ?.status
      const message = apiErrorText(err)
      if (httpStatus === 409) {
        toast.error(
          message ??
            'Template possui fichas preenchidas — desative em vez de excluir.',
        )
      } else {
        toast.error('Erro ao excluir template')
      }
    }
  }

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const rowActions = (t: FormTemplate): RowAction[] => [
    {
      label: 'Abrir',
      icon: <ExternalLink />,
      onClick: () => navigate(`/form-templates/${t.id}`),
    },
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

  const columns: TableColumn<FormTemplate>[] = [
    {
      key: 'name',
      header: 'Nome',
      cell: (t) => (
        <button
          type="button"
          onClick={() => navigate(`/form-templates/${t.id}`)}
          className="text-left font-medium hover:text-primary hover:underline"
        >
          {t.name}
        </button>
      ),
    },
    {
      key: 'description',
      header: 'Descrição',
      className: 'text-muted-foreground',
      cell: (t) =>
        t.description ? (
          <span className="line-clamp-2 max-w-md whitespace-pre-wrap">
            {t.description}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: 'requiredForEvaluation',
      header: 'Obrigatório p/ avaliação',
      cell: (t) =>
        t.requiredForEvaluation ? (
          <span className="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning">
            Sim
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
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
          label="Novo template"
          onClick={openCreate}
        />
      </PageToolbar>

      <Table<FormTemplate>
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
                <button
                  type="button"
                  onClick={() => navigate(`/form-templates/${t.id}`)}
                  className="truncate text-left font-medium hover:text-primary hover:underline"
                >
                  {t.name}
                </button>
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
              {t.description && (
                <div className="line-clamp-2 text-sm text-muted-foreground whitespace-pre-wrap">
                  {t.description}
                </div>
              )}
              {t.requiredForEvaluation && (
                <span className="self-start rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning">
                  Obrigatório p/ avaliação
                </span>
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

      <FormTemplateFormSheet
        open={sheetOpen}
        template={editingTemplate}
        onOpenChange={setSheetOpen}
      />
    </PageContainer>
  )
}
