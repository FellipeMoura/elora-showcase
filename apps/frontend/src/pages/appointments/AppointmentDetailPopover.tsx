import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  CheckCircle,
  ExternalLink,
  Pencil,
  PenLine,
  UserCheck,
  UserX,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { useNavigate } from 'react-router-dom'
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import {
  useAttendAppointment,
  useCancelAppointment,
  useConfirmAppointment,
  useNoShowAppointment,
} from '@/hooks/useAppointments'
import { useClient } from '@/hooks/useClients'
import { useProcedureSession } from '@/hooks/useProcedureSessions'
import type { Appointment } from '@/api/appointments'
import type { ProcedureSession } from '@/api/procedureSessions'
import {
  APPOINTMENT_KIND_BADGE_CLASS,
  APPOINTMENT_KIND_LABELS,
  APPOINTMENT_STATUS_BADGE_CLASS,
  APPOINTMENT_STATUS_LABELS,
  formatAppointmentDateTime,
} from './appointmentLabels'
import { apiErrorText } from '@/lib/apiError'

interface AppointmentDetailPopoverProps {
  appointment: Appointment | null
  anchor: HTMLElement | null
  onClose: () => void
  // Disparado quando "Marcar presença" é clicado em appointment kind=procedure.
  // CalendarPage hospeda o SessionAttendanceSheet — fica vivo mesmo depois
  // do popover fechar. Pra kind=evaluation o popover trata internamente.
  onMarkProcedureAttendance?: (appointment: Appointment) => void
  // Disparado quando "Ver assinatura" é clicado em appointment kind=procedure
  // já atendido. CalendarPage hospeda o SignatureViewSheet.
  onViewAttendance?: (appointment: Appointment) => void
  // Disparado quando "Registrar evolução" é clicado em appointment com
  // session em status `signed`. EvolutionsPage hospeda o SessionEvolutionSheet.
  // Se não for passado, a ação não aparece (gate por integração — agenda
  // padrão não foca em evolução; quem foca é a /evolutions).
  onEvolveSession?: (appointment: Appointment, session: ProcedureSession) => void
  // Disparado quando "Editar" é clicado (só status ativo). O host abre o
  // AppointmentFormSheet em modo edição — sheet vive fora do popover.
  onEdit?: (appointment: Appointment) => void
}

const ACTIVE_STATUSES = new Set(['scheduled', 'confirmed'])

