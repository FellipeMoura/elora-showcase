import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Archive, Check, RotateCcw } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
// eslint-disable-next-line no-restricted-imports -- select compacto de resposta do questionário (o rótulo é o enunciado da pergunta)
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useConfirm } from '@/components/ui/confirm-context'
import {
  useArchiveClientForm,
  useClientForm,
  useCompleteClientForm,
  useReopenClientForm,
  useUpsertClientFormAnswers,
} from '@/hooks/useClientForms'
import { useFormQuestions } from '@/hooks/useFormTemplates'
import {
  type AnswerInput,
  type FormAnswer,
} from '@/api/clientForms'
import {
  optionsAsStringArray,
  type FormQuestion,
  type QuestionType,
} from '@/api/formTemplates'
import { cn } from '@/lib/utils'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// Sheet pra preencher uma ficha do cliente. Carrega:
//   - template's questions (via useFormQuestions)
//   - answers existentes (via useClientForm)
// Renderiza um input por questionType. "Salvar" faz upsert em lote;
// "Finalizar" valida required questions no backend e marca status.
//
// Editar respostas pós-finalização é permitido (fluxo de correção); o
// botão Finalizar fica disabled quando status='completed'.
// =====================================================================

interface ClientFormFillSheetProps {
  open: boolean
  clientFormId: string | null
  // Necessário pra invalidar listagem por evaluation. Quando ausente,
  // o hook usa form.evaluationId vindo do response.
  evaluationId?: string
  // Idem pra listagem agregada por cliente.
  clientId?: string
  onOpenChange: (open: boolean) => void
}

// Estado in-memory de respostas durante preenchimento. Map por questionId
// pra reagir cada input independente, sem re-render do form inteiro.
type AnswerDraft = {
  text: string
  option: string
  bool: boolean | null
  number: string
  date: string
  observation: string
}

function emptyDraft(): AnswerDraft {
  return {
    text: '',
    option: '',
    bool: null,
    number: '',
    date: '',
    observation: '',
  }
}

function draftFromAnswer(a: FormAnswer | undefined): AnswerDraft {
  if (!a) return emptyDraft()
  return {
    text: a.answerText ?? '',
    option: a.answerOption ?? '',
    bool: a.answerBoolean,
    number: a.answerNumber ?? '',
    date: a.answerDate ?? '',
    observation: a.professionalObservation ?? '',
  }
}

// Decide se um draft tem resposta de verdade (não só observação).
function draftHasAnswer(draft: AnswerDraft, type: QuestionType): boolean {
  switch (type) {
    case 'text':
      return draft.text.trim().length > 0
    case 'yes_no':
      return draft.bool !== null
    case 'multiple_choice':
    case 'scale':
      return draft.option.length > 0
    case 'number':
      return draft.number.trim().length > 0 && !Number.isNaN(Number(draft.number))
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(draft.date)
  }
}

// Converte draft em AnswerInput (campos null exceto o relevante ao tipo +
// observação). Backend faz upsert; envia só perguntas com mudança.
function draftToAnswerInput(
  questionId: string,
  draft: AnswerDraft,
  type: QuestionType,
): AnswerInput | null {
  const hasAnswer = draftHasAnswer(draft, type)
  const obs = draft.observation.trim()
  if (!hasAnswer && !obs) return null

  const base: AnswerInput = {
    questionId,
    answerText: null,
    answerOption: null,
    answerBoolean: null,
    answerNumber: null,
    answerDate: null,
    answerData: null,
    professionalObservation: obs.length > 0 ? obs : null,
  }
  if (!hasAnswer) return base

  switch (type) {
    case 'text':
      return { ...base, answerText: draft.text.trim() }
    case 'yes_no':
      return { ...base, answerBoolean: draft.bool }
    case 'multiple_choice':
    case 'scale':
      return { ...base, answerOption: draft.option }
    case 'number':
      return { ...base, answerNumber: Number(draft.number) }
    case 'date':
      return { ...base, answerDate: draft.date }
  }
}

