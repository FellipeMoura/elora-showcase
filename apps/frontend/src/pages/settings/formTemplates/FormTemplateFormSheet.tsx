import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { TextField } from '@/components/form/TextField'
import { TextArea } from '@/components/form/TextArea'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  useCreateFormTemplate,
  useUpdateFormTemplate,
} from '@/hooks/useFormTemplates'
import type { FormTemplate } from '@/api/formTemplates'
import { cn } from '@/lib/utils'
import { apiErrorText } from '@/lib/apiError'

// Form pra criar/editar o "envelope" do template. Perguntas são gerenciadas
// numa página separada (/form-templates/:id) — manter este sheet
// focado nos metadados evita um form gigante.

const formSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(255),
  description: z.string().trim().max(5000).optional(),
  requiredForEvaluation: z.boolean(),
})

type FormValues = z.infer<typeof formSchema>

interface FormTemplateFormSheetProps {
  open: boolean
  template: FormTemplate | null
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'form-template-form'

const emptyValues: FormValues = {
  name: '',
  description: '',
  requiredForEvaluation: false,
}

function valuesFromTemplate(template: FormTemplate | null): FormValues {
  if (!template) return emptyValues
  return {
    name: template.name,
    description: template.description ?? '',
    requiredForEvaluation: template.requiredForEvaluation,
  }
}

export function FormTemplateFormSheet({
  open,
  template,
  onOpenChange,
}: FormTemplateFormSheetProps): React.ReactElement {
  const isEdit = Boolean(template)
  const createMutation = useCreateFormTemplate()
  const updateMutation = useUpdateFormTemplate()

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

  const requiredForEvaluation = watch('requiredForEvaluation')

  const onSubmit = handleSubmit(async (data) => {
    try {
      const description = data.description?.trim()
        ? data.description.trim()
        : null
      if (isEdit && template) {
        await updateMutation.mutateAsync({
          id: template.id,
          input: {
            name: data.name,
            description,
            requiredForEvaluation: data.requiredForEvaluation,
          },
        })
        toast.success('Template atualizado')
      } else {
        await createMutation.mutateAsync({
          name: data.name,
          description,
          requiredForEvaluation: data.requiredForEvaluation,
        })
        toast.success('Template criado')
      }
      onOpenChange(false)
    } catch (err) {
      const httpStatus = (err as { response?: { status?: number } })?.response
        ?.status
      const message = apiErrorText(err)
      if (httpStatus === 409) {
        toast.error(message ?? 'Já existe um template com este nome.')
      } else if (httpStatus === 400) {
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
            <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <TextField
                label="Nome"
                placeholder="Ficha de avaliação inicial"
                helperText="Identifica o template ao criar fichas pra clientes."
                error={errors.name?.message ?? null}
                required
                {...register('name')}
              />

              <TextArea
                id="template-description"
                label="Descrição"
                rows={4}
                placeholder="Para que serve este template. Aparece pra equipe ao escolher."
                error={errors.description?.message ?? null}
                {...register('description')}
              />

              <label
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm transition-colors',
                  requiredForEvaluation
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:bg-accent',
                )}
              >
                <Checkbox
                  checked={requiredForEvaluation}
                  onCheckedChange={(v) =>
                    setValue('requiredForEvaluation', Boolean(v), {
                      shouldDirty: true,
                    })
                  }
                  className="mt-0.5"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="font-medium">Obrigatório pra avaliação</span>
                  <span className="text-xs text-muted-foreground">
                    Quando ligado, a ficha deste template precisa estar finalizada
                    pra mover a jornada da fase de avaliação pra venda.
                  </span>
                </div>
              </label>
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
