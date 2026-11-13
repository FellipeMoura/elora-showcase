import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  ClipboardPen,
  FilePlus,
  Pencil,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/layout/PageContainer'
import { useClient } from '@/hooks/useClients'
import { useEvaluation } from '@/hooks/useEvaluations'
import { useEvaluationForms, useCreateClientForm } from '@/hooks/useClientForms'
import { useFormTemplates } from '@/hooks/useFormTemplates'
import {
  CLIENT_FORM_STATUS_BADGE_CLASS,
  CLIENT_FORM_STATUS_LABELS,
  type ClientForm,
} from '@/api/clientForms'
import {
  EVALUATION_KIND_LABELS,
  EVALUATION_STATUS_BADGE_CLASS,
  EVALUATION_STATUS_LABELS,
} from '@/api/evaluations'
import type { FormTemplate } from '@/api/formTemplates'
import { displayDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ClientFormFillSheet } from '@/pages/clients/ClientFormFillSheet'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// Página de preenchimento de fichas duma avaliação.
//
// Cabeçalho: contexto da evaluation (cliente, kind, status, data).
// Body: lista de templates ATIVOS do tenant, cada um com status da ficha
// nessa evaluation (não criada / rascunho / finalizada / arquivada).
// Clicar abre o ClientFormFillSheet — se a ficha ainda não existir, cria
// primeiro (POST /evaluations/:id/forms) e abre na sequência.
//
// Cada evaluation (initial, reevaluation, return) tem seu próprio conjunto
// — preenchimentos antigos ficam preservados na evaluation anterior.
// =====================================================================

export function EvaluationFormsPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const evaluation = useEvaluation(id)
  const clientId = evaluation.data?.clientId
  const client = useClient(clientId)

  // Templates ativos do tenant — universo possível pra essa eval.
  const templatesQuery = useFormTemplates({
    page: 1,
    pageSize: 100,
    status: 'active',
  })
  // Fichas já existentes dessa evaluation.
  const formsQuery = useEvaluationForms(id)

  const createForm = useCreateClientForm()
  const [activeFormId, setActiveFormId] = useState<string | null>(null)

  // Index ficha-por-template pra match rápido.
  const formByTemplateId = useMemo(() => {
    const m = new Map<string, ClientForm>()
    for (const f of formsQuery.data?.items ?? []) {
      m.set(f.formTemplateId, f)
    }
    return m
  }, [formsQuery.data])

  const activeTemplates = useMemo(() => {
    return [...(templatesQuery.data?.items ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    )
  }, [templatesQuery.data])

  const handleOpenOrCreate = async (template: FormTemplate): Promise<void> => {
    if (!id) return
    const existing = formByTemplateId.get(template.id)
    if (existing) {
      setActiveFormId(existing.id)
      return
    }
    try {
      const created = await createForm.mutateAsync({
        evaluationId: id,
        clientId,
        input: { formTemplateId: template.id },
      })
      setActiveFormId(created.id)
    } catch (err) {
      const httpStatus = (err as { response?: { status?: number } })?.response
        ?.status
      const message = apiErrorText(err)
      if (httpStatus === 409) {
        // Race condition rara — alguém criou em outra aba. Refetch e tenta
        // abrir a existente.
        toast.info(message ?? 'Ficha já existe — recarregando.')
        formsQuery.refetch()
      } else {
        toast.error('Erro ao criar ficha')
      }
    }
  }

  if (!id) return <></>

  if (evaluation.isLoading) {
    return (
      <PageContainer>
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Carregando avaliação…
        </div>
      </PageContainer>
    )
  }

  if (evaluation.isError || !evaluation.data) {
    return (
      <PageContainer>
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>Erro ao carregar avaliação.</p>
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            Voltar
          </Button>
        </div>
      </PageContainer>
    )
  }

  const ev = evaluation.data
  const requiredMissing = activeTemplates.filter((t) => {
    if (!t.requiredForEvaluation) return false
    const f = formByTemplateId.get(t.id)
    return !f || f.status !== 'completed'
  })

  return (
    <PageContainer>
      <div className="flex h-full flex-col gap-3 overflow-y-auto">
        {/* Header */}
        <header className="flex flex-wrap items-center gap-2 rounded-md border bg-background p-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              clientId ? navigate(`/clients/${clientId}`) : navigate(-1)
            }
            aria-label="Voltar"
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-lg font-semibold">
                {client.data?.name ?? 'Cliente…'}
              </h1>
              <span className="rounded bg-info/15 px-1.5 py-0.5 text-xs font-medium text-info">
                {EVALUATION_KIND_LABELS[ev.kind]}
              </span>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs font-medium',
                  EVALUATION_STATUS_BADGE_CLASS[ev.status],
                )}
              >
                {EVALUATION_STATUS_LABELS[ev.status]}
              </span>
            </div>
            <div className="text-sm text-muted-foreground">
              {ev.performedAt
                ? `Realizada em ${displayDateTime(ev.performedAt)}`
                : `Criada em ${displayDateTime(ev.createdAt)}`}
            </div>
          </div>
        </header>

        {requiredMissing.length > 0 && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
            <ClipboardList className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="font-medium text-warning">
                {requiredMissing.length === 1
                  ? '1 ficha obrigatória pendente'
                  : `${requiredMissing.length} fichas obrigatórias pendentes`}
              </span>
              <span className="text-xs text-warning/80">
                {requiredMissing.map((t) => t.name).join(' · ')}
              </span>
            </div>
          </div>
        )}

        {/* Body: templates */}
        <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
          <header className="flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">
              Fichas desta avaliação
            </h2>
            <span className="text-xs text-muted-foreground">
              {formsQuery.data?.items.length ?? 0} de{' '}
              {activeTemplates.length}{' '}
              {activeTemplates.length === 1 ? 'template' : 'templates'} ativos
            </span>
          </header>

          {(templatesQuery.isLoading || formsQuery.isLoading) && (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          )}
          {(templatesQuery.isError || formsQuery.isError) && (
            <p className="text-sm text-error">Erro ao carregar fichas.</p>
          )}

          {!templatesQuery.isLoading && activeTemplates.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed p-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhum template ativo cadastrado.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate('/form-templates')}
              >
                Configurar templates
              </Button>
            </div>
          )}

          <ul className="flex flex-col gap-2">
            {activeTemplates.map((template) => {
              const existing = formByTemplateId.get(template.id)
              return (
                <TemplateRow
                  key={template.id}
                  template={template}
                  existing={existing}
                  onAction={() => handleOpenOrCreate(template)}
                  isCreating={createForm.isPending}
                />
              )
            })}
          </ul>
        </section>
      </div>

      <ClientFormFillSheet
        open={activeFormId !== null}
        clientFormId={activeFormId}
        evaluationId={id}
        clientId={clientId}
        onOpenChange={(o) => {
          if (!o) setActiveFormId(null)
        }}
      />
    </PageContainer>
  )
}

