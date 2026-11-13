import { CheckCircle, Eye, UserCheck, UserX, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { useUsers } from '@/hooks/useUsers'
import {
  useAppointments,
  useAttendAppointment,
  useCancelAppointment,
  useConfirmAppointment,
  useNoShowAppointment,
} from '@/hooks/useAppointments'
import type { Appointment } from '@/api/appointments'
import { ClientLabel } from '@/pages/journeys/ClientLabel'
import {
  APPOINTMENT_KIND_BADGE_CLASS,
  APPOINTMENT_KIND_LABELS,
  APPOINTMENT_STATUS_BADGE_CLASS,
  APPOINTMENT_STATUS_LABELS,
} from './appointmentLabels'
import { apiErrorText } from '@/lib/apiError'

const ACTIVE_STATUSES = new Set(['scheduled', 'confirmed'])

function formatTimeOfDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface AppointmentsListViewProps {
  dateFrom: string
  dateTo: string
  /** Filtra por profissional. Vazio = todos. */
  professionalId?: string
}

export function AppointmentsListView({
  dateFrom,
  dateTo,
  professionalId,
}: AppointmentsListViewProps): React.ReactElement {
  const navigate = useNavigate()
  const confirm = useConfirm()

  const usersQuery = useUsers({ page: 1, pageSize: 100, status: 'active' })
  const userNameById = new Map<string, string>()
  for (const u of usersQuery.data?.items ?? []) userNameById.set(u.id, u.name)

  const { data, isLoading, isError, isFetching, refetch } = useAppointments({
    dateFrom,
    dateTo,
    professionalId: professionalId || undefined,
    pageSize: 200,
    sortBy: 'scheduledAt',
    sortDir: 'asc',
  })

  const confirmMut = useConfirmAppointment()
  const attendMut = useAttendAppointment()
  const noShowMut = useNoShowAppointment()
  const cancelMut = useCancelAppointment()

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

  const handleNoShow = async (a: Appointment) => {
    const ok = await confirm({
      title: 'Registrar não comparecimento?',
      confirmLabel: 'Registrar no-show',
      variant: 'warning',
    })
    if (!ok) return
    handleAction('No-show', noShowMut.mutateAsync(a.id))
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto rounded-md border bg-background p-2">
      {isLoading && (
        <div className="p-4 text-sm text-muted-foreground">Carregando…</div>
      )}
      {isError && (
        <div className="p-4 text-sm text-error">
          Erro ao carregar agendamentos.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => refetch()}
          >
            Tentar novamente
          </button>
        </div>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <div className="p-4 text-sm text-muted-foreground">
          Sem agendamentos para esse período.
        </div>
      )}

      {items.map((a) => {
        const isActive = ACTIVE_STATUSES.has(a.status)
        return (
          <div
            key={a.id}
            className="flex flex-wrap items-center gap-3 rounded-md border bg-muted/20 px-4 py-3"
          >
            <div className="flex shrink-0 flex-col items-center justify-center rounded bg-muted px-3 py-2">
              <span className="text-base font-semibold tabular-nums">
                {formatTimeOfDay(a.scheduledAt)}
              </span>
              <span className="text-xs text-muted-foreground">
                {a.durationMinutes}min
              </span>
            </div>

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
              </div>
              <ClientLabel clientId={a.clientId} />
              <div className="text-xs text-muted-foreground">
                {a.professionalId
                  ? userNameById.get(a.professionalId) ??
                    a.professionalId.slice(0, 8)
                  : 'Sem profissional'}
                {a.notes ? ` · ${a.notes}` : ''}
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Ver journey"
                title="Ver journey"
                onClick={() => navigate(`/journeys/${a.journeyId}`)}
                className="h-8 w-8"
              >
                <Eye className="h-4 w-4" />
              </Button>
              {isActive && (
                <>
                  {a.status === 'scheduled' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Confirmar"
                      title="Confirmar"
                      onClick={() =>
                        handleAction(
                          'Confirmação',
                          confirmMut.mutateAsync(a.id),
                        )
                      }
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
            </div>
          </div>
        )
      })}

      {isFetching && items.length > 0 && (
        <div className="text-center text-xs text-muted-foreground">
          atualizando…
        </div>
      )}
    </div>
  )
}
