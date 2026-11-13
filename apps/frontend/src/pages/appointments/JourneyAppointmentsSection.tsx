import { useState } from 'react'
import { CheckCircle, Plus, UserCheck, UserX, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { displayRelativeTime } from '@/lib/format'
import {
  useAppointments,
  useAttendAppointment,
  useCancelAppointment,
  useConfirmAppointment,
  useNoShowAppointment,
} from '@/hooks/useAppointments'
import type { Appointment } from '@/api/appointments'
import type { Journey } from '@/api/journeys'
import { AppointmentFormSheet } from './AppointmentFormSheet'
import {
  APPOINTMENT_KIND_BADGE_CLASS,
  APPOINTMENT_KIND_LABELS,
  APPOINTMENT_STATUS_BADGE_CLASS,
  APPOINTMENT_STATUS_LABELS,
  formatAppointmentDateTime,
} from './appointmentLabels'
import { apiErrorText } from '@/lib/apiError'

interface JourneyAppointmentsSectionProps {
  journey: Journey
}

// Status que ainda permitem ações (não-terminais).
const ACTIVE_STATUSES = new Set(['scheduled', 'confirmed'])

export function JourneyAppointmentsSection({
  journey,
}: JourneyAppointmentsSectionProps): React.ReactElement {
  const { data, isLoading, isError } = useAppointments({
    journeyId: journey.id,
    pageSize: 100,
    sortBy: 'scheduledAt',
    sortDir: 'desc',
  })

  const [formOpen, setFormOpen] = useState(false)
  const confirm = useConfirm()

  const confirmMut = useConfirmAppointment()
  const attendMut = useAttendAppointment()
  const noShowMut = useNoShowAppointment()
  const cancelMut = useCancelAppointment()

  const journeyClosed = journey.status !== 'active'
  const items = data?.items ?? []

  const handleAction = async (
    label: string,
    mutationPromise: Promise<unknown>,
  ) => {
    try {
      await mutationPromise
      toast.success(`${label} registrado`)
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? `Erro: ${label.toLowerCase()}`)
    }
  }

  const handleConfirm = (a: Appointment) =>
    handleAction('Confirmação', confirmMut.mutateAsync(a.id))
  const handleAttend = async (a: Appointment) => {
    const ok = await confirm({
      title: 'Marcar presença?',
      description: 'Dispara cascata clínica (cria/atualiza treatment e session).',
      confirmLabel: 'Marcar presença',
      variant: 'success',
    })
    if (!ok) return
    handleAction('Presença', attendMut.mutateAsync(a.id))
  }
  const handleNoShow = async (a: Appointment) => {
    const ok = await confirm({
      title: 'Registrar não comparecimento?',
      confirmLabel: 'Registrar no-show',
      variant: 'warning',
    })
    if (!ok) return
    handleAction('No-show', noShowMut.mutateAsync(a.id))
  }
  const handleCancel = async (a: Appointment) => {
    const ok = await confirm({
      title: 'Cancelar agendamento?',
      description: 'Essa ação não pode ser desfeita.',
      confirmLabel: 'Cancelar agendamento',
      variant: 'error',
    })
    if (!ok) return
    handleAction('Cancelamento', cancelMut.mutateAsync(a.id))
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Agendamentos</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFormOpen(true)}
          disabled={journeyClosed}
          title={journeyClosed ? 'Journey encerrada' : undefined}
        >
          <Plus className="mr-1 h-4 w-4" />
          Novo agendamento
        </Button>
      </header>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {isError && (
        <p className="text-sm text-error">Erro ao carregar agendamentos.</p>
      )}
      {items.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">
          Nenhum agendamento ainda.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((a) => {
          const isActive = ACTIVE_STATUSES.has(a.status)
          const isDone = a.status === 'attended'
          return (
            <li
              key={a.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded border bg-muted/20 p-3"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${APPOINTMENT_KIND_BADGE_CLASS[a.kind]}`}
                  >
                    {APPOINTMENT_KIND_LABELS[a.kind]}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-xs font-medium ${APPOINTMENT_STATUS_BADGE_CLASS[a.status]}`}
                  >
                    {APPOINTMENT_STATUS_LABELS[a.status]}
                  </span>
                  <span className="text-sm font-medium">
                    {formatAppointmentDateTime(a.scheduledAt)} ·{' '}
                    {a.durationMinutes}min
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  Criado {displayRelativeTime(a.createdAt)}
                  {a.notes ? ` · ${a.notes}` : ''}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {isActive && (
                  <>
                    {a.status === 'scheduled' && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Confirmar"
                        title="Confirmar"
                        onClick={() => handleConfirm(a)}
                        className="h-8 w-8 text-info hover:bg-info/10"
                      >
                        <UserCheck className="h-4 w-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Marcar presença"
                      title="Marcar presença"
                      onClick={() => handleAttend(a)}
                      className="h-8 w-8 text-success hover:bg-success/10"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Não compareceu"
                      title="Não compareceu"
                      onClick={() => handleNoShow(a)}
                      className="h-8 w-8 text-warning hover:bg-warning/10"
                    >
                      <UserX className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Cancelar"
                      title="Cancelar"
                      onClick={() => handleCancel(a)}
                      className="h-8 w-8 text-error hover:bg-error/10"
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </>
                )}
                {isDone && (
                  <span className="text-xs text-muted-foreground">
                    Concluído
                  </span>
                )}
              </div>
            </li>
          )
        })}
      </ul>

      <AppointmentFormSheet
        open={formOpen}
        journey={journey}
        onOpenChange={setFormOpen}
      />
    </section>
  )
}
