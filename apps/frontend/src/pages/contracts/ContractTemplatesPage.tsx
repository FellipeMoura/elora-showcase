import { useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
// eslint-disable-next-line no-restricted-imports -- combobox de ação "adicionar procedimento" em sub-linha da tabela
import { Combobox } from '@/components/ui/combobox'
import { useConfirm } from '@/components/ui/confirm-context'
import { RowActions, type RowAction } from '@/components/data/RowActions'
import { Table, type TableColumn } from '@/components/data/Table'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import {
  useContractTemplates,
  useDeleteContractTemplate,
  useLinkTemplateToProcedure,
  useUnlinkTemplateFromProcedure,
} from '@/hooks/useContracts'
import { useProcedures } from '@/hooks/useProcedures'
import {
  CONTRACT_KIND_LABELS,
  type ContractTemplate,
} from '@/api/contracts'
import { ContractTemplateSheet } from './ContractTemplateSheet'
import { apiErrorText } from '@/lib/apiError'

type ActiveFilter = 'active' | 'inactive' | 'all'

const ACTIVE_OPTIONS: ReadonlyArray<{ value: ActiveFilter; label: string }> = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
]

export function ContractTemplatesPage(): React.ReactElement {
  const confirm = useConfirm()
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('active')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<ContractTemplate | null>(null)

  const { data, isLoading, isError, refetch } = useContractTemplates({
    active: activeFilter === 'all' ? undefined : activeFilter === 'active',
    pageSize: 100,
  })
  const deleteMutation = useDeleteContractTemplate()

  const templates = data?.items ?? []

  const handleOpenCreate = () => {
    setEditingTemplate(null)
    setSheetOpen(true)
  }

  const handleOpenEdit = (t: ContractTemplate) => {
    setEditingTemplate(t)
    setSheetOpen(true)
  }

  const handleDelete = async (t: ContractTemplate) => {
    const ok = await confirm({
      title: `Remover o template "${t.name}"?`,
      confirmLabel: 'Remover',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await deleteMutation.mutateAsync(t.id)
      toast.success('Template removido')
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  const rowActions = (t: ContractTemplate): RowAction[] => [
    {
      label: 'Editar',
      icon: <Pencil />,
      onClick: () => handleOpenEdit(t),
    },
    {
      label: 'Remover',
      icon: <Trash2 />,
      onClick: () => void handleDelete(t),
      destructive: true,
    },
  ]

  const columns: TableColumn<ContractTemplate>[] = [
    {
      key: 'name',
      header: 'Nome',
      cell: (t) => (
        <div className="flex flex-col">
          <span className="font-medium">{t.name}</span>
          <span className="text-xs text-muted-foreground">
            {CONTRACT_KIND_LABELS[t.kind]}
          </span>
        </div>
      ),
    },
    {
      key: 'variables',
      header: 'Variáveis',
      cell: (t) =>
        t.variables.length === 0 ? (
          <span className="text-xs text-muted-foreground">Nenhuma</span>
        ) : (
          <div className="flex flex-wrap gap-1">
            {t.variables.map((v) => (
              <code
                key={v}
                className="rounded bg-secondary/20 px-1.5 py-0.5 text-xs text-secondary-foreground"
              >
                {v}
              </code>
            ))}
          </div>
        ),
    },
    {
      key: 'zapsign',
      header: 'ID ZapSign',
      className: 'text-muted-foreground',
      cell: (t) => <code className="text-xs">{t.zapsignTemplateId}</code>,
    },
    {
      key: 'active',
      header: 'Status',
      cell: (t) =>
        t.active ? (
          <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs text-success">
            Ativo
          </span>
        ) : (
          <span className="rounded bg-secondary/20 px-1.5 py-0.5 text-xs text-secondary">
            Inativo
          </span>
        ),
    },
  ]

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Filter label="Status" minWidth={240}>
          <ButtonGroup
            value={activeFilter}
            onChange={setActiveFilter}
            options={ACTIVE_OPTIONS}
            aria-label="Filtrar por status"
          />
        </PageToolbar.Filter>
        <PageToolbar.Action
          icon={<Plus />}
          label="Novo template"
          onClick={handleOpenCreate}
        />
      </PageToolbar>

      <Table<ContractTemplate>
        columns={columns}
        data={templates}
        rowKey={(t) => t.id}
        actions={rowActions}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText="Nenhum template cadastrado. Cadastre o primeiro pela toolbar."
        errorText="Erro ao carregar templates."
        renderRowAddon={(t, totalCols) =>
          t.kind === 'consent_term' ? (
            <TemplateProceduresEditor template={t} colSpan={totalCols} />
          ) : null
        }
        mobileCard={(t, actions) => (
          <div className="flex items-start gap-3 p-4">
            <RowActions actions={actions} className="shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate font-medium">{t.name}</span>
              <span className="text-xs text-muted-foreground">
                {CONTRACT_KIND_LABELS[t.kind]} ·{' '}
                {t.variables.length} variável
                {t.variables.length === 1 ? '' : 'eis'}
              </span>
            </div>
          </div>
        )}
      />

      <ContractTemplateSheet
        open={sheetOpen}
        template={editingTemplate}
        onOpenChange={setSheetOpen}
      />
    </PageContainer>
  )
}

// =====================================================================
// Editor de procedimentos vinculados (Fase 7) — addon da linha de templates
// `consent_term`. Composição custom (não a <SubTable> do catálogo) porque a
// SubTable não tem slot de header pro controle "Adicionar procedimento"
// (regra 13 item 4 do CLAUDE.md — justificar quando não couber no catálogo).
// Espelha o visual da SubTable: faixa `bg-muted/30` + card indentado, pra manter
// a relação parent → child consistente com o resto do app.
// =====================================================================

function TemplateProceduresEditor({
  template,
  colSpan,
}: {
  template: ContractTemplate
  colSpan: number
}): React.ReactElement {
  const [search, setSearch] = useState('')
  const proceduresQuery = useProcedures({
    page: 1,
    pageSize: 100,
    status: 'active',
  })
  const link = useLinkTemplateToProcedure()
  const unlink = useUnlinkTemplateFromProcedure()

  const linkedProcedures = template.procedures ?? []
  const linkedIds = new Set(linkedProcedures.map((p) => p.id))

  // Opções = procedimentos ativos ainda NÃO vinculados, filtrados pela busca.
  const options = (proceduresQuery.data?.items ?? [])
    .filter((p) => !linkedIds.has(p.id))
    .filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    .map((p) => ({ value: p.id, label: p.name }))

  const handleAdd = async (procedureId: string | null) => {
    if (!procedureId) return
    try {
      await link.mutateAsync({ templateId: template.id, procedureId })
      setSearch('')
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  const handleRemove = async (procedureId: string) => {
    try {
      await unlink.mutateAsync({ templateId: template.id, procedureId })
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  return (
    <tr>
      <td colSpan={colSpan} className="bg-muted/30 px-2 py-2 sm:pl-10 sm:pr-6">
        <div className="flex flex-col gap-3 overflow-hidden rounded-md border border-border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase text-muted-foreground">
              Procedimentos que exigem este termo
            </h4>
            <Combobox
              value={null}
              onChange={(v) => void handleAdd(v)}
              options={options}
              search={search}
              onSearchChange={setSearch}
              placeholder="Adicionar procedimento…"
              emptyLabel={
                proceduresQuery.isLoading
                  ? 'Carregando…'
                  : 'Nenhum procedimento disponível'
              }
              isLoading={proceduresQuery.isLoading}
              className="w-full sm:max-w-xs"
              aria-label="Adicionar procedimento ao template"
            />
          </div>

          {linkedProcedures.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum procedimento vinculado ainda. Vendas com esses procedimentos
              não vão gerar este termo até você vincular.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {linkedProcedures.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded border bg-muted/20 px-2.5 py-1.5 text-sm"
                >
                  <span className="truncate">{p.name}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => void handleRemove(p.id)}
                    aria-label={`Remover ${p.name}`}
                    className="size-7 shrink-0 text-error hover:text-error"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </td>
    </tr>
  )
}

function extractErrorMessage(err: unknown): string {
  const msg = apiErrorText(err)
  if (msg) return msg
  if (err instanceof Error) return err.message
  return 'Erro inesperado'
}
