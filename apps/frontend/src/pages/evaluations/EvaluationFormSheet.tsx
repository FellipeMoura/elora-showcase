import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { SelectField, SelectItem } from '@/components/form/SelectField'
import { TextArea } from '@/components/form/TextArea'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useCreateEvaluation } from '@/hooks/useEvaluations'
import {
  EVALUATION_KIND_LABELS,
  type EvaluationKind,
} from '@/api/evaluations'
import type { JourneyStage } from '@/api/journeys'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// Sheet de criação de avaliação clínica standalone (sem appointment).
// Usado pelo botão "Nova avaliação" no ClientDetailPage. Após criar,
// navega direto pra /evaluations/:id/forms pra preencher.
//
// Pra agendar a avaliação na agenda, usar o AppointmentFormSheet (que
// cria evaluation inline). Este sheet existe pro caso "avaliação
// retroativa / walk-in / preparação prévia de fichas".
// =====================================================================

const KIND_VALUES = ['initial', 'reevaluation', 'return'] as const satisfies readonly EvaluationKind[]

const FORM_ID = 'evaluation-form'

const formSchema = z.object({
  kind: z.enum(KIND_VALUES),
  generalNotes: z.string().trim().max(20000).optional(),
})

type FormValues = z.infer<typeof formSchema>

interface EvaluationFormSheetProps {
  open: boolean
  journeyId: string
  // Stage atual da journey. Em `treatment`/`result`, sugere `reevaluation`
  // por default (cliente já tratou — nova avaliação é pra acompanhar
  // evolução). Em `lead`/`evaluation`/`sale`, mantém `initial`. NÃO
  // bloqueia — user pode mudar livremente; é só sugestão de UX.
  journeyStage?: JourneyStage
  onOpenChange: (open: boolean) => void
}

function suggestKind(stage: JourneyStage | undefined): EvaluationKind {
  if (stage === 'treatment' || stage === 'result') return 'reevaluation'
  return 'initial'
}

function emptyValuesFor(stage: JourneyStage | undefined): FormValues {
  return {
    kind: suggestKind(stage),
    generalNotes: '',
  }
}

export function EvaluationFormSheet({
  open,
  journeyId,
  journeyStage,
  onOpenChange,
}: EvaluationFormSheetProps): React.ReactElement {
  const navigate = useNavigate()
  const createMutation = useCreateEvaluation()

  const {
    handleSubmit,
    register,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValuesFor(journeyStage),
  })

  useEffect(() => {
    if (open) reset(emptyValuesFor(journeyStage))
  }, [open, journeyStage, reset])

  const kind = watch('kind')
  const suggested = suggestKind(journeyStage)

  const onSubmit = handleSubmit(async (data) => {
    try {
      const created = await createMutation.mutateAsync({
        journeyId,
        kind: data.kind,
        generalNotes: data.generalNotes?.trim() || null,
      })
      toast.success('Avaliação criada')
      onOpenChange(false)
      // Leva direto pra preenchimento — caminho operacional padrão depois
      // de criar a entidade clínica.
      navigate(`/evaluations/${created.id}/forms`)
    } catch (err) {
      const httpStatus = (err as { response?: { status?: number } })?.response
        ?.status
      const message = apiErrorText(err)
      if (httpStatus === 409) {
        toast.error(message ?? 'Jornada não está ativa')
      } else if (httpStatus === 404) {
        toast.error(message ?? 'Jornada não encontrada')
      } else {
        toast.error('Erro ao criar avaliação')
      }
    }
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle="Nova avaliação">
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            />
            <SheetToolbar.Action
              label={isSubmitting ? 'Criando…' : 'Criar'}
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting}
            />
          </SheetToolbar>

          <SheetBody>
            <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <SelectField
                  label="Tipo"
                  value={kind}
                  onValueChange={(v) =>
                    setValue('kind', v as EvaluationKind, { shouldDirty: true })
                  }
                  placeholder="Selecione"
                  helperText={
                    kind === 'initial'
                      ? 'Primeira avaliação da jornada atual.'
                      : kind === 'reevaluation'
                        ? 'Reavaliação clínica após avaliação anterior — preserva o histórico evolutivo.'
                        : kind === 'return'
                          ? 'Retorno pra ajuste pontual (ex: avaliar resultado de sessão).'
                          : undefined
                  }
                >
                  {KIND_VALUES.map((k) => (
                    <SelectItem key={k} value={k}>
                      {EVALUATION_KIND_LABELS[k]}
                    </SelectItem>
                  ))}
                </SelectField>
                {suggested === 'reevaluation' && kind === 'initial' && (
                  <p className="px-3 text-xs text-warning">
                    A jornada já está em tratamento — geralmente uma{' '}
                    <strong>reavaliação</strong> faz mais sentido. Mas você pode
                    escolher avaliação inicial se for o caso.
                  </p>
                )}
              </div>

              <TextArea
                id="general-notes"
                label="Observações gerais"
                rows={3}
                placeholder="Contexto livre da avaliação (opcional)."
                error={errors.generalNotes?.message ?? null}
                {...register('generalNotes')}
              />
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
