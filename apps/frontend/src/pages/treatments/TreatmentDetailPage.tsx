import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  CircleDot,
  ClipboardX,
  Lock,
  PenLine,
  Pencil,
  RotateCcw,
  Signature,
  SquareArrowOutUpRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useAppointments } from '@/hooks/useAppointments'
import { useClient } from '@/hooks/useClients'
import { useProcedures } from '@/hooks/useProcedures'
import {
  useCloseTreatmentManually,
  useReopenTreatment,
  useTreatment,
} from '@/hooks/useTreatments'
import { useUsers } from '@/hooks/useUsers'
import type { Appointment } from '@/api/appointments'
import type { ProcedureSession } from '@/api/procedureSessions'
import type { Treatment } from '@/api/treatments'
import {
  APPOINTMENT_STATUS_LABELS,
  formatAppointmentDateTime,
} from '@/pages/appointments/appointmentLabels'
import { SessionEvolutionSheet } from '@/pages/appointments/SessionEvolutionSheet'
import { SignatureViewSheet } from '@/pages/appointments/SignatureViewSheet'
import { displayDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  TREATMENT_STATUS_BADGE_CLASS,
  TREATMENT_STATUS_LABELS,
} from './treatmentLabels'
import { TreatmentEditSheet } from './TreatmentEditSheet'
import { apiErrorText } from '@/lib/apiError'

