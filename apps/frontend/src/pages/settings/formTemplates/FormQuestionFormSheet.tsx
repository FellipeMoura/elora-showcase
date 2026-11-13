import { useEffect } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { SelectField, SelectItem } from '@/components/form/SelectField'
import { TextField } from '@/components/form/TextField'
import { TextArea } from '@/components/form/TextArea'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  useCreateFormQuestion,
  useUpdateFormQuestion,
} from '@/hooks/useFormTemplates'
import {
  QUESTION_TYPE_LABELS,
  optionsAsStringArray,
  questionNeedsOptions,
  type FormQuestion,
  type QuestionType,
} from '@/api/formTemplates'
import { apiErrorText } from '@/lib/apiError'

// Inline pra Zod enum exigir tuple [string, ...string[]] (não readonly).
const QUESTION_TYPE_VALUES = [
  'text',
  'yes_no',
  'multiple_choice',
  'scale',
  'number',
  'date',
] as const satisfies readonly QuestionType[]
import { cn } from '@/lib/utils'

// Texto de apoio exibido sob o select de tipo (helperText do SelectField).
const QUESTION_TYPE_HELP: Record<QuestionType, string> = {
  text: 'Resposta livre em texto. Útil pra observações qualitativas.',
  yes_no: 'Resposta sim ou não.',
  multiple_choice: 'Lista de opções. Cliente escolhe uma.',
  scale: 'Escala de valores (ex: I, II, III, IV). Cliente escolhe um.',
  number: 'Valor numérico (ex: peso, altura, idade).',
  date: 'Data específica (ex: data do parto).',
}

// =====================================================================
// Form pra criar/editar uma pergunta dentro de um template.
//
// `options` é um array dinâmico — só fica visível quando tipo precisa
// (multiple_choice ou scale). useFieldArray gerencia adicionar/remover.
//
// Validação por tipo: se exige options, exige pelo menos 1 não-vazia.
// =====================================================================

const formSchema = z
  .object({
    prompt: z.string().trim().min(1, 'Enunciado obrigatório').max(5000),
    questionType: z.enum(QUESTION_TYPE_VALUES),
    section: z.string().trim().max(128).optional(),
    required: z.boolean(),
    position: z.coerce.number().int().min(0),
    options: z.array(z.object({ value: z.string() })),
  })
  .superRefine((data, ctx) => {
    if (questionNeedsOptions(data.questionType)) {
      const valid = data.options.filter((o) => o.value.trim().length > 0)
      if (valid.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options'],
          message: 'Pelo menos uma opção é obrigatória.',
        })
      }
    }
  })

type FormValues = z.infer<typeof formSchema>

