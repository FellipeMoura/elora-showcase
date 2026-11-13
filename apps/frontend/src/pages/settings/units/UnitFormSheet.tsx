import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { TextField } from '@/components/form/TextField'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useCreateUnit, useUpdateUnit } from '@/hooks/useUnits'
import type { Unit } from '@/api/units'
import { apiErrorText } from '@/lib/apiError'

const formSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(255),
})

type FormValues = z.infer<typeof formSchema>

interface UnitFormSheetProps {
  open: boolean
  unit: Unit | null
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'unit-form'
const emptyValues: FormValues = { name: '' }

function valuesFromUnit(unit: Unit | null): FormValues {
  if (!unit) return emptyValues
  return { name: unit.name }
}

export function UnitFormSheet({
  open,
  unit,
  onOpenChange,
}: UnitFormSheetProps): React.ReactElement {
  const isEdit = Boolean(unit)
  const createMutation = useCreateUnit()
  const updateMutation = useUpdateUnit()

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues,
  })

  useEffect(() => {
    if (open) reset(valuesFromUnit(unit))
  }, [open, unit, reset])

  const onSubmit = handleSubmit(async (data) => {
    try {
      if (isEdit && unit) {
        await updateMutation.mutateAsync({ id: unit.id, input: data })
        toast.success('Sala atualizada')
      } else {
        await createMutation.mutateAsync(data)
        toast.success('Sala criada')
      }
      onOpenChange(false)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const message = apiErrorText(err)
      if (status === 409) toast.error(message ?? 'Conflito ao salvar sala')
      else if (status === 400) toast.error(message ?? 'Dados inválidos')
      else toast.error('Erro ao salvar sala. Tente novamente.')
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
          <SheetToolbar srTitle={isEdit ? 'Editar sala' : 'Nova sala'}>
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
                label="Nome"
                placeholder="Sala 1"
                autoComplete="off"
                error={errors.name?.message ?? null}
                required
                {...register('name')}
              />
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
