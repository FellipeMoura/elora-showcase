import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Loader2,
  PenLine,
  Stethoscope,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
// eslint-disable-next-line no-restricted-imports -- select compacto de filtro (troca de aplicador na toolbar)
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageContainer } from '@/components/layout/PageContainer'
import { useIsPrivileged, useMe } from '@/hooks/useMe'
import { useUsers } from '@/hooks/useUsers'
import { useProcedures } from '@/hooks/useProcedures'
import { useProcedureSessions } from '@/hooks/useProcedureSessions'
import { useAppointments } from '@/hooks/useAppointments'
import { useSchedules } from '@/hooks/useAvailability'
import type { Appointment } from '@/api/appointments'
import type { Procedure } from '@/api/procedures'
import type { ProcedureSession } from '@/api/procedureSessions'
import {
  CalendarGrid,
  type CalendarColumn,
  type CalendarItem,
} from '../appointments/CalendarGrid'
import { MiniCalendar } from '../appointments/MiniCalendar'
import { AppointmentDetailPopover } from '../appointments/AppointmentDetailPopover'
import { SessionEvolutionSheet } from '../appointments/SessionEvolutionSheet'
import { SignatureViewSheet } from '../appointments/SignatureViewSheet'
import {
  addDays,
  deriveGridHours,
  gapsBetweenRanges,
  isoDateOnly,
  schedulesToRangesForDate,
  startOfDay,
  useNowMinutes,
} from '../appointments/calendarHelpers'

// =====================================================================
// EvolutionsPage — agenda focada em evolução clínica do aplicador.
//
// Mostra a agenda completa do profissional escolhido (default = user
// logado) em coluna única, no padrão visual do CalendarPage day view.
// Faixas disponíveis + intervalos rotulados saem dos schedules
// cadastrados em /settings/availability. Click num appointment
// kind=procedure status=attended com session.status='signed' abre a
// sheet de evolução. Outros tipos abrem o popover de detalhe normal —
// a página dá visibilidade da agenda inteira do aplicador, não só das
// pendências de evolução.
//
// Toolbar custom (h-14): mesmo motivo que CalendarPage — chrome de
// agenda (nav data + filtros específicos) não cabe no PageToolbar
// genérico.
// =====================================================================