interface FormQuestionFormSheetProps {
  open: boolean
  templateId: string
  question: FormQuestion | null
  suggestedPosition: number
  // Sections já usadas no template — exibimos pra reduzir digitação livre.
  existingSections: string[]
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'form-question-form'

function emptyValues(position: number): FormValues {
  return {
    prompt: '',
    questionType: 'text',
    section: '',
    required: false,
    position,
    options: [],
  }
}

function valuesFromQuestion(q: FormQuestion): FormValues {
  return {
    prompt: q.prompt,
    questionType: q.questionType,
    section: q.section ?? '',
    required: q.required,
    position: q.position,
    options: optionsAsStringArray(q.options).map((value) => ({ value })),
  }
}

export function FormQuestionFormSheet({
  open,
  templateId,
  question,
  suggestedPosition,
  existingSections,
  onOpenChange,
}: FormQuestionFormSheetProps): React.ReactElement {
  const isEdit = Boolean(question)
  const createMutation = useCreateFormQuestion()
  const updateMutation = useUpdateFormQuestion()

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues(suggestedPosition),
  })

  const {
    fields: optionFields,
    append: appendOption,
    remove: removeOption,
  } = useFieldArray({ control, name: 'options' })

  useEffect(() => {
    if (open) {
      reset(question ? valuesFromQuestion(question) : emptyValues(suggestedPosition))
    }
  }, [open, question, suggestedPosition, reset])

  const questionType = watch('questionType')
  const required = watch('required')
  const needsOptions = questionNeedsOptions(questionType)
  const sectionValue = watch('section') ?? ''

  // Garante pelo menos 1 input de option visível quando o tipo exige —
  // melhora UX vs. clicar "adicionar" todo começo.
  useEffect(() => {
    if (open && needsOptions && optionFields.length === 0) {
      appendOption({ value: '' })
    }
  }, [open, needsOptions, optionFields.length, appendOption])

  const onSubmit = handleSubmit(async (data) => {
    const cleanedOptions = needsOptions
      ? data.options.map((o) => o.value.trim()).filter((v) => v.length > 0)
      : null
    const section = data.section?.trim() ? data.section.trim() : null

    try {
      if (isEdit && question) {
        await updateMutation.mutateAsync({
          templateId,
          questionId: question.id,
          input: {
            prompt: data.prompt,
            questionType: data.questionType,
            options: cleanedOptions,
            section,
            required: data.required,
            position: data.position,
          },
        })
        toast.success('Pergunta atualizada')
      } else {
        await createMutation.mutateAsync({
          templateId,
          input: {
            prompt: data.prompt,
            questionType: data.questionType,
            options: cleanedOptions,
            section,
            required: data.required,
            position: data.position,
          },
        })
        toast.success('Pergunta criada')
      }
      onOpenChange(false)
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao salvar pergunta')
    }
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-lg"
      >
        <SheetContainer>
          <SheetToolbar srTitle={isEdit ? 'Editar pergunta' : 'Nova pergunta'}>
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            />
            <SheetToolbar.Action
              label={isSubmitting ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar'}
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting}
            />
          </SheetToolbar>

          <SheetBody>
            <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <TextArea
                id="question-prompt"
                label="Enunciado"
                required
                rows={3}
                placeholder="Ex: Qual seu fototipo de pele?"
                error={errors.prompt?.message ?? null}
                {...register('prompt')}
              />

              <SelectField
                label="Tipo de resposta"
                value={questionType}
                onValueChange={(v) => {
                  setValue('questionType', v as QuestionType, { shouldDirty: true })
                  // Mudou pra tipo sem options → limpa.
                  if (!questionNeedsOptions(v as QuestionType)) {
                    setValue('options', [], { shouldDirty: true })
                  }
                }}
                placeholder="Selecione"
                helperText={QUESTION_TYPE_HELP[questionType]}
              >
                {QUESTION_TYPE_VALUES.map((qt) => (
                  <SelectItem key={qt} value={qt}>
                    {QUESTION_TYPE_LABELS[qt]}
                  </SelectItem>
                ))}
              </SelectField>

              {needsOptions && (
                <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
                  <div className="flex items-baseline justify-between gap-2">
                    <Label>Opções de resposta</Label>
                    <span className="text-xs text-muted-foreground">
                      {optionFields.length}{' '}
                      {optionFields.length === 1 ? 'opção' : 'opções'}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {optionFields.map((field, idx) => (
                      <li key={field.id} className="flex items-center gap-2">
                        {/* eslint-disable-next-line no-restricted-syntax -- input compacto por linha da lista de opções (com botão remover) */}
                        <input
                          className={cn(
                            'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          )}
                          placeholder={`Opção ${idx + 1}`}
                          {...register(`options.${idx}.value` as const)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeOption(idx)}
                          disabled={optionFields.length <= 1}
                          aria-label="Remover opção"
                          className="h-9 w-9 text-error hover:bg-error/10"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => appendOption({ value: '' })}
                    className="self-start"
                  >
                    <Plus className="mr-1 size-4" />
                    Adicionar opção
                  </Button>
                  {errors.options?.message && (
                    <p className="text-xs text-destructive" role="alert">
                      {errors.options.message}
                    </p>
                  )}
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <TextField
                  label="Seção"
                  placeholder="Ex: Histórico médico"
                  helperText="Agrupa perguntas relacionadas no preenchimento. Opcional."
                  error={errors.section?.message ?? null}
                  {...register('section')}
                />
                {existingSections.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 px-3">
                    <span className="text-xs text-muted-foreground">
                      Já usadas:
                    </span>
                    {existingSections.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          setValue('section', s, { shouldDirty: true })
                        }
                        className={cn(
                          'rounded px-1.5 py-0.5 text-xs transition-colors',
                          sectionValue === s
                            ? 'bg-primary/15 text-primary'
                            : 'bg-muted text-muted-foreground hover:bg-muted/70',
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors',
                  required
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:bg-accent',
                )}
              >
                <Checkbox
                  checked={required}
                  onCheckedChange={(v) =>
                    setValue('required', Boolean(v), { shouldDirty: true })
                  }
                  className="mt-0.5"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium">Obrigatória</span>
                  <span className="text-xs text-muted-foreground">
                    Ficha não pode ser finalizada enquanto esta pergunta estiver
                    sem resposta.
                  </span>
                </div>
              </label>

              {/* Position fica escondido em V1 (UI usa setas no builder). Mantemos
                  registrado pra preservar valor na edição. */}
              <input type="hidden" {...register('position', { valueAsNumber: true })} />
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
