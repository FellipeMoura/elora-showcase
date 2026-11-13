import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { MoneyField } from '@/components/form/MoneyField'
import { TextField } from '@/components/form/TextField'
import { TextArea } from '@/components/form/TextArea'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  useCreateProcedure,
  useUpdateProcedure,
} from '@/hooks/useProcedures'
import type { Procedure } from '@/api/procedures'
import { apiErrorText } from '@/lib/apiError'

// Schema leniente — campos numéricos chegam como string do input, parse
// no submit. defaultPrice opcional (clínica pode definir só sessions agora
// e preço depois). Permite vírgula como separador decimal pra UX brasileira.
const formSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(255),
  description: z.string().trim().max(5000),
  defaultSessions: z
    .string()
    .trim()
    .min(1, 'Sessões padrão obrigatório')
    .refine((v) => /^\d+$/.test(v) && Number(v) >= 1, 'Mínimo 1 sessão'),
  defaultPrice: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\d+([.,]\d{1,2})?$/.test(v),
      'Preço inválido (use formato 450,00)',
    ),
  // input type=color sempre devolve string '#RRGGBB' — string vazia significa
  // "não definido" (resetar pra null no backend).
  color: z
    .string()
    .refine(
      (v) => v === '' || /^#[0-9a-fA-F]{6}$/.test(v),
      'Cor inválida (#RRGGBB)',
    ),
})

type FormValues = z.infer<typeof formSchema>

interface ProcedureFormSheetProps {
  open: boolean
  procedure: Procedure | null
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'procedure-form'

const emptyValues: FormValues = {
  name: '',
  description: '',
  defaultSessions: '1',
  defaultPrice: '',
  color: '',
}

function valuesFromProcedure(procedure: Procedure | null): FormValues {
  if (!procedure) return emptyValues
  return {
    name: procedure.name,
    description: procedure.description ?? '',
    defaultSessions: String(procedure.defaultSessions),
    defaultPrice: procedure.defaultPrice ?? '',
    color: procedure.color ?? '',
  }
}

export function ProcedureFormSheet({
  open,
  procedure,
  onOpenChange,
}: ProcedureFormSheetProps): React.ReactElement {
  const isEdit = Boolean(procedure)
  const createMutation = useCreateProcedure()
  const updateMutation = useUpdateProcedure()

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
      reset(valuesFromProcedure(procedure))
    }
  }, [open, procedure, reset])

  const onSubmit = handleSubmit(async (data) => {
    const priceParsed =
      data.defaultPrice === '' ? null : Number(data.defaultPrice.replace(',', '.'))

    const payload = {
      name: data.name,
      description: data.description === '' ? null : data.description,
      defaultSessions: Number(data.defaultSessions),
      defaultPrice: priceParsed,
      color: data.color === '' ? null : data.color.toLowerCase(),
    }

    try {
      if (isEdit && procedure) {
        await updateMutation.mutateAsync({ id: procedure.id, input: payload })
        toast.success('Procedimento atualizado')
      } else {
        await createMutation.mutateAsync(payload)
        toast.success('Procedimento criado')
      }
      onOpenChange(false)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status
      const message = apiErrorText(err)
      if (status === 409) {
        toast.error(message ?? 'Conflito ao salvar procedimento')
      } else if (status === 400) {
        toast.error(message ?? 'Dados inválidos')
      } else {
        toast.error('Erro ao salvar procedimento. Tente novamente.')
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
          <SheetToolbar
            srTitle={isEdit ? 'Editar procedimento' : 'Novo procedimento'}
          >
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
                placeholder="Laser axila"
                autoComplete="off"
                error={errors.name?.message ?? null}
                required
                {...register('name')}
              />

              <TextArea
                id="procedure-description"
                label="Descrição"
                rows={3}
                placeholder="Descrição visível em orçamentos e fichas"
                error={errors.description?.message ?? null}
                {...register('description')}
              />

              <TextField
                label="Sessões padrão"
                type="number"
                min={1}
                max={999}
                helperText="Quantas sessões costumam ser sugeridas pra fechar o tratamento."
                error={errors.defaultSessions?.message ?? null}
                required
                {...register('defaultSessions')}
              />

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="procedure-color"
                  className="text-sm font-medium leading-none"
                >
                  Cor (agenda)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="procedure-color"
                    type="color"
                    className="h-9 w-12 cursor-pointer rounded border border-input bg-background"
                    {...register('color')}
                  />
                  <TextField
                    label="Hex"
                    placeholder="#RRGGBB ou vazio"
                    containerClassName="flex-1"
                    className="font-mono"
                    {...register('color')}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Cor que aparece no card da agenda quando preferência do user
                  estiver em "destaque por procedimento". Vazio = neutro.
                </p>
                {errors.color?.message && (
                  <p className="text-xs text-destructive" role="alert">
                    {errors.color.message}
                  </p>
                )}
              </div>

              {/* Form guarda o preço como string; zerado = não definido. */}
              <MoneyField
                label="Preço sugerido (por sessão)"
                helperText="Opcional. Pode ser sobrescrito por orçamento."
                error={errors.defaultPrice?.message ?? null}
                value={watch('defaultPrice')}
                onValueChange={(v) =>
                  setValue('defaultPrice', v > 0 ? v.toFixed(2) : '', {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