export function EvolutionsPage(): React.ReactElement {
  const navigate = useNavigate()
  const me = useMe()
  const isPrivileged = useIsPrivileged()

  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()))
  const [datePopoverOpen, setDatePopoverOpen] = useState(false)
  const [professionalId, setProfessionalId] = useState<string | null>(null)

  // ---- Lookups ----
  const usersQuery = useUsers({ page: 1, pageSize: 200, status: 'active' })
  const proceduresQuery = useProcedures({ status: 'all', pageSize: 200 })
  const sessionsQuery = useProcedureSessions({ pageSize: 500 })
  const schedulesQuery = useSchedules({})
  const schedules = schedulesQuery.data

  const applicators = useMemo(() => {
    return (usersQuery.data?.items ?? [])
      .filter((u) => u.canApplyProcedures && u.active)
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [usersQuery.data])

  // Default: usuário logado (se for aplicador). Caso contrário, primeiro
  // da lista. Quando o me ainda não chegou, fica null até resolver.
  useEffect(() => {
    if (professionalId) return
    if (!me.data) return
    const meIsApplicator = applicators.some((u) => u.id === me.data!.user.id)
    if (meIsApplicator) {
      setProfessionalId(me.data.user.id)
    } else if (isPrivileged && applicators.length > 0) {
      setProfessionalId(applicators[0]!.id)
    }
  }, [me.data, applicators, isPrivileged, professionalId])

  // Para profissional não-privilegiado (sem admin/manager): trava no
  // próprio user. Defesa em profundidade — UI esconde o select, mas
  // este efeito impede mudança via devtools.
  useEffect(() => {
    if (!me.data) return
    if (isPrivileged) return
    if (professionalId !== me.data.user.id) {
      setProfessionalId(me.data.user.id)
    }
  }, [me.data, isPrivileged, professionalId])

  // ---- Janela de horas e linha do agora ----
  const { startHour, endHour } = useMemo(() => {
    if (!professionalId || !schedules) return { startHour: 6, endHour: 22 }
    const own = schedules.filter((s) => s.userId === professionalId)
    return deriveGridHours(own)
  }, [schedules, professionalId])
  const nowMinutes = useNowMinutes(startHour, endHour)

  // ---- Appointments do dia ----
  const dateFrom = useMemo(() => {
    const d = new Date(selectedDate)
    d.setHours(0, 0, 0, 0)
    return d.toISOString()
  }, [selectedDate])
  const dateTo = useMemo(() => {
    const d = new Date(selectedDate)
    d.setHours(23, 59, 59, 999)
    return d.toISOString()
  }, [selectedDate])

  const apptsQuery = useAppointments(
    {
      professionalId: professionalId ?? undefined,
      dateFrom,
      dateTo,
      pageSize: 200,
      sortBy: 'scheduledAt',
      sortDir: 'asc',
    },
    Boolean(professionalId),
  )

  // ---- Maps auxiliares ----
  const proceduresById = useMemo(() => {
    const m = new Map<string, Procedure>()
    for (const p of proceduresQuery.data?.items ?? []) m.set(p.id, p)
    return m
  }, [proceduresQuery.data])

  const sessionById = useMemo(() => {
    const m = new Map<string, ProcedureSession>()
    for (const s of sessionsQuery.data?.items ?? []) m.set(s.id, s)
    return m
  }, [sessionsQuery.data])

  const selectedProfessional = applicators.find((u) => u.id === professionalId)
  const isSelf = me.data?.user.id === professionalId

  // ---- Estado de UI ----
  const [detailState, setDetailState] = useState<{
    appointment: Appointment | null
    anchor: HTMLElement | null
  }>({ appointment: null, anchor: null })
  const [evolutionSheet, setEvolutionSheet] = useState<{
    open: boolean
    session: ProcedureSession | null
  }>({ open: false, session: null })
  const [signatureSheet, setSignatureSheet] = useState<{
    open: boolean
    appointmentId: string | null
  }>({ open: false, appointmentId: null })

  // ---- Coluna do CalendarGrid (1 só) ----
  const availableRanges = useMemo(
    () =>
      professionalId
        ? schedulesToRangesForDate(
            schedules,
            [professionalId],
            selectedDate,
            startHour,
            endHour,
          )
        : [],
    [schedules, professionalId, selectedDate, startHour, endHour],
  )

  const intervalLabels = useMemo(
    () => gapsBetweenRanges(availableRanges).map((g) => ({ ...g, label: 'Intervalo' })),
    [availableRanges],
  )

  const items: CalendarItem[] = useMemo(() => {
    const list = apptsQuery.data?.items ?? []
    return list.map((a) => {
      const session = a.procedureSessionId
        ? sessionById.get(a.procedureSessionId)
        : null
      const procedure = session ? proceduresById.get(session.procedureId) ?? null : null
      return {
        appointment: a,
        procedure,
      }
    })
  }, [apptsQuery.data, sessionById, proceduresById])

  const columns: CalendarColumn[] = useMemo(() => {
    if (!professionalId) return []
    return [
      {
        id: professionalId,
        label: selectedProfessional?.name ?? 'Profissional',
        items,
        availableRanges,
        intervalLabels,
      },
    ]
  }, [
    professionalId,
    selectedProfessional?.name,
    items,
    availableRanges,
    intervalLabels,
  ])

  // ---- Handlers ----
  const handleAppointmentClick = (a: Appointment, anchor: HTMLElement) => {
    const session = a.procedureSessionId
      ? sessionById.get(a.procedureSessionId) ?? null
      : null

    // Atalho direto: procedure attended com session signed → abre sheet
    // de evolução de cara (foco da página).
    if (
      a.kind === 'procedure' &&
      a.status === 'attended' &&
      session?.status === 'signed'
    ) {
      setEvolutionSheet({ open: true, session })
      return
    }

    // Outros casos: popover normal — read-only pra contexto.
    setDetailState({ appointment: a, anchor })
  }

  const pendingEvolutionCount = useMemo(
    () =>
      items.filter(
        (it) =>
          it.appointment.kind === 'procedure' &&
          it.appointment.status === 'attended' &&
          it.appointment.procedureSessionId &&
          sessionById.get(it.appointment.procedureSessionId)?.status === 'signed',
      ).length,
    [items, sessionById],
  )

  return (
    <PageContainer>
      <Toolbar
        selectedDate={selectedDate}
        onChangeDate={setSelectedDate}
        datePopoverOpen={datePopoverOpen}
        onDatePopoverOpenChange={setDatePopoverOpen}
        applicators={applicators}
        professionalId={professionalId}
        onChangeProfessional={setProfessionalId}
        showProfessionalFilter={isPrivileged}
        onBack={() => navigate('/agenda')}
        pendingEvolutionCount={pendingEvolutionCount}
        isSelf={isSelf}
        loading={apptsQuery.isFetching}
      />

      <div className="relative flex-1 overflow-hidden">
        {!professionalId && (
          <EmptyState
            title={
              isPrivileged
                ? 'Selecione um aplicador na barra superior'
                : 'Seu perfil não está marcado como aplicador'
            }
            description={
              isPrivileged
                ? 'A agenda mostra a visão do profissional escolhido.'
                : 'Peça pra um administrador habilitar "Aplica procedimentos" no seu cadastro.'
            }
          />
        )}

        {professionalId && (
          <CalendarGrid
            columns={columns}
            colorMode="status"
            startHour={startHour}
            endHour={endHour}
            nowMinutes={nowMinutes}
            scrollToNowOnMount
            onAppointmentClick={handleAppointmentClick}
          />
        )}
      </div>

      <AppointmentDetailPopover
        appointment={detailState.appointment}
        anchor={detailState.anchor}
        onClose={() => setDetailState({ appointment: null, anchor: null })}
        onMarkProcedureAttendance={() => {
          // /evolutions é página de evolução clínica — não inicia o fluxo
          // de presença assinada (esse vive na /agenda). Aqui o operador
          // só lê status; pra gerar link, volta pra agenda.
        }}
        onViewAttendance={(appt) =>
          setSignatureSheet({ open: true, appointmentId: appt.id })
        }
        onEvolveSession={(_appt, sess) =>
          setEvolutionSheet({ open: true, session: sess })
        }
      />

      <SessionEvolutionSheet
        open={evolutionSheet.open}
        onOpenChange={(o) =>
          setEvolutionSheet((prev) => ({
            ...prev,
            open: o,
            session: o ? prev.session : null,
          }))
        }
        session={evolutionSheet.session}
        onViewSignature={() => {
          const appt = items.find(
            (it) => it.appointment.procedureSessionId === evolutionSheet.session?.id,
          )?.appointment
          if (appt) {
            setSignatureSheet({ open: true, appointmentId: appt.id })
          }
        }}
      />

      <SignatureViewSheet
        open={signatureSheet.open}
        onOpenChange={(o) =>
          setSignatureSheet((prev) => ({
            ...prev,
            open: o,
            appointmentId: o ? prev.appointmentId : null,
          }))
        }
        appointmentId={signatureSheet.appointmentId}
      />
    </PageContainer>
  )
}