export function TreatmentDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()
  const detail = useTreatment(id)
  const treatment = detail.data?.treatment
  const sessions = detail.data?.sessions ?? []

  const client = useClient(treatment?.clientId)
  // Lookup de procedure name + appointments do cliente segue o pattern
  // usado em ClientDetailPage — pageSize grande pra cobrir o histórico
  // sem N+1.
  const procedures = useProcedures({
    page: 1,
    pageSize: 200,
    status: 'all',
  })
  const procedureAppointments = useAppointments(
    {
      clientId: treatment?.clientId,
      kind: 'procedure',
      pageSize: 200,
    },
    Boolean(treatment?.clientId),
  )
  // Usuários pra resolver nome do aplicador (executedByUserId / appointment.professionalId).
  const usersQuery = useUsers({ page: 1, pageSize: 200, status: 'all' })

  const procedureNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of procedures.data?.items ?? []) m.set(p.id, p.name)
    return m
  }, [procedures.data])

  const userNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of usersQuery.data?.items ?? []) m.set(u.id, u.name)
    return m
  }, [usersQuery.data])

  // sessionId → appointment mais recente. Mesma heurística do
  // ClientDetailPage: ignora cancelled; em duplicatas mantém o mais recente.
  const appointmentBySessionId = useMemo(() => {
    const m = new Map<string, Appointment>()
    for (const a of procedureAppointments.data?.items ?? []) {
      if (
        a.procedureSessionId &&
        a.status !== 'cancelled' &&
        (!m.has(a.procedureSessionId) ||
          new Date(m.get(a.procedureSessionId)!.scheduledAt) <
            new Date(a.scheduledAt))
      ) {
        m.set(a.procedureSessionId, a)
      }
    }
    return m
  }, [procedureAppointments.data])

  // Agrupa sessões por procedimento — visualmente útil pra ver "Depilação
  // Axila (3/5)" mesmo que o nome do treatment não destaque isso.
  const groupedByProcedure = useMemo(() => {
    const groups = new Map<
      string,
      { procedureId: string; procedureName: string; sessions: ProcedureSession[] }
    >()
    for (const s of sessions) {
      const key = s.procedureId
      const existing = groups.get(key)
      if (existing) {
        existing.sessions.push(s)
      } else {
        groups.set(key, {
          procedureId: key,
          procedureName: procedureNameById.get(key) ?? '—',
          sessions: [s],
        })
      }
    }
    return [...groups.values()]
  }, [sessions, procedureNameById])

  const closeMut = useCloseTreatmentManually()
  const reopenMut = useReopenTreatment()

  const [editOpen, setEditOpen] = useState(false)
  const [evolveSession, setEvolveSession] = useState<ProcedureSession | null>(
    null,
  )
  const [signatureAppointmentId, setSignatureAppointmentId] = useState<
    string | null
  >(null)

  if (!id) {
    return (
      <PageContainer>
        <p className="p-4 text-sm text-error">ID inválido.</p>
      </PageContainer>
    )
  }

  const handleCloseManually = async (): Promise<void> => {
    if (!treatment) return
    const ok = await confirm({
      title: `Fechar manualmente "${treatment.name}"?`,
      description:
        'Sessões pendentes ficam preservadas mas o tratamento sai do fluxo ativo.',
      confirmLabel: 'Fechar',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await closeMut.mutateAsync({ id: treatment.id, input: {} })
      toast.success('Tratamento fechado')
    } catch (err) {
      const message =
        apiErrorText(err) ?? 'Falha ao fechar tratamento'
      toast.error(message)
    }
  }

  const handleReopen = async (): Promise<void> => {
    if (!treatment) return
    const ok = await confirm({
      title: `Reabrir "${treatment.name}"?`,
      description:
        'Status volta pra ativo e a jornada do cliente volta pra etapa de tratamento.',
      confirmLabel: 'Reabrir',
    })
    if (!ok) return
    try {
      await reopenMut.mutateAsync(treatment.id)
      toast.success('Tratamento reaberto')
    } catch (err) {
      const message =
        apiErrorText(err) ?? 'Falha ao reabrir tratamento'
      toast.error(message)
    }
  }

  const isActive = treatment?.status === 'active'
  const canReopen =
    treatment?.status === 'completed' || treatment?.status === 'manually_closed'

  const sessionsTotal = sessions.length
  const sessionsDone = sessions.filter((s) => s.status === 'done').length

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Action
          icon={<ArrowLeft />}
          onClick={() => navigate('/treatments')}
          variant="ghost"
          aria-label="Voltar"
          placement="leading"
        />
        {treatment && (
          <>
            <PageToolbar.Action
              label="Editar"
              icon={<Pencil />}
              onClick={() => setEditOpen(true)}
              variant="outline"
            />
            {isActive && (
              <PageToolbar.Action
                label="Fechar manualmente"
                icon={<Lock />}
                onClick={handleCloseManually}
                variant="outline"
              />
            )}
            {canReopen && (
              <PageToolbar.Action
                label="Reabrir"
                icon={<RotateCcw />}
                onClick={handleReopen}
                variant="outline"
              />
            )}
          </>
        )}
      </PageToolbar>

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {detail.isLoading && (
          <p className="p-4 text-sm text-muted-foreground">Carregando…</p>
        )}
        {detail.isError && (
          <p className="p-4 text-sm text-error">
            Erro ao carregar tratamento.
          </p>
        )}

        {treatment && (
          <>
            <IdentificationSection
              treatment={treatment}
              clientName={client.data?.name}
              sessionsTotal={sessionsTotal}
              sessionsDone={sessionsDone}
            />

            <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
              <header className="flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">
                  Sessões e procedimentos
                </h2>
                {sessionsTotal > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {sessionsDone}/{sessionsTotal} concluídas
                  </span>
                )}
              </header>

              {sessionsTotal === 0 && (
                <p className="text-sm text-muted-foreground">
                  Sem procedimentos vinculados.
                </p>
              )}

              <ul className="flex flex-col gap-3">
                {groupedByProcedure.map((group) => (
                  <ProcedureGroup
                    key={group.procedureId}
                    procedureName={group.procedureName}
                    sessions={group.sessions}
                    appointmentBySessionId={appointmentBySessionId}
                    userNameById={userNameById}
                    onEvolve={(s) => setEvolveSession(s)}
                    onViewSignature={(appointmentId) =>
                      setSignatureAppointmentId(appointmentId)
                    }
                  />
                ))}
              </ul>
            </section>
          </>
        )}
      </div>

      <TreatmentEditSheet
        open={editOpen}
        onOpenChange={setEditOpen}
        treatment={treatment ?? null}
      />

      <SessionEvolutionSheet
        open={evolveSession !== null}
        onOpenChange={(o) => {
          if (!o) setEvolveSession(null)
        }}
        session={evolveSession}
        onViewSignature={() => {
          if (!evolveSession) return
          const apt = appointmentBySessionId.get(evolveSession.id)
          if (apt) setSignatureAppointmentId(apt.id)
        }}
      />

      <SignatureViewSheet
        open={signatureAppointmentId !== null}
        onOpenChange={(o) => {
          if (!o) setSignatureAppointmentId(null)
        }}
        appointmentId={signatureAppointmentId}
      />
    </PageContainer>
  )
}

