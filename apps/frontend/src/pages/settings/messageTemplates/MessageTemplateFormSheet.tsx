import { useEffect, useMemo } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { TextField } from '@/components/form/TextField'
import { TextArea } from '@/components/form/TextArea'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  extractTemplateVariables,
  type MessageTemplate,
} from '@/api/messageTemplates'
import { JOURNEY_STAGES, type JourneyStage } from '@/api/journeys'
import {
  useCreateMessageTemplate,
  useUpdateMessageTemplate,
} from '@/hooks/useMessageTemplates'
import { STAGE_LABELS } from '@/pages/journeys/journeyLabels'
import { cn } from '@/lib/utils'
import { apiErrorText } from '@/lib/apiError'

// Form de criação/edição de templates de mensagem (WhatsApp).
//
// Regras:
//   - `name`: identificador interno (visível só pra equipe ao escolher
//     template no composer).
//   - `body`: corpo da mensagem. Suporta variáveis `{{nome}}` que são
//     preenchidas no momento do envio. Limite 4096 chars (limite do WhatsApp).
//   - `kind`: 'text' é V1; 'media' fica pra V2 quando templates com header
//     de mídia entrarem (Meta Cloud).
//   - `surfaceInStage`: stages do journey onde este template é "sugerido"
//     pelo composer. Lista vazia = aparece em qualquer stage.

const formSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(255),
  body: z
    .string()
    .trim()
    .min(1, 'Conteúdo obrigatório')
    .max(4096, 'Máximo 4096 caracteres'),
  kind: z.enum(['text', 'media']),
  surfaceInStage: z.array(z.enum(JOURNEY_STAGES)),
})

type FormValues = z.infer<typeof formSchema>

interface MessageTemplateFormSheetProps {
  open: boolean
  // null = criar novo. MessageTemplate = editar existente.
  template: MessageTemplate | null
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'message-template-form'
const emptyValues: FormValues = {
  name: '',
  body: '',
  kind: 'text',
  surfaceInStage: [],
}

function valuesFromTemplate(template: MessageTemplate | null): FormValues {
  if (!template) return emptyValues
  return {
    name: template.name,
    body: template.body,
    kind: template.kind,
    surfaceInStage: template.surfaceInStage ?? [],
  }
}

export function MessageTemplateFormSheet({
  open,
  template,
  onOpenChange,
}: MessageTemplateFormSheetProps): React.ReactElement {
  const isEdit = Boolean(template)
  const createMutation = useCreateMessageTemplate()
  const updateMutation = useUpdateMessageTemplate()

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues,
  })

  useEffect(() => {
    if (open) {
      reset(valuesFromTemplate(template))
    }
  }, [open, template, reset])

  const body = watch('body') ?? ''
  const surfaceInStage = watch('surfaceInStage') ?? []
  // Variáveis extraídas em tempo real do body — feedback imediato pro user
  // entender quais campos vão precisar ser preenchidos no envio.
  const variables = useMemo(() => extractTemplateVariables(body), [body])

  const toggleStage = (stage: JourneyStage): void => {
    if (surfaceInStage.includes(stage)) {
      setValue(
        'surfaceInStage',
        surfaceInStage.filter((s) => s !== stage),
        { shouldDirty: true },
      )
    } else {
      setValue('surfaceInStage', [...surfaceInStage, stage], {
        shouldDirty: true,
      })
    }
  }

  const onSubmit = handleSubmit(async (data) => {
    try {
      if (isEdit && template) {
        await updateMutation.mutateAsync({
          id: template.id,
          input: {
            name: data.name,
            body: data.body,
            kind: data.kind,
            surfaceInStage: data.surfaceInStage,
          },
        })
        toast.success('Template atualizado')
      } else {
        await createMutation.mutateAsync({
          name: data.name,
          body: data.body,
          kind: data.kind,
          surfaceInStage: data.surfaceInStage,
        })
        toast.success('Template criado')
      }
      onOpenChange(false)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status
      const message = apiErrorText(err)
      if (status === 409) {
        toast.error(message ?? 'Conflito ao salvar template')
      } else if (status === 400) {
        toast.error(message ?? 'Dados inválidos')
      } else {
        toast.error('Erro ao salvar template. Tente novamente.')
      }
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
          <SheetToolbar srTitle={isEdit ? 'Editar template' : 'Novo template'}>
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
            <form
              id={FORM_ID}
              onSubmit={onSubmit}
              className="flex flex-col gap-4"
              noValidate
            >
              <TextField
                label="Nome interno"
                placeholder="Lembrete D-1"
                helperText="Identifica o template no composer. Não aparece pro cliente."
                error={errors.name?.message ?? null}
                required
                {...register('name')}
              />

              <div className="flex flex-col gap-1.5">
                <TextArea
                  id="template-body"
                  label="Corpo da mensagem"
                  required
                  rows={6}
                  placeholder="Oi {{nome}}, lembrando da sua sessão amanhã às {{hora}}."
                  error={errors.body?.message ?? null}
                  {...register('body')}
                />
                <div className="flex items-start gap-1.5 px-3 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3 shrink-0" />
                  <span>
                    Use{' '}
                    <code className="rounded bg-muted px-1 font-mono">
                      {'{{variavel}}'}
                    </code>{' '}
                    pra campos preenchidos no envio (ex.:{' '}
                    <code className="rounded bg-muted px-1 font-mono">
                      {'{{nome}}'}
                    </code>
                    ,{' '}
                    <code className="rounded bg-muted px-1 font-mono">
                      {'{{hora}}'}
                    </code>
                    ).
                  </span>
                </div>
                {variables.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 px-3">
                    <span className="text-xs text-muted-foreground">
                      Variáveis detectadas:
                    </span>
                    {variables.map((v) => (
                      <span
                        key={v}
                        className="rounded bg-info/15 px-1.5 py-0.5 font-mono text-xs text-info"
                      >
                        {'{{'}
                        {v}
                        {'}}'}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <div>
                  <Label>Sugerir nos estágios</Label>
                  <p className="text-xs text-muted-foreground">
                    Estágios da jornada em que este template é destacado no
                    composer. Vazio = aparece em qualquer estágio.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {JOURNEY_STAGES.map((stage) => {
                    const checked = surfaceInStage.includes(stage)
                    return (
                      <label
                        key={stage}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                          checked
                            ? 'border-primary bg-primary/5'
                            : 'border-input hover:bg-accent',
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleStage(stage)}
                        />
                        <span>{STAGE_LABELS[stage]}</span>
                      </label>
                    )
                  })}
                </div>
              </div>

            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
