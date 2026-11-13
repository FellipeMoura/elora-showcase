import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useIsPrivileged, useMe } from '@/hooks/useMe'
import { useUsers } from '@/hooks/useUsers'
import {
  useDeleteException,
  useDeleteSchedule,
  useExceptions,
  useSchedules,
} from '@/hooks/useAvailability'
import {
  WEEKDAYS,
  type ProfessionalSchedule,
  type ScheduleException,
  type Weekday,
} from '@/api/availability'
import {
  EXCEPTION_KIND_BADGE_CLASS,
  EXCEPTION_KIND_LABELS,
  WEEKDAY_LABELS,
  formatDateTime,
  formatIsoDate,
  formatTime,
} from './availabilityLabels'
import { ScheduleFormSheet } from './ScheduleFormSheet'
import { ExceptionFormSheet } from './ExceptionFormSheet'
import { apiErrorText } from '@/lib/apiError'

export function AvailabilityPage(): React.ReactElement {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const { data: me } = useMe()
  const isPrivileged = useIsPrivileged()
  const currentUserId = me?.user.id ?? null

  // Lista de profissionais (qualquer user — UI não restringe por role; admin
  // pode definir disponibilidade pra qualquer um).
  const usersQuery = useUsers({ page: 1, pageSize: 100, status: 'active' })

  // userId selecionado pra visualizar/editar. Privileged pode trocar via
  // picker; non-privileged vê só o próprio.
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  // Resolve userId efetivo: respeita seleção; senão, default ao current user.
  const effectiveUserId = selectedUserId ?? currentUserId

  const schedulesQuery = useSchedules(
    { userId: effectiveUserId ?? '' },
    Boolean(effectiveUserId),
  )
  const exceptionsQuery = useExceptions(
    { userId: effectiveUserId ?? '' },
    Boolean(effectiveUserId),
  )

  const [scheduleSheetOpen, setScheduleSheetOpen] = useState(false)
  const [editingSchedule, setEditingSchedule] =
    useState<ProfessionalSchedule | null>(null)
  const [defaultDayForCreate, setDefaultDayForCreate] = useState<Weekday | null>(
    null,
  )

  const [exceptionSheetOpen, setExceptionSheetOpen] = useState(false)
  const [editingException, setEditingException] =
    useState<ScheduleException | null>(null)

  const deleteScheduleMutation = useDeleteSchedule()
  const deleteExceptionMutation = useDeleteException()

  const handleAddSchedule = (day?: Weekday) => {
    setEditingSchedule(null)
    setDefaultDayForCreate(day ?? null)
    setScheduleSheetOpen(true)
  }
  const handleEditSchedule = (s: ProfessionalSchedule) => {
    setEditingSchedule(s)
    setDefaultDayForCreate(null)
    setScheduleSheetOpen(true)
  }
  const handleDeleteSchedule = async (s: ProfessionalSchedule) => {
    const ok = await confirm({
      title: `Remover janela ${WEEKDAY_LABELS[s.dayOfWeek]} ${formatTime(s.startTime)}–${formatTime(s.endTime)}?`,
      confirmLabel: 'Remover',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await deleteScheduleMutation.mutateAsync(s.id)
      toast.success('Janela removida')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao remover janela')
    }
  }

  const handleAddException = () => {
    setEditingException(null)
    setExceptionSheetOpen(true)
  }
  const handleEditException = (e: ScheduleException) => {
    setEditingException(e)
    setExceptionSheetOpen(true)
  }
  const handleDeleteException = async (e: ScheduleException) => {
    const ok = await confirm({
      title: 'Remover esta exceção?',
      confirmLabel: 'Remover',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await deleteExceptionMutation.mutateAsync(e.id)
      toast.success('Exceção removida')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao remover exceção')
    }
  }

  // Agrupa janelas por dayOfWeek pra renderizar uma seção por dia.
  const schedulesByDay = useMemo(() => {
    const map = new Map<Weekday, ProfessionalSchedule[]>()
    for (const d of WEEKDAYS) map.set(d, [])
    for (const s of schedulesQuery.data ?? []) {
      map.get(s.dayOfWeek)?.push(s)
    }
    return map
  }, [schedulesQuery.data])

  const sortedExceptions = useMemo(() => {
    const items = exceptionsQuery.data ?? []
    return [...items].sort(
      (a, b) => new Date(b.startAt).getTime() - new Date(a.startAt).getTime(),
    )
  }, [exceptionsQuery.data])

  const userList = usersQuery.data?.items ?? []

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Action
          icon={<ArrowLeft />}
          onClick={() => navigate('/agenda')}
          variant="ghost"
          placement="leading"
          aria-label="Voltar para agenda"
        />
        {isPrivileged && (
          <PageToolbar.Filter label="Profissional" minWidth={320}>
            {/* eslint-disable-next-line no-restricted-syntax -- select nativo de filtro na toolbar (não é campo de form) */}
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={effectiveUserId ?? ''}
              onChange={(e) => setSelectedUserId(e.target.value || null)}
              aria-label="Selecionar profissional"
            >
              {userList.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </PageToolbar.Filter>
        )}
        <PageToolbar.Action
          icon={<Plus />}
          label="Nova janela"
          onClick={() => handleAddSchedule()}
        />
      </PageToolbar>

      <div className="flex flex-1 min-h-0 flex-col gap-4 overflow-y-auto">
        {!effectiveUserId ? (
          <p className="text-sm text-muted-foreground">
            Selecione um profissional pra ver a disponibilidade.
          </p>
        ) : (
          <>
            {/* Section: weekly windows */}
            <section className="rounded-md border bg-background p-4">
              <header className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">Janelas semanais</h2>
                {schedulesQuery.isLoading && (
                  <span className="text-xs text-muted-foreground">
                    Carregando…
                  </span>
                )}
              </header>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {WEEKDAYS.map((day) => {
                  const windows = schedulesByDay.get(day) ?? []
                  return (
                    <div
                      key={day}
                      className="flex flex-col gap-2 rounded-md border bg-muted/20 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">
                          {WEEKDAY_LABELS[day]}
                        </span>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Adicionar janela em ${WEEKDAY_LABELS[day]}`}
                          onClick={() => handleAddSchedule(day)}
                          className="h-7 w-7"
                        >
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>

                      {windows.length === 0 && (
                        <p className="text-xs text-muted-foreground">Sem janelas.</p>
                      )}

                      {windows.map((w) => (
                        <div
                          key={w.id}
                          className="flex items-center justify-between rounded border bg-background px-2 py-1.5"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-medium">
                              {formatTime(w.startTime)} – {formatTime(w.endTime)}
                            </div>
                            {(w.effectiveFrom !==
                              w.createdAt.slice(0, 10) ||
                              w.effectiveTo) && (
                              <div className="text-xs text-muted-foreground">
                                {formatIsoDate(w.effectiveFrom)}
                                {w.effectiveTo
                                  ? ` → ${formatIsoDate(w.effectiveTo)}`
                                  : ''}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Editar"
                              onClick={() => handleEditSchedule(w)}
                              className="h-7 w-7"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Remover"
                              onClick={() => handleDeleteSchedule(w)}
                              className="h-7 w-7 text-error hover:bg-error/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            </section>

            {/* Section: exceptions */}
            <section className="rounded-md border bg-background p-4">
              <header className="mb-3 flex items-baseline justify-between">
                <h2 className="text-sm font-semibold">
                  Exceções (folgas, férias, treinamentos)
                </h2>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAddException}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Nova exceção
                </Button>
              </header>

              {exceptionsQuery.isLoading && (
                <p className="text-sm text-muted-foreground">Carregando…</p>
              )}

              {sortedExceptions.length === 0 && !exceptionsQuery.isLoading && (
                <p className="text-sm text-muted-foreground">
                  Nenhuma exceção registrada.
                </p>
              )}

              <ul className="flex flex-col gap-2">
                {sortedExceptions.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-start justify-between gap-3 rounded border bg-muted/20 p-3"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {formatDateTime(e.startAt)} → {formatDateTime(e.endAt)}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-medium ${EXCEPTION_KIND_BADGE_CLASS[e.kind]}`}
                        >
                          {EXCEPTION_KIND_LABELS[e.kind]}
                        </span>
                      </div>
                      {e.notes && (
                        <p className="text-xs text-muted-foreground">{e.notes}</p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Editar"
                        onClick={() => handleEditException(e)}
                        className="h-7 w-7"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Remover"
                        onClick={() => handleDeleteException(e)}
                        className="h-7 w-7 text-error hover:bg-error/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>

      {effectiveUserId && (
        <>
          <ScheduleFormSheet
            open={scheduleSheetOpen}
            userId={effectiveUserId}
            schedule={editingSchedule}
            defaultDay={defaultDayForCreate}
            onOpenChange={(o) => {
              setScheduleSheetOpen(o)
              if (!o) {
                setEditingSchedule(null)
                setDefaultDayForCreate(null)
              }
            }}
          />
          <ExceptionFormSheet
            open={exceptionSheetOpen}
            userId={effectiveUserId}
            exception={editingException}
            onOpenChange={(o) => {
              setExceptionSheetOpen(o)
              if (!o) setEditingException(null)
            }}
          />
        </>
      )}
    </PageContainer>
  )
}
