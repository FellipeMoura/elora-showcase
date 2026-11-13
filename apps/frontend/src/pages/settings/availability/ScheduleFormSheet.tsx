import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { TextField } from '@/components/form/TextField'
import { SelectField, SelectItem } from '@/components/form/SelectField'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  useCreateSchedule,
  useUpdateSchedule,
} from '@/hooks/useAvailability'
import {
  WEEKDAYS,
  type ProfessionalSchedule,
  type Weekday,
} from '@/api/availability'
import { WEEKDAY_LABELS, formatTime } from './availabilityLabels'
import { apiErrorText } from '@/lib/apiError'

const FORM_ID = 'schedule-form'
const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/
const dateRegex = /^\d{4}-\d{2}-\d{2}$/

const formSchema = z
  .object({
    dayOfWeek: z.enum(WEEKDAYS),
    startTime: z
      .string()
      .regex(timeRegex, 'Hora inválida (HH:MM)'),
    endTime: z.string().regex(timeRegex, 'Hora inválida (HH:MM)'),
    effectiveFrom: z
      .string()
      .regex(dateRegex, 'Data inválida (YYYY-MM-DD)')
      .or(z.literal('')),
    effectiveTo: z
      .string()
      .regex(dateRegex, 'Data inválida (YYYY-MM-DD)')
      .or(z.literal('')),
  })
  .refine((d) => toMin(d.endTime) > toMin(d.startTime), {
    message: 'endTime deve ser maior que startTime',
    path: ['endTime'],
  })

function toMin(t: string): number {
  const [h, m] = t.split(':')
  return Number(h) * 60 + Number(m)
}

type FormValues = z.infer<typeof formSchema>

interface ScheduleFormSheetProps {
  open: boolean
  userId: string
  schedule: ProfessionalSchedule | null
  // Default dayOfWeek quando criando (vindo do botão "+" de um dia específico).
  // Ignorado quando editando.
  defaultDay?: Weekday | null
  onOpenChange: (open: boolean) => void
}

function todayIso(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function emptyValues(defaultDay: Weekday = 'mon'): FormValues {
  return {
    dayOfWeek: defaultDay,
    startTime: '08:00',
    endTime: '12:00',
    effectiveFrom: todayIso(),
    effectiveTo: '',
  }
}

function valuesFromSchedule(s: ProfessionalSchedule | null): FormValues {
  if (!s) return emptyValues()
  return {
    dayOfWeek: s.dayOfWeek,
    startTime: formatTime(s.startTime),
    endTime: formatTime(s.endTime),
    effectiveFrom: s.effectiveFrom,
    effectiveTo: s.effectiveTo ?? '',
  }
}

export function ScheduleFormSheet({
  open,
  userId,
  schedule,
  defaultDay,
  onOpenChange,
}: ScheduleFormSheetProps): React.ReactElement {
  const isEdit = Boolean(schedule)
  const createMutation = useCreateSchedule()
  const updateMutation = useUpdateSchedule()

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
    if (open) {
      reset(schedule ? valuesFromSchedule(schedule) : emptyValues(defaultDay ?? 'mon'))
    }
  }, [open, schedule, defaultDay, reset])

  const onSubmit = handleSubmit(async (data) => {
    const payload = {
      dayOfWeek: data.dayOfWeek,
      startTime: data.startTime,
      endTime: data.endTime,
      effectiveFrom: data.effectiveFrom === '' ? undefined : data.effectiveFrom,
      effectiveTo: data.effectiveTo === '' ? null : data.effectiveTo,
    }
    try {
      if (isEdit && schedule) {
        await updateMutation.mutateAsync({
          id: schedule.id,
          input: payload,
        })
        toast.success('Janela atualizada')
      } else {
        await createMutation.mutateAsync({ ...payload, userId })
        toast.success('Janela criada')
      }
      onOpenChange(false)
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao salvar janela')
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
          <SheetToolbar srTitle={isEdit ? 'Editar janela' : 'Nova janela'}>
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
              <Controller
                control={control}
                name="dayOfWeek"
                render={({ field }) => (
                  <SelectField
                    id="schedule-day"
                    label="Dia da semana"
                    value={String(field.value)}
                    onValueChange={field.onChange}
                    disabled={isEdit}
                    helperText={
                      isEdit
                        ? 'Dia da semana não é editável — apague e recrie pra mudar.'
                        : undefined
                    }
                    error={errors.dayOfWeek?.message ?? null}
                  >
                    {WEEKDAYS.map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {WEEKDAY_LABELS[d]}
                      </SelectItem>
                    ))}
                  </SelectField>
                )}
              />

              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Início"
                  type="time"
                  error={errors.startTime?.message ?? null}
                  required
                  {...register('startTime')}
                />
                <TextField
                  label="Fim"
                  type="time"
                  error={errors.endTime?.message ?? null}
                  required
                  {...register('endTime')}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label="Vigente a partir de"
                  type="date"
                  helperText="Default: hoje"
                  error={errors.effectiveFrom?.message ?? null}
                  {...register('effectiveFrom')}
                />
                <TextField
                  label="Até (opcional)"
                  type="date"
                  helperText="Vazio = sem prazo"
                  error={errors.effectiveTo?.message ?? null}
                  {...register('effectiveTo')}
                />
              </div>

            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