export function ClientFormFillSheet({
  open,
  clientFormId,
  evaluationId: evaluationIdProp,
  clientId: clientIdProp,
  onOpenChange,
}: ClientFormFillSheetProps): React.ReactElement {
  const confirm = useConfirm()
  const clientForm = useClientForm(clientFormId ?? undefined)
  const templateId = clientForm.data?.form.formTemplateId
  const questions = useFormQuestions(templateId)

  // Resolve IDs pra mutation: prop > response. clientId é só pra invalidar
  // listagem agregada; evaluationId é canônica (ancora a ficha).
  const evaluationId =
    evaluationIdProp ?? clientForm.data?.form.evaluationId ?? ''
  const clientId = clientIdProp ?? clientForm.data?.form.clientId ?? ''

  const upsertMutation = useUpsertClientFormAnswers()
  const completeMutation = useCompleteClientForm()
  const archiveMutation = useArchiveClientForm()
  const reopenMutation = useReopenClientForm()

  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({})

  // Sempre que abrir ou trocar a ficha, reidrata os drafts a partir das
  // answers já gravadas. Mudanças locais ficam até o save explícito.
  useEffect(() => {
    if (!open || !clientForm.data || !questions.data) {
      return
    }
    const answersByQuestion = new Map<string, FormAnswer>()
    for (const a of clientForm.data.answers) {
      answersByQuestion.set(a.questionId, a)
    }
    const next: Record<string, AnswerDraft> = {}
    for (const q of questions.data.items) {
      next[q.id] = draftFromAnswer(answersByQuestion.get(q.id))
    }
    setDrafts(next)
  }, [open, clientForm.data, questions.data])

  const sortedQuestions = useMemo(() => {
    return [...(questions.data?.items ?? [])]
      .filter((q) => q.active)
      .sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position
        return a.createdAt.localeCompare(b.createdAt)
      })
  }, [questions.data])

  const groupedQuestions = useMemo(() => {
    const groups = new Map<string, FormQuestion[]>()
    for (const q of sortedQuestions) {
      const key = q.section ?? '__no_section__'
      const list = groups.get(key) ?? []
      list.push(q)
      groups.set(key, list)
    }
    return Array.from(groups.entries()).map(([key, items]) => ({
      section: key === '__no_section__' ? null : key,
      items,
    }))
  }, [sortedQuestions])

  const updateDraft = (questionId: string, patch: Partial<AnswerDraft>): void => {
    setDrafts((prev) => ({
      ...prev,
      [questionId]: { ...(prev[questionId] ?? emptyDraft()), ...patch },
    }))
  }

  const handleSaveAnswers = async (): Promise<void> => {
    if (!clientFormId || !clientForm.data) return
    const payload: AnswerInput[] = []
    for (const q of sortedQuestions) {
      const draft = drafts[q.id]
      if (!draft) continue
      const input = draftToAnswerInput(q.id, draft, q.questionType)
      if (input) payload.push(input)
    }

    try {
      if (payload.length > 0) {
        await upsertMutation.mutateAsync({
          id: clientFormId,
          evaluationId,
          clientId,
          input: { answers: payload },
        })
      }
      toast.success('Respostas salvas')
    } catch {
      toast.error('Erro ao salvar respostas')
    }
  }

  const handleComplete = async (): Promise<void> => {
    if (!clientFormId) return
    // Salva pendências antes — finalizar com dados não persistidos perderia
    // tudo digitado nessa sessão.
    await handleSaveAnswers()
    try {
      await completeMutation.mutateAsync({ id: clientFormId, evaluationId, clientId })
      toast.success('Ficha finalizada')
      onOpenChange(false)
    } catch (err) {
      const httpStatus = (err as { response?: { status?: number } })?.response
        ?.status
      const message = apiErrorText(err)
      if (httpStatus === 409) {
        toast.error(
          message ?? 'Há perguntas obrigatórias sem resposta. Verifique antes de finalizar.',
        )
      } else {
        toast.error('Erro ao finalizar ficha')
      }
    }
  }

  const handleArchive = async (): Promise<void> => {
    if (!clientFormId) return
    const ok = await confirm({
      title: 'Arquivar ficha?',
      description: 'A ficha some das listagens padrão. Você pode reabri-la depois.',
      confirmLabel: 'Arquivar',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await archiveMutation.mutateAsync({ id: clientFormId, evaluationId, clientId })
      toast.success('Ficha arquivada')
      onOpenChange(false)
    } catch {
      toast.error('Erro ao arquivar ficha')
    }
  }

  const handleReopen = async (): Promise<void> => {
    if (!clientFormId) return
    try {
      await reopenMutation.mutateAsync({ id: clientFormId, evaluationId, clientId })
      toast.success('Ficha reaberta')
    } catch {
      toast.error('Erro ao reabrir ficha')
    }
  }

  const form = clientForm.data?.form
  const status = form?.status
  const canComplete = status === 'draft'
  const canArchive = status !== 'archived'
  const canReopen = status === 'archived'

  const isLoading = clientForm.isLoading || questions.isLoading
  const isError = clientForm.isError || questions.isError

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-2xl"
      >
        <SheetContainer>
          <SheetToolbar srTitle="Preencher ficha">
            {canReopen && (
              <SheetToolbar.Action
                label="Reabrir"
                icon={<RotateCcw className="size-4" />}
                variant="outline"
                onClick={handleReopen}
                disabled={reopenMutation.isPending}
              />
            )}
            {canArchive && (
              <SheetToolbar.Action
                label="Arquivar"
                icon={<Archive className="size-4" />}
                variant="ghost"
                onClick={handleArchive}
                disabled={archiveMutation.isPending}
              />
            )}
            <SheetToolbar.Action
              label={upsertMutation.isPending ? 'Salvando…' : 'Salvar'}
              variant="outline"
              onClick={handleSaveAnswers}
              disabled={upsertMutation.isPending || status === 'archived'}
            />
            {canComplete && (
              <SheetToolbar.Action
                label={completeMutation.isPending ? 'Finalizando…' : 'Finalizar'}
                icon={<Check className="size-4" />}
                onClick={handleComplete}
                disabled={completeMutation.isPending}
              />
            )}
          </SheetToolbar>

          <SheetBody>
            {isLoading && (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            )}
            {isError && <p className="text-sm text-error">Erro ao carregar ficha.</p>}

            {!isLoading && !isError && form && (
              <div className="flex flex-col gap-4">
                {sortedQuestions.length === 0 && (
                  <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                    Este template ainda não tem perguntas cadastradas. Configure as
                    perguntas em <em>Fichas de avaliação</em> no menu lateral.
                  </div>
                )}

                {groupedQuestions.map((group) => (
                  <section
                    key={group.section ?? '__no_section__'}
                    className="flex flex-col gap-3 rounded-md border bg-background p-3"
                  >
                    {group.section && (
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {group.section}
                      </h3>
                    )}
                    <div className="flex flex-col gap-4">
                      {group.items.map((q) => (
                        <QuestionField
                          key={q.id}
                          question={q}
                          draft={drafts[q.id] ?? emptyDraft()}
                          disabled={status === 'archived'}
                          onChange={(patch) => updateDraft(q.id, patch)}
                        />
                      ))}
                    </div>
                  </section>
                ))}

              </div>
            )}
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}