function IdentificationSection({
  treatment,
  clientName,
  sessionsTotal,
  sessionsDone,
}: {
  treatment: Treatment
  clientName: string | undefined
  sessionsTotal: number
  sessionsDone: number
}): React.ReactElement {
  const pct =
    sessionsTotal > 0 ? Math.round((sessionsDone / sessionsTotal) * 100) : 0
  return (
    <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-base font-semibold">{treatment.name}</h1>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium',
              TREATMENT_STATUS_BADGE_CLASS[treatment.status],
            )}
          >
            {TREATMENT_STATUS_LABELS[treatment.status]}
          </span>
        </div>
      </header>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm sm:grid-cols-4">
        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Cliente</dt>
          <dd>
            <Link
              to={`/clients/${treatment.clientId}`}
              className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              {clientName ?? '—'}
              <SquareArrowOutUpRight className="size-3" />
            </Link>
          </dd>
        </div>

        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Jornada</dt>
          <dd>
            <Link
              to={`/journeys/${treatment.journeyId}`}
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Abrir jornada
              <SquareArrowOutUpRight className="size-3" />
            </Link>
          </dd>
        </div>

        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Iniciado em</dt>
          <dd>{treatment.startedAt ? displayDateTime(treatment.startedAt) : '—'}</dd>
        </div>

        <div className="flex flex-col gap-0.5">
          <dt className="text-xs text-muted-foreground">Concluído em</dt>
          <dd>
            {treatment.completedAt
              ? displayDateTime(treatment.completedAt)
              : '—'}
          </dd>
        </div>
      </dl>

      {sessionsTotal > 0 && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Progresso</span>
            <span>
              {sessionsDone}/{sessionsTotal} ({pct}%)
            </span>
          </div>
          <span className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full bg-success transition-all"
              style={{ width: `${pct}%` }}
            />
          </span>
        </div>
      )}

      {treatment.notes && (
        <div className="flex flex-col gap-1 border-t pt-3">
          <span className="text-xs font-medium text-muted-foreground">
            Observações
          </span>
          <p className="whitespace-pre-wrap text-sm">{treatment.notes}</p>
        </div>
      )}
    </section>
  )
}

const SESSION_STATUS_LABEL: Record<ProcedureSession['status'], string> = {
  pending: 'Pendente',
  signed: 'Aguardando evolução',
  done: 'Realizada',
  cancelled: 'Cancelada',
}

const SESSION_STATUS_CLASS: Record<ProcedureSession['status'], string> = {
  pending: 'bg-muted text-muted-foreground',
  signed: 'bg-warning-soft text-warning-soft-foreground',
  done: 'bg-success/15 text-success',
  cancelled: 'bg-error/15 text-error',
}

const SESSION_STATUS_ICON: Record<
  ProcedureSession['status'],
  React.ComponentType<{ className?: string }>
> = {
  pending: CircleDot,
  signed: AlertCircle,
  done: CheckCircle2,
  cancelled: ClipboardX,
}