// ---- Toolbar ----

interface ToolbarProps {
  selectedDate: Date
  onChangeDate: (d: Date) => void
  datePopoverOpen: boolean
  onDatePopoverOpenChange: (o: boolean) => void
  applicators: Array<{ id: string; name: string }>
  professionalId: string | null
  onChangeProfessional: (id: string) => void
  showProfessionalFilter: boolean
  onBack: () => void
  pendingEvolutionCount: number
  isSelf: boolean
  loading: boolean
}

function Toolbar({
  selectedDate,
  onChangeDate,
  datePopoverOpen,
  onDatePopoverOpenChange,
  applicators,
  professionalId,
  onChangeProfessional,
  showProfessionalFilter,
  onBack,
  pendingEvolutionCount,
  isSelf,
  loading,
}: ToolbarProps): React.ReactElement {
  const label = dayLabel(selectedDate)
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3">
      <Button
        variant="ghost"
        size="icon"
        onClick={onBack}
        aria-label="Voltar pra agenda"
        className="shrink-0"
      >
        <ArrowLeft className="size-4" />
      </Button>

      <div className="flex items-center gap-1.5">
        <Stethoscope className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold">Evoluções</h1>
        {pendingEvolutionCount > 0 && (
          <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-medium text-warning-soft-foreground">
            {pendingEvolutionCount} aguardando
          </span>
        )}
      </div>

      <div className="mx-2 h-6 w-px bg-border" />

      {/* Nav de data */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onChangeDate(addDays(selectedDate, -1))}
        aria-label="Dia anterior"
        className="shrink-0"
      >
        <ChevronLeft className="size-4" />
      </Button>

      <Popover open={datePopoverOpen} onOpenChange={onDatePopoverOpenChange}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 gap-1.5">
            <CalendarDays className="size-3.5" />
            <span className="text-xs">{label}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <MiniCalendar
            selectedDate={selectedDate}
            onSelect={(d) => {
              onChangeDate(startOfDay(d))
              onDatePopoverOpenChange(false)
            }}
          />
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        onClick={() => onChangeDate(addDays(selectedDate, 1))}
        aria-label="Próximo dia"
        className="shrink-0"
      >
        <ChevronRight className="size-4" />
      </Button>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => onChangeDate(startOfDay(new Date()))}
        className="h-8 text-xs"
      >
        Hoje
      </Button>

      <div className="flex-1" />

      {/* Filtro profissional — só pra admin/manager. Pra professional, o
          select fica oculto e a página fica travada no próprio user. */}
      {showProfessionalFilter && (
        <div className="flex items-center gap-2">
          {!isSelf && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Vendo agenda de
            </span>
          )}
          <Select
            value={professionalId ?? ''}
            onValueChange={(v) => onChangeProfessional(v)}
          >
            <SelectTrigger className="h-8 w-[200px] text-xs">
              <SelectValue placeholder="Selecione aplicador" />
            </SelectTrigger>
            <SelectContent>
              {applicators.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  Nenhum aplicador cadastrado
                </div>
              )}
              {applicators.map((u) => (
                <SelectItem key={u.id} value={u.id} className="text-xs">
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {loading && (
        <Loader2 className="ml-2 size-4 animate-spin text-muted-foreground" />
      )}
    </div>
  )
}

function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center gap-2 text-center">
        <PenLine className="size-8 text-muted-foreground/50" />
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  )
}

const DAY_NAMES_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

function dayLabel(d: Date): string {
  const today = startOfDay(new Date())
  const target = startOfDay(d)
  const diff = Math.round(
    (target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  )
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Amanhã'
  if (diff === -1) return 'Ontem'
  const weekday = DAY_NAMES_SHORT[d.getDay()]
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${weekday}, ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}

// Helper de iso pra eventual debug — não usado externamente.
export const __evolutionsIsoDateOnly = isoDateOnly
