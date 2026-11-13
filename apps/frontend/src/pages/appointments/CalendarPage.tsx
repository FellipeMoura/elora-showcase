import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  DoorOpen,
  ListChecks,
  MoreHorizontal,
  Plus,
  Settings,
  Users,
  Wrench,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
// eslint-disable-next-line no-restricted-imports -- select compacto de filtro (aplicador em foco na toolbar)
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageContainer } from '@/components/layout/PageContainer'
import { cn } from '@/lib/utils'
import {
  useEffectivePreferences,
  useUpdateMyPreferences,
} from '@/hooks/useMyPreferences'
import { useUsers } from '@/hooks/useUsers'
import { useProcedures } from '@/hooks/useProcedures'
import { useProcedureSessions } from '@/hooks/useProcedureSessions'
import {
  useAppointments,
  useUpdateAppointment,
} from '@/hooks/useAppointments'
import { useSchedules } from '@/hooks/useAvailability'
import type { Appointment } from '@/api/appointments'
import type { Procedure } from '@/api/procedures'
import {
  CalendarGrid,
  type CalendarColumn,
} from './CalendarGrid'
import { MiniCalendar } from './MiniCalendar'
import { AppointmentDetailPopover } from './AppointmentDetailPopover'
import { AppointmentFormSheet } from './AppointmentFormSheet'
import { AppointmentsListView } from './AppointmentsListView'
import { SessionAttendanceSheet } from './SessionAttendanceSheet'
import { SignatureViewSheet } from './SignatureViewSheet'
import { useClient } from '@/hooks/useClients'
import type { CalendarColorMode } from './calendarColors'

// =====================================================================
// CalendarPage — agenda unificada (day | week | list) no mesmo path.
//
// Toolbar custom (não usa PageToolbar): chrome de calendar (nav de data,
// view toggle, color mode, filtros) não cabe no contrato de
// [search, filter, action] do PageToolbar. Visualmente segue o mesmo
// padrão (h-14, bg-background, border) pra consistência com as outras
// pages — comentário aqui pra deixar a decisão explícita.
// =====================================================================

import {
  addDays,
  deriveGridHours,
  isoDateOnly,
  schedulesToRangesForDate,
  startOfDay,
  useNowMinutes,
  userIdsAvailableOnDate,
} from './calendarHelpers'
import { apiErrorText } from '@/lib/apiError'

type ViewMode = 'day' | 'week' | 'list'

const DAY_NAMES_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** Id da coluna de agendamentos sem profissional no day view (não é userId). */
const UNASSIGNED_COLUMN_ID = '__unassigned__'

function endOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(23, 59, 59, 999)
  return r
}

function startOfWeek(d: Date): Date {
  const r = new Date(d)
  r.setDate(d.getDate() - d.getDay())
  r.setHours(0, 0, 0, 0)
  return r
}

function endOfWeek(d: Date): Date {
  const s = startOfWeek(d)
  const r = new Date(s)
  r.setDate(s.getDate() + 6)
  r.setHours(23, 59, 59, 999)
  return r
}

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