function ProcedureGroup({
  procedureName,
  sessions,
  appointmentBySessionId,
  userNameById,
  onEvolve,
  onViewSignature,
}: {
  procedureName: string
  sessions: ProcedureSession[]
  appointmentBySessionId: Map<string, Appointment>
  userNameById: Map<string, string>
  onEvolve: (s: ProcedureSession) => void
  onViewSignature: (appointmentId: string) => void
}): React.ReactElement {
  const done = sessions.filter((s) => s.status === 'done').length
  const sorted = [...sessions].sort((a, b) => {
    const ta = a.executedAt
      ? new Date(a.executedAt).getTime()
      : a.createdAt
        ? new Date(a.createdAt).getTime()
        : 0
    const tb = b.executedAt
      ? new Date(b.executedAt).getTime()
      : b.createdAt
        ? new Date(b.createdAt).getTime()
        : 0
    return ta - tb
  })

  return (
    <li className="flex flex-col gap-2 rounded border bg-muted/20 p-3">
      <header className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{procedureName}</span>
        <span className="text-xs text-muted-foreground">
          {done}/{sessions.length} concluídas
        </span>
      </header>

      <ol className="flex flex-col gap-2">
        {sorted.map((s, idx) => (
          <SessionRow
            key={s.id}
            index={idx + 1}
            session={s}
            appointment={appointmentBySessionId.get(s.id)}
            professionalName={
              s.executedByUserId
                ? (userNameById.get(s.executedByUserId) ?? null)
                : null
            }
            onEvolve={() => onEvolve(s)}
            onViewSignature={(appointmentId) => onViewSignature(appointmentId)}
          />
        ))}
      </ol>
    </li>
  )
}

function SessionRow({
  index,
  session,
  appointment,
  professionalName,
  onEvolve,
  onViewSignature,
}: {
  index: number
  session: ProcedureSession
  appointment: Appointment | undefined
  professionalName: string | null
  onEvolve: () => void
  onViewSignature: (appointmentId: string) => void
}): React.ReactElement {
  const StatusIcon = SESSION_STATUS_ICON[session.status]
  const isSigned = session.status === 'signed'
  const isDone = session.status === 'done'
  const canEvolve = isSigned || isDone
  // Assinatura existe a partir de `signed` — backend grava attendance ao
  // assinar, antes da evolução. Sessões `pending`/`cancelled` não têm.
  const canViewSignature =
    Boolean(appointment) && (isSigned || isDone)

  return (
    <li className="flex flex-col gap-2 rounded border bg-background p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
            {index}
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium',
                  SESSION_STATUS_CLASS[session.status],
                )}
              >
                <StatusIcon className="size-3" />
                {SESSION_STATUS_LABEL[session.status]}
              </span>
              {appointment && (
                <span className="text-xs text-muted-foreground">
                  {formatAppointmentDateTime(appointment.scheduledAt)} ·{' '}
                  {APPOINTMENT_STATUS_LABELS[appointment.status]}
                </span>
              )}
              {!appointment && session.status === 'pending' && (
                <span className="text-xs text-muted-foreground">
                  Sem agendamento
                </span>
              )}
            </div>
            {(session.executedAt || professionalName) && (
              <span className="text-xs text-muted-foreground">
                {session.executedAt && (
                  <>Executado em {displayDateTime(session.executedAt)}</>
                )}
                {session.executedAt && professionalName && ' · '}
                {professionalName && <>por {professionalName}</>}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {canViewSignature && appointment && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => onViewSignature(appointment.id)}
              title="Ver assinatura e foto da presença"
            >
              <Signature className="mr-1 size-3.5" />
              Assinatura
            </Button>
          )}
          {canEvolve && (
            <Button
              variant="ghost"
              size="sm"
              className={cn(
                'h-7 px-2 text-xs',
                isSigned && 'text-success',
              )}
              onClick={onEvolve}
              title={
                isSigned
                  ? 'Registrar evolução clínica'
                  : 'Ver / editar evolução'
              }
            >
              <PenLine className="mr-1 size-3.5" />
              {isSigned ? 'Evoluir' : 'Evolução'}
            </Button>
          )}
        </div>
      </div>

      {session.evolutionNotes && (
        <div className="rounded border border-border/60 bg-surface p-2">
          <span className="text-xs font-medium text-muted-foreground">
            Evolução clínica
          </span>
          <p className="mt-1 whitespace-pre-wrap text-sm">
            {session.evolutionNotes}
          </p>
        </div>
      )}
    </li>
  )
}