// =====================================================================
// TemplateRow — uma linha por template ativo, mostrando o estado da
// ficha nessa avaliação (ou "Não iniciada" se ainda não foi criada).
// =====================================================================

function TemplateRow({
  template,
  existing,
  onAction,
  isCreating,
}: {
  template: FormTemplate
  existing: ClientForm | undefined
  onAction: () => void
  isCreating: boolean
}): React.ReactElement {
  const status = existing?.status
  const isComplete = status === 'completed'
  const isDraft = status === 'draft'
  const isArchived = status === 'archived'

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded border bg-muted/20 p-3">
      <div className="flex min-w-0 flex-1 items-start gap-2">
        {isComplete ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
        ) : (
          <ClipboardPen className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-sm">{template.name}</span>
            {template.requiredForEvaluation && (
              <span className="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning">
                Obrigatória
              </span>
            )}
            {existing ? (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs font-medium',
                  CLIENT_FORM_STATUS_BADGE_CLASS[existing.status],
                )}
              >
                {CLIENT_FORM_STATUS_LABELS[existing.status]}
              </span>
            ) : (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                Não iniciada
              </span>
            )}
          </div>
          {template.description && (
            <p className="line-clamp-1 text-xs text-muted-foreground">
              {template.description}
            </p>
          )}
          {existing?.filledAt && isComplete && (
            <p className="text-xs text-muted-foreground">
              Finalizada em {displayDateTime(existing.filledAt)}
            </p>
          )}
        </div>
      </div>

      <Button
        variant={isComplete || isArchived ? 'ghost' : 'outline'}
        size="sm"
        onClick={onAction}
        disabled={isCreating}
        className="shrink-0"
      >
        {existing ? (
          <>
            <Pencil className="mr-1 size-3.5" />
            {isDraft ? 'Continuar' : 'Abrir'}
          </>
        ) : (
          <>
            <FilePlus className="mr-1 size-3.5" />
            {isCreating ? 'Criando…' : 'Preencher'}
          </>
        )}
      </Button>
    </li>
  )
}