export function AppointmentDetailPopover({
  appointment,
  anchor,
  onClose,
  onMarkProcedureAttendance,
  onViewAttendance,
  onEvolveSession,
  onEdit,
}: AppointmentDetailPopoverProps): React.ReactElement | null {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { data: client } = useClient(appointment?.clientId)
  // Sessão é resolvida pra decidir se a ação "Registrar evolução" aparece.
  // Só busca quando `onEvolveSession` é fornecido — agenda principal não
  // chama esse fetch desnecessariamente.
  const sessionId =
    appointment?.kind === 'procedure'
      ? appointment.procedureSessionId ?? undefined
      : undefined
  const { data: session } = useProcedureSession(
    sessionId,
    Boolean(onEvolveSession) && Boolean(sessionId),
  )

  const confirmMut = useConfirmAppointment()
  const attendMut = useAttendAppointment()
  const noShowMut = useNoShowAppointment()
  const cancelMut = useCancelAppointment()

  // Sincroniza open state com presença de anchor+appointment.
  const [open, setOpen] = useState(false)
  // PopoverAnchor.virtualRef precisa de um ref mutable que aponta pro
  // Measurable (qualquer coisa com getBoundingClientRect). Sincronizamos
  // sempre que mudar. Cast pra `Measurable` (= HTMLElement) — null é
  // resolvido pelo early-return abaixo.
  const virtualRef = useRef<HTMLElement>(anchor as HTMLElement)
  useEffect(() => {
    if (anchor) virtualRef.current = anchor
    setOpen(Boolean(appointment && anchor))
  }, [appointment, anchor])

  if (!appointment || !anchor) return null

  const isActive = ACTIVE_STATUSES.has(appointment.status)
  // "Ver assinatura" só faz sentido em procedure já atendido. Evaluation
  // não passa pelo fluxo de assinatura; status terminal não-attended
  // (cancelled, no_show) também não.
  const canViewAttendance =
    appointment.kind === 'procedure' && appointment.status === 'attended'
  // "Registrar evolução" só pra procedure attended com sessão `signed`.
  // Pendente (sem assinatura) ou done (já evoluída) não entra.
  const canEvolve =
    Boolean(onEvolveSession) &&
    appointment.kind === 'procedure' &&
    appointment.status === 'attended' &&
    session?.status === 'signed'

  const handleAction = async (
    label: string,
    mutationPromise: Promise<unknown>,
  ) => {
    try {
      await mutationPromise
      toast.success(`${label} registrado`)
      onClose()
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? `Erro: ${label.toLowerCase()}`)
    }
  }

  const handleConfirm = () =>
    handleAction('Confirmação', confirmMut.mutateAsync(appointment.id))

  const handleAttend = async () => {
    // kind=procedure → delega pro CalendarPage abrir o SessionAttendanceSheet.
    // O sheet vive fora do popover pra sobreviver ao fechamento dele.
    if (appointment.kind === 'procedure') {
      onMarkProcedureAttendance?.(appointment)
      onClose()
      return
    }
    // kind=evaluation → fluxo direto (avaliação não exige assinatura).
    const ok = await confirm({
      title: 'Marcar presença?',
      description: 'Marca a avaliação como realizada.',
      confirmLabel: 'Marcar presença',
      variant: 'success',
    })
    if (!ok) return
    handleAction('Presença', attendMut.mutateAsync(appointment.id))
  }

  const handleNoShow = async () => {
    const ok = await confirm({
      title: 'Registrar não comparecimento?',
      confirmLabel: 'Registrar no-show',
      variant: 'warning',
    })
    if (!ok) return
    handleAction('No-show', noShowMut.mutateAsync(appointment.id))
  }

  const handleCancel = async () => {
    const ok = await confirm({
      title: 'Cancelar agendamento?',
      description: 'Essa ação não pode ser desfeita.',
      confirmLabel: 'Cancelar agendamento',
      variant: 'error',
    })
    if (!ok) return
    handleAction('Cancelamento', cancelMut.mutateAsync(appointment.id))
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (!o) onClose()
      }}
    >
      {/* Anchor virtual via PopoverAnchor — ref aponta pro DOM do card. */}
      <PopoverAnchor virtualRef={virtualRef} />
      <PopoverContent
        side="right"
        align="start"
        sideOffset={8}
        className="w-72 p-0"
      >
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${APPOINTMENT_KIND_BADGE_CLASS[appointment.kind]}`}
            >
              {APPOINTMENT_KIND_LABELS[appointment.kind]}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${APPOINTMENT_STATUS_BADGE_CLASS[appointment.status]}`}
            >
              {APPOINTMENT_STATUS_LABELS[appointment.status]}
            </span>
          </div>
          <div className="text-sm font-medium">
            {client ? client.name : 'Carregando…'}
          </div>
          <div className="text-xs text-muted-foreground">
            {formatAppointmentDateTime(appointment.scheduledAt)} ·{' '}
            {appointment.durationMinutes}min
          </div>
          {appointment.notes && (
            <p className="text-xs text-foreground/80">{appointment.notes}</p>
          )}
        </div>

        <div className="flex flex-col p-1">
          {isActive && (
            <>
              {onEdit && (
                <ActionRow
                  icon={Pencil}
                  label="Editar"
                  onClick={() => {
                    onEdit(appointment)
                    onClose()
                  }}
                />
              )}
              {appointment.status === 'scheduled' && (
                <ActionRow
                  icon={UserCheck}
                  label="Confirmar"
                  tone="info"
                  onClick={handleConfirm}
                  disabled={confirmMut.isPending}
                />
              )}
              <ActionRow
                icon={CheckCircle}
                label="Marcar presença"
                tone="success"
                onClick={handleAttend}
                disabled={attendMut.isPending}
              />
              <ActionRow
                icon={UserX}
                label="Não compareceu"
                tone="warning"
                onClick={handleNoShow}
                disabled={noShowMut.isPending}
              />
              <ActionRow
                icon={XCircle}
                label="Cancelar agendamento"
                tone="error"
                onClick={handleCancel}
                disabled={cancelMut.isPending}
              />
              <div className="my-1 border-t border-border" />
            </>
          )}
          {canEvolve && session && (
            <>
              <ActionRow
                icon={PenLine}
                label="Registrar evolução"
                tone="success"
                onClick={() => {
                  onEvolveSession?.(appointment, session)
                  onClose()
                }}
              />
            </>
          )}
          {canViewAttendance && (
            <>
              <ActionRow
                icon={PenLine}
                label="Ver assinatura"
                tone="info"
                onClick={() => {
                  onViewAttendance?.(appointment)
                  onClose()
                }}
              />
              <div className="my-1 border-t border-border" />
            </>
          )}
          <ActionRow
            icon={ExternalLink}
            label="Abrir journey"
            onClick={() => {
              navigate(`/journeys/${appointment.journeyId}`)
              onClose()
            }}
          />
          {client && (
            <ActionRow
              icon={ArrowRight}
              label="Abrir cliente"
              onClick={() => {
                navigate(`/clients/${client.id}`)
                onClose()
              }}
            />
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

interface ActionRowProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  tone?: 'info' | 'success' | 'warning' | 'error'
  onClick: () => void
  disabled?: boolean
}

function ActionRow({
  icon: Icon,
  label,
  tone,
  onClick,
  disabled,
}: ActionRowProps): React.ReactElement {
  const toneClass =
    tone === 'info'
      ? 'text-info'
      : tone === 'success'
        ? 'text-success'
        : tone === 'warning'
          ? 'text-warning'
          : tone === 'error'
            ? 'text-error'
            : 'text-foreground'
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      disabled={disabled}
      className="h-9 w-full justify-start gap-2 px-2 text-sm"
    >
      <Icon className={`h-4 w-4 ${toneClass}`} />
      <span className="flex-1 text-left">{label}</span>
    </Button>
  )
}