export function CalendarPage(): React.ReactElement {
  const navigate = useNavigate()
  const prefs = useEffectivePreferences()
  const updatePrefs = useUpdateMyPreferences()

  const [view, setView] = useState<ViewMode>('day')
  const [selectedDate, setSelectedDate] = useState<Date>(() => startOfDay(new Date()))
  const [focusProfessionalId, setFocusProfessionalId] = useState<string | null>(null)
  const [datePopoverOpen, setDatePopoverOpen] = useState(false)
  /** Filtro de subset de profissionais no day view. Vazio = todos. */
  const [selectedProfessionalIds, setSelectedProfessionalIds] = useState<string[]>([])

  // Slot/appointment state pro form e popover.
  const [slotForm, setSlotForm] = useState<{
    open: boolean
    professionalId?: string
    scheduledAt?: string // 'YYYY-MM-DDTHH:MM'
  }>({ open: false })
  const [detailState, setDetailState] = useState<{
    appointment: Appointment | null
    anchor: HTMLElement | null
  }>({ appointment: null, anchor: null })
  // Sheet de presença assinada — vive aqui (não no popover) pra sobreviver
  // ao fechamento do popover quando o operador clica "Marcar presença".
  const [attendanceSheet, setAttendanceSheet] = useState<{
    open: boolean
    appointment: Appointment | null
  }>({ open: false, appointment: null })
  const attendanceClient = useClient(
    attendanceSheet.appointment?.clientId,
  )
  // Sheet de edição do agendamento — aberto pelo "Editar" do popover.
  const [editSheet, setEditSheet] = useState<{
    open: boolean
    appointment: Appointment | null
  }>({ open: false, appointment: null })
  // Sheet "Ver assinatura" — mostra foto + SVG + auditoria registrados.
  const [signatureSheet, setSignatureSheet] = useState<{
    open: boolean
    appointmentId: string | null
  }>({ open: false, appointmentId: null })

  // ---- Lookups ----
  const usersQuery = useUsers({ page: 1, pageSize: 100, status: 'active' })
  const proceduresQuery = useProcedures({ status: 'all', pageSize: 200 })
  const sessionsQuery = useProcedureSessions({ pageSize: 500 })
  const schedulesQuery = useSchedules({})
  const schedules = schedulesQuery.data

  const updateMutation = useUpdateAppointment()

  const userById = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>()
    for (const u of usersQuery.data?.items ?? []) m.set(u.id, u)
    return m
  }, [usersQuery.data])

  const proceduresById = useMemo(() => {
    const m = new Map<string, Procedure>()
    for (const p of proceduresQuery.data?.items ?? []) m.set(p.id, p)
    return m
  }, [proceduresQuery.data])

  const sessionToProcedureId = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of sessionsQuery.data?.items ?? []) m.set(s.id, s.procedureId)
    return m
  }, [sessionsQuery.data])

  // ---- Janela de horas derivada ----
  const { startHour, endHour } = useMemo(
    () => deriveGridHours(schedules),
    [schedules],
  )
  const nowMinutes = useNowMinutes(startHour, endHour)

  // ---- Lista de profissionais visíveis (day view) ----
  // Base do picker e do week-select: apenas usuários que possuem ao menos um
  // schedule cadastrado em /settings/availability. Usuário sem nenhum schedule
  // não tem como aparecer na agenda como aplicador.
  const professionalsWithSchedules = useMemo(() => {
    if (!schedules) return []
    const withSchedule = new Set(schedules.map((s) => s.userId))
    return Array.from(userById.values())
      .filter((u) => withSchedule.has(u.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [userById, schedules])

  // Conjunto de userIds com disponibilidade na data selecionada (dia da semana
  // + vigência). Usado pra (a) inicializar/ressincronizar a seleção quando a
  // data muda e (b) marcar visualmente quem está fora do horário no picker.
  const availableOnSelectedDate = useMemo(
    () => userIdsAvailableOnDate(schedules, selectedDate),
    [schedules, selectedDate],
  )

  // Auto-sync: ao trocar a data (ou no primeiro load de schedules) reseta a
  // seleção pros profissionais com disponibilidade no novo dia. Refetch de
  // schedules sem mudança de data não mexe na seleção (preserva ajuste manual).
  // No primeiro load, se houver apenas 1 profissional com schedules, abre
  // direto na visão semanal focada nele (day view de coluna única é redundante).
  const selectedDateKey = isoDateOnly(selectedDate)
  const prevDateKeyRef = useRef<string | null>(null)
  const initializedRef = useRef(false)
  useEffect(() => {
    if (!schedules) return
    const dateChanged = prevDateKeyRef.current !== selectedDateKey
    const isFirstSync = !initializedRef.current
    if (!dateChanged && !isFirstSync) return
    prevDateKeyRef.current = selectedDateKey
    if (isFirstSync) {
      initializedRef.current = true
      if (professionalsWithSchedules.length === 1) {
        const only = professionalsWithSchedules[0]!
        setView('week')
        setFocusProfessionalId(only.id)
      }
    }
    setSelectedProfessionalIds(Array.from(availableOnSelectedDate))
  }, [
    selectedDateKey,
    schedules,
    availableOnSelectedDate,
    professionalsWithSchedules,
  ])

  const visibleProfessionals = useMemo(() => {
    if (selectedProfessionalIds.length === 0) return []
    const allow = new Set(selectedProfessionalIds)
    return professionalsWithSchedules.filter((u) => allow.has(u.id))
  }, [professionalsWithSchedules, selectedProfessionalIds])

  // ---- Appointments fetch ----
  const dateFrom = useMemo(() => {
    if (view === 'day') return startOfDay(selectedDate).toISOString()
    if (view === 'week') return startOfWeek(selectedDate).toISOString()
    return startOfDay(selectedDate).toISOString()
  }, [view, selectedDate])
  const dateTo = useMemo(() => {
    if (view === 'day') return endOfDay(selectedDate).toISOString()
    if (view === 'week') return endOfWeek(selectedDate).toISOString()
    return endOfDay(selectedDate).toISOString()
  }, [view, selectedDate])

  const appointmentsQuery = useAppointments(
    {
      dateFrom,
      dateTo,
      professionalId:
        view === 'week' && focusProfessionalId ? focusProfessionalId : undefined,
      pageSize: 500,
      sortBy: 'scheduledAt',
      sortDir: 'asc',
    },
    view !== 'list', // list view tem sua própria query interna
  )

  const appointments = appointmentsQuery.data?.items ?? []

  // ---- Builder de colunas ----
  const columns: CalendarColumn[] = useMemo(() => {
    const procedureFor = (a: Appointment): Procedure | null => {
      if (a.kind === 'evaluation') return null
      if (!a.procedureSessionId) return null
      const procId = sessionToProcedureId.get(a.procedureSessionId)
      if (!procId) return null
      return proceduresById.get(procId) ?? null
    }

    if (view === 'day') {
      const professionalColumns = visibleProfessionals.map<CalendarColumn>((u) => {
        const items = appointments
          .filter((a) => a.professionalId === u.id)
          .map((a) => ({
            appointment: a,
            procedure: procedureFor(a),
          }))
        return {
          id: u.id,
          label: u.name,
          items,
          availableRanges: schedulesToRangesForDate(
            schedules,
            [u.id],
            selectedDate,
            startHour,
            endHour,
          ),
          onHeaderClick: () => {
            setFocusProfessionalId(u.id)
            setView('week')
          },
        }
      })
      // Agendamento sem profissional (o form permite "Não atribuir") não cai
      // em coluna de ninguém. Coluna extra no fim, só quando o dia tem algum.
      const unassigned = appointments.filter((a) => a.professionalId === null)
      if (unassigned.length === 0) return professionalColumns
      return [
        ...professionalColumns,
        {
          id: UNASSIGNED_COLUMN_ID,
          label: <span className="text-muted-foreground">Sem profissional</span>,
          items: unassigned.map((a) => ({
            appointment: a,
            procedure: procedureFor(a),
          })),
          // União das janelas de todos — mesmo realce do week view sem foco.
          availableRanges: schedulesToRangesForDate(
            schedules,
            null,
            selectedDate,
            startHour,
            endHour,
          ),
        },
      ]
    }

    // view === 'week'
    const weekStart = startOfWeek(selectedDate)
    return Array.from({ length: 7 }).map<CalendarColumn>((_, i) => {
      const day = addDays(weekStart, i)
      const dayStart = startOfDay(day)
      const dayEnd = endOfDay(day)
      const items = appointments
        .filter((a) => {
          const at = new Date(a.scheduledAt).getTime()
          return at >= dayStart.getTime() && at <= dayEnd.getTime()
        })
        .map((a) => ({
          appointment: a,
          procedure: procedureFor(a),
          // Sem foco em profissional, mostra nome do profissional no card
          // pra distinguir entre cards do mesmo dia.
          professionalName: focusProfessionalId
            ? undefined
            : a.professionalId
              ? userById.get(a.professionalId)?.name
              : undefined,
        }))
      const isSelectedDay =
        day.getDate() === selectedDate.getDate() &&
        day.getMonth() === selectedDate.getMonth() &&
        day.getFullYear() === selectedDate.getFullYear()
      const pad = (n: number) => String(n).padStart(2, '0')
      // Foco em profissional → janela dela. Sem foco → união de todos.
      const availableRanges = schedulesToRangesForDate(
        schedules,
        focusProfessionalId ? [focusProfessionalId] : null,
        day,
        startHour,
        endHour,
      )
      return {
        id: day.toISOString().slice(0, 10),
        label: (
          <span className={cn(isSelectedDay && 'text-primary')}>
            {DAY_NAMES_SHORT[day.getDay()]} {pad(day.getDate())}/{pad(day.getMonth() + 1)}
          </span>
        ),
        items,
        availableRanges,
      }
    })
  }, [
    view,
    appointments,
    visibleProfessionals,
    userById,
    proceduresById,
    sessionToProcedureId,
    selectedDate,
    schedules,
    focusProfessionalId,
    startHour,
    endHour,
  ])

  const shift = (offset: number) => {
    setSelectedDate((d) => {
      if (view === 'week') return addDays(d, offset * 7)
      return addDays(d, offset)
    })
  }
  const handleSelectDate = (d: Date) => {
    setSelectedDate(startOfDay(d))
    setDatePopoverOpen(false)
  }

  // ---- Handlers grid → form/popover/PATCH ----
  const handleSlotClick = (columnId: string, minutesFromStart: number) => {
    // columnId é userId (day view) ou ISO date (week view).
    const isDay = view === 'day'
    const base = isDay
      ? selectedDate
      : new Date(`${columnId}T00:00:00`) // week view: ISO sem TZ → local midnight
    const slot = new Date(base)
    slot.setHours(startHour, 0, 0, 0)
    slot.setMinutes(slot.getMinutes() + minutesFromStart)
    const pad = (n: number) => String(n).padStart(2, '0')
    const scheduledAt = `${slot.getFullYear()}-${pad(slot.getMonth() + 1)}-${pad(slot.getDate())}T${pad(slot.getHours())}:${pad(slot.getMinutes())}`
    const professionalId = isDay
      ? columnId === UNASSIGNED_COLUMN_ID
        ? undefined
        : columnId
      : focusProfessionalId ?? undefined

    // Bloqueia clique fora da janela de disponibilidade quando o slot já tem
    // profissional resolvido (day view sempre, week view com foco). Mesma
    // fonte do realce visual (`availableRanges` na coluna), então o que está
    // dim não dispara o sheet. Em week view sem foco, profissional será
    // escolhido no form — backend (validateAppointmentSlot) faz o gate final.
    if (professionalId) {
      const column = columns.find((c) => c.id === columnId)
      const ranges = column?.availableRanges ?? []
      const inRange = ranges.some(
        (r) =>
          minutesFromStart >= r.startMinutes &&
          minutesFromStart < r.endMinutes,
      )
      if (!inRange) {
        toast.error(
          'Horário sem disponibilidade — cadastre uma janela para o profissional antes',
        )
        return
      }
    }

    setSlotForm({
      open: true,
      scheduledAt,
      professionalId,
    })
  }

  const handleAppointmentClick = (a: Appointment, anchor: HTMLElement) => {
    setDetailState({ appointment: a, anchor })
  }

  const handleAppointmentMove = async (id: string, newAt: Date) => {
    try {
      await updateMutation.mutateAsync({
        id,
        input: { scheduledAt: newAt.toISOString() },
      })
      toast.success('Agendamento movido')
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const message = apiErrorText(err)
      if (status === 409) toast.error(message ?? 'Conflito de horário')
      else toast.error('Erro ao mover agendamento')
    }
  }

  const handleAppointmentResize = async (id: string, newDuration: number) => {
    try {
      await updateMutation.mutateAsync({
        id,
        input: { durationMinutes: newDuration },
      })
      toast.success('Duração atualizada')
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const message = apiErrorText(err)
      if (status === 409) toast.error(message ?? 'Conflito de horário')
      else toast.error('Erro ao atualizar duração')
    }
  }

  // ---- Color mode toggle ----
  const handleColorModeChange = (mode: CalendarColorMode) => {
    updatePrefs.mutate({ calendarColorMode: mode })
  }

  return (
    <PageContainer>
      {/* Toolbar custom — h-14, bg-background, border, gap-2, px-1.5 (mesmos
          tokens do PageToolbar). Decisão de não usar PageToolbar comentada no
          topo do arquivo. */}
      <div className="flex h-14 shrink-0 items-center gap-2 rounded-md border border-border bg-background px-2">
        {view === 'week' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setView('day')
              setFocusProfessionalId(null)
            }}
          >
            <ArrowLeft className="mr-1 h-4 w-4" />
            <span className="hidden sm:inline">Agenda do dia</span>
          </Button>
        )}

        {view !== 'list' && (
          <>
            <Button
              variant="outline"
              size="icon"
              aria-label={view === 'week' ? 'Semana anterior' : 'Dia anterior'}
              onClick={() => shift(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>


            <Popover open={datePopoverOpen} onOpenChange={setDatePopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label={
                    view === 'week'
                      ? 'Abrir calendário semanal'
                      : 'Abrir calendário'
                  }
                >
                  <CalendarDays className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-3">
                <MiniCalendar
                  selectedDate={selectedDate}
                  onSelect={handleSelectDate}
                  weekMode={view === 'week'}
                />
              </PopoverContent>
            </Popover>

            <Button
              variant="outline"
              size="icon"
              aria-label={view === 'week' ? 'Próxima semana' : 'Próximo dia'}
              onClick={() => shift(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </>
        )}
        {view === 'day' && (
          <span className="px-1 text-sm font-medium tabular-nums">
            {dayLabel(selectedDate)}
          </span>
        )}

        {appointmentsQuery.isFetching && view !== 'list' && (
          <span className="ml-1 text-xs text-muted-foreground">
            atualizando…
          </span>
        )}

        <div className="flex-1" />

        {/* Day: filtro multi-aplicadoras */}
        {view === 'day' && (
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                aria-label="Filtrar aplicadoras"
              >
                <Users className="h-4 w-4" />
                {professionalsWithSchedules.length === 0
                  ? 'Sem aplicadoras'
                  : `${selectedProfessionalIds.length} de ${professionalsWithSchedules.length}`}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-2">
              <div className="mb-1 flex items-center justify-between px-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Aplicadoras
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedProfessionalIds(Array.from(availableOnSelectedDate))
                  }
                  className="text-xs text-primary hover:underline"
                >
                  Restaurar disponíveis
                </button>
              </div>
              {professionalsWithSchedules.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">
                  Nenhuma aplicadora com horário cadastrado em{' '}
                  <span className="font-medium">/settings/availability</span>.
                </div>
              ) : (
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {professionalsWithSchedules.map((u) => {
                    const checked = selectedProfessionalIds.includes(u.id)
                    const isAvailable = availableOnSelectedDate.has(u.id)
                    return (
                      <label
                        key={u.id}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/40"
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) => {
                            setSelectedProfessionalIds((prev) =>
                              v
                                ? [...prev, u.id]
                                : prev.filter((id) => id !== u.id),
                            )
                          }}
                        />
                        <span
                          className={cn(
                            'flex-1 truncate',
                            !isAvailable && 'text-muted-foreground',
                          )}
                        >
                          {u.name}
                        </span>
                        {!isAvailable && (
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            sem horário
                          </span>
                        )}
                      </label>
                    )
                  })}
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}

        {/* Week: select single aplicador (foco da view) */}
        {view === 'week' && (
          <Select
            value={focusProfessionalId ?? ''}
            onValueChange={(v) => setFocusProfessionalId(v)}
          >
            <SelectTrigger
              className="h-9 w-[180px]"
              aria-label="Trocar aplicador"
            >
              <SelectValue placeholder="Selecionar aplicador" />
            </SelectTrigger>
            <SelectContent align="end">
              {professionalsWithSchedules.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <Button
          onClick={() =>
            setSlotForm({
              open: true,
              scheduledAt: undefined,
              professionalId:
                view === 'week' ? focusProfessionalId ?? undefined : undefined,
            })
          }
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Novo</span>
        </Button>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Configurações">
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            <MoreOptionsItem
              icon={DoorOpen}
              label="Salas"
              onClick={() => navigate('/settings/units')}
            />
            <MoreOptionsItem
              icon={Wrench}
              label="Equipamentos"
              onClick={() => navigate('/settings/equipments')}
            />
            <MoreOptionsItem
              icon={Clock}
              label="Profissionais"
              hint="Disponibilidade"
              onClick={() => navigate('/settings/availability')}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Mais opções">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-56 p-1">
            <MoreOptionsItem
              icon={ListChecks}
              label={view === 'list' ? 'Voltar pra grade' : 'Visão lista'}
              onClick={() => setView(view === 'list' ? 'day' : 'list')}
            />
            <div className="my-1 border-t border-border" />
            <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Modo de cores
            </div>
            <ColorModeItem
              label="Por status"
              hint="Cor = status; ícone = procedimento"
              checked={prefs.calendarColorMode === 'status'}
              onClick={() => handleColorModeChange('status')}
            />
            <ColorModeItem
              label="Por procedimento"
              hint="Cor = procedimento; ícone = status"
              checked={prefs.calendarColorMode === 'procedure'}
              onClick={() => handleColorModeChange('procedure')}
            />
          </PopoverContent>
        </Popover>
      </div>

      {view === 'list' ? (
        <AppointmentsListView dateFrom={dateFrom} dateTo={dateTo} />
      ) : (
        <CalendarGrid
          columns={columns}
          colorMode={prefs.calendarColorMode}
          startHour={startHour}
          endHour={endHour}
          nowMinutes={nowMinutes}
          scrollToNowOnMount
          onAppointmentClick={handleAppointmentClick}
          onSlotClick={handleSlotClick}
          onAppointmentMove={handleAppointmentMove}
          onAppointmentResize={handleAppointmentResize}
        />
      )}

      {appointmentsQuery.isError && view !== 'list' && (
        <div className="shrink-0 rounded-md border border-error/40 bg-error/10 px-4 py-2 text-sm text-error">
          Erro ao carregar agendamentos.{' '}
          <button
            type="button"
            onClick={() => appointmentsQuery.refetch()}
            className="underline"
          >
            Tentar novamente
          </button>
        </div>
      )}

      <AppointmentDetailPopover
        appointment={detailState.appointment}
        anchor={detailState.anchor}
        onClose={() => setDetailState({ appointment: null, anchor: null })}
        onMarkProcedureAttendance={(appt) =>
          setAttendanceSheet({ open: true, appointment: appt })
        }
        onViewAttendance={(appt) =>
          setSignatureSheet({ open: true, appointmentId: appt.id })
        }
        onEdit={(appt) => setEditSheet({ open: true, appointment: appt })}
      />

      <SessionAttendanceSheet
        open={attendanceSheet.open}
        onOpenChange={(o) =>
          setAttendanceSheet((prev) => ({
            open: o,
            appointment: o ? prev.appointment : null,
          }))
        }
        appointment={attendanceSheet.appointment}
        clientName={attendanceClient.data?.name}
      />

      <SignatureViewSheet
        open={signatureSheet.open}
        onOpenChange={(o) =>
          setSignatureSheet((prev) => ({
            open: o,
            appointmentId: o ? prev.appointmentId : null,
          }))
        }
        appointmentId={signatureSheet.appointmentId}
      />

      <AppointmentFormSheet
        open={slotForm.open}
        mode="slot"
        defaultScheduledAt={slotForm.scheduledAt}
        defaultProfessionalId={slotForm.professionalId}
        onOpenChange={(open) =>
          setSlotForm((prev) => ({ ...prev, open }))
        }
      />

      <AppointmentFormSheet
        open={editSheet.open}
        mode="slot"
        appointment={editSheet.appointment}
        defaultClientId={editSheet.appointment?.clientId}
        onOpenChange={(open) =>
          setEditSheet((prev) => ({ ...prev, open }))
        }
      />
    </PageContainer>
  )
}

// ---- Items internos do popover ----

interface MoreOptionsItemProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  hint?: string
  disabled?: boolean
  onClick?: () => void
}

function MoreOptionsItem({
  icon: Icon,
  label,
  hint,
  disabled,
  onClick,
}: MoreOptionsItemProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
        'hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none',
        disabled && 'cursor-not-allowed opacity-60 hover:bg-transparent',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="flex-1 truncate">{label}</span>
      {hint && (
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {hint}
        </span>
      )}
    </button>
  )
}

interface ColorModeItemProps {
  label: string
  hint: string
  checked: boolean
  onClick: () => void
}

function ColorModeItem({
  label,
  hint,
  checked,
  onClick,
}: ColorModeItemProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left text-sm',
        'hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none',
        checked && 'bg-primary/10 text-primary',
      )}
    >
      <span className="font-medium">{label}</span>
      <span className="text-[10px] text-muted-foreground">{hint}</span>
    </button>
  )
}