// =====================================================================
// Per-type input — extraído pra manter o sheet legível.
// =====================================================================

function QuestionField({
  question,
  draft,
  disabled,
  onChange,
}: {
  question: FormQuestion
  draft: AnswerDraft
  disabled: boolean
  onChange: (patch: Partial<AnswerDraft>) => void
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <Label className="text-sm">
        {question.prompt}
        {question.required && (
          <span aria-hidden className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </Label>

      <AnswerInputField
        question={question}
        draft={draft}
        disabled={disabled}
        onChange={onChange}
      />

      {/* eslint-disable-next-line no-restricted-syntax -- observação compacta do profissional sob a resposta (sem label na notch) */}
      <input
        type="text"
        placeholder="Observação do profissional (opcional)"
        value={draft.observation}
        onChange={(e) => onChange({ observation: e.target.value })}
        disabled={disabled}
        className={cn(
          'h-8 w-full rounded-md border border-input bg-muted/30 px-3 text-xs',
          'placeholder:text-muted-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />
    </div>
  )
}

function AnswerInputField({
  question,
  draft,
  disabled,
  onChange,
}: {
  question: FormQuestion
  draft: AnswerDraft
  disabled: boolean
  onChange: (patch: Partial<AnswerDraft>) => void
}): React.ReactElement {
  const baseInputClass = cn(
    'rounded-md border border-input bg-background px-3 py-2 text-sm',
    'placeholder:text-muted-foreground',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    'disabled:cursor-not-allowed disabled:opacity-50',
  )

  switch (question.questionType) {
    case 'text':
      return (
        // eslint-disable-next-line no-restricted-syntax -- resposta do questionário — o rótulo é o enunciado da pergunta
        <textarea
          rows={2}
          value={draft.text}
          onChange={(e) => onChange({ text: e.target.value })}
          disabled={disabled}
          className={baseInputClass}
          placeholder="Resposta"
        />
      )

    case 'yes_no':
      return (
        <div className="flex gap-2">
          <label
            className={cn(
              'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
              draft.bool === true
                ? 'border-primary bg-primary/5'
                : 'border-input hover:bg-accent',
              disabled && 'pointer-events-none opacity-50',
            )}
          >
            <Checkbox
              checked={draft.bool === true}
              onCheckedChange={(v) => onChange({ bool: v ? true : null })}
              disabled={disabled}
            />
            Sim
          </label>
          <label
            className={cn(
              'flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
              draft.bool === false
                ? 'border-primary bg-primary/5'
                : 'border-input hover:bg-accent',
              disabled && 'pointer-events-none opacity-50',
            )}
          >
            <Checkbox
              checked={draft.bool === false}
              onCheckedChange={(v) => onChange({ bool: v ? false : null })}
              disabled={disabled}
            />
            Não
          </label>
        </div>
      )

    case 'multiple_choice':
    case 'scale': {
      const options = optionsAsStringArray(question.options)
      return (
        <Select
          value={draft.option}
          onValueChange={(v) => onChange({ option: v })}
          disabled={disabled}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione" />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    case 'number':
      return (
        // eslint-disable-next-line no-restricted-syntax -- resposta numérica do questionário — o rótulo é o enunciado da pergunta
        <input
          type="number"
          step="any"
          value={draft.number}
          onChange={(e) => onChange({ number: e.target.value })}
          disabled={disabled}
          className={cn('h-10', baseInputClass)}
          placeholder="Valor"
        />
      )

    case 'date':
      return (
        // eslint-disable-next-line no-restricted-syntax -- resposta de data do questionário — o rótulo é o enunciado da pergunta
        <input
          type="date"
          value={draft.date}
          onChange={(e) => onChange({ date: e.target.value })}
          disabled={disabled}
          className={cn('h-10', baseInputClass)}
        />
      )
  }
}
