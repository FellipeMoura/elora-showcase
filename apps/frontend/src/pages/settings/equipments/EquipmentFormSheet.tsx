import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { TextField } from '@/components/form/TextField'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  useCreateEquipment,
  useUpdateEquipment,
} from '@/hooks/useEquipments'
import type { Equipment } from '@/api/equipments'
import { apiErrorText } from '@/lib/apiError'

const formSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(255),
})

type FormValues = z.infer<typeof formSchema>

interface EquipmentFormSheetProps {
  open: boolean
  equipment: Equipment | null
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'equipment-form'
const emptyValues: FormValues = { name: '' }

function valuesFromEquipment(equipment: Equipment | null): FormValues {
  if (!equipment) return emptyValues
  return { name: equipment.name }
}

export function EquipmentFormSheet({
  open,
  equipment,
  onOpenChange,
}: EquipmentFormSheetProps): React.ReactElement {
  const isEdit = Boolean(equipment)
  const createMutation = useCreateEquipment()
  const updateMutation = useUpdateEquipment()

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
    if (open) reset(valuesFromEquipment(equipment))
  }, [open, equipment, reset])

  const onSubmit = handleSubmit(async (data) => {
    try {
      if (isEdit && equipment) {
        await updateMutation.mutateAsync({ id: equipment.id, input: data })
        toast.success('Equipamento atualizado')
      } else {
        await createMutation.mutateAsync(data)
        toast.success('Equipamento criado')
      }
      onOpenChange(false)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const message = apiErrorText(err)
      if (status === 409) toast.error(message ?? 'Conflito ao salvar equipamento')
      else if (status === 400) toast.error(message ?? 'Dados inválidos')
      else toast.error('Erro ao salvar equipamento. Tente novamente.')
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
          <SheetToolbar srTitle={isEdit ? 'Editar equipamento' : 'Novo equipamento'}>
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
                placeholder="Laser Soprano"
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
