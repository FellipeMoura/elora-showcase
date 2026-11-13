import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { TextField } from '@/components/form/TextField'
import { TextArea } from '@/components/form/TextArea'
import { SelectField, SelectItem } from '@/components/form/SelectField'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  useCreateException,
  useUpdateException,
} from '@/hooks/useAvailability'
import {
  SCHEDULE_EXCEPTION_KINDS,
  type ScheduleException,
  type ScheduleExceptionKind,
} from '@/api/availability'
import { EXCEPTION_KIND_LABELS } from './availabilityLabels'
import { apiErrorText } from '@/lib/apiError'

const FORM_ID = 'exception-form'
// datetime-local input dá 'YYYY-MM-DDTHH:MM' (sem segundos, sem TZ).
const dtLocalRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

const formSchema = z
  .object({
    startAt: z.string().regex(dtLocalRegex, 'Data/hora inválida'),
    endAt: z.string().regex(dtLocalRegex, 'Data/hora inválida'),
    kind: z.enum(SCHEDULE_EXCEPTION_KINDS),
    notes: z.string().trim().max(5000),
  })
  .refine((d) => new Date(d.endAt) > new Date(d.startAt), {
    message: 'endAt deve ser maior que startAt',
    path: ['endAt'],
  })

type FormValues = z.infer<typeof formSchema>

interface ExceptionFormSheetProps {
  open: boolean
  userId: string
  exception: ScheduleException | null
  onOpenChange: (open: boolean) => void
}

function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function defaultStart(): string {
  const d = new Date()
  d.setHours(8, 0, 0, 0)
  return toLocalDatetimeInput(d.toISOString())
}

function defaultEnd(): string {
  const d = new Date()
  d.setHours(18, 0, 0, 0)
  return toLocalDatetimeInput(d.toISOString())
}

function emptyValues(): FormValues {
  return {
    startAt: defaultStart(),
    endAt: defaultEnd(),
    kind: 'vacation',
    notes: '',
  }
}

function valuesFromException(e: ScheduleException | null): FormValues {
  if (!e) return emptyValues()
  return {
    startAt: toLocalDatetimeInput(e.startAt),
    endAt: toLocalDatetimeInput(e.endAt),
    kind: e.kind,
    notes: e.notes ?? '',
  }
}

// datetime-local → ISO timestamp pro backend.
function localToIso(local: string): string {
  // Cria a Date interpretando como horário local; toISOString converte pra UTC.
  // Backend salva timestamp sem TZ, e usa horário local do servidor — desde
  // que ambos estejam na mesma TZ, casa redondinho.
  return new Date(local).toISOString()
}

export function ExceptionFormSheet({
  open,
  userId,
  exception,
  onOpenChange,
}: ExceptionFormSheetProps): React.ReactElement {
  const isEdit = Boolean(exception)
  const createMutation = useCreateException()
  const updateMutation = useUpdateException()

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues(),
  })

  useEffect(() => {
    if (open) reset(valuesFromException(exception))
  }, [open, exception, reset])

  const onSubmit = handleSubmit(async (data) => {
    const payload = {
      startAt: localToIso(data.startAt),
      endAt: localToIso(data.endAt),
      kind: data.kind as ScheduleExceptionKind,
      notes: data.notes === '' ? null : data.notes,
    }
    try {
      if (isEdit && exception) {
        await updateMutation.mutateAsync({
          id: exception.id,
          input: payload,
        })
        toast.success('Exceção atualizada')
      } else {
        await createMutation.mutateAsync({ ...payload, userId })
        toast.success('Exceção criada')
      }
      onOpenChange(false)
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao salvar exceção')
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
          <SheetToolbar srTitle={isEdit ? 'Editar exceção' : 'Nova exceção'}>
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
                label="Início"
                type="datetime-local"
                error={errors.startAt?.message ?? null}
                required
                {...register('startAt')}
              />
              <TextField
                label="Fim"
                type="datetime-local"
                error={errors.endAt?.message ?? null}
                required
                {...register('endAt')}
              />

              <Controller
                control={control}
                name="kind"
                render={({ field }) => (
                  <SelectField
                    id="exception-kind"
                    label="Tipo"
                    value={field.value}
                    onValueChange={field.onChange}
                    error={errors.kind?.message ?? null}
                  >
                    {SCHEDULE_EXCEPTION_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {EXCEPTION_KIND_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectField>
                )}
              />

              <TextArea
                id="exception-notes"
                label="Observações"
                rows={3}
                placeholder="Contexto, motivo, etc."
                {...register('notes')}
              />

            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
