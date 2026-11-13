import { useEffect, useMemo, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { z } from 'zod'
import { toast } from 'sonner'
import { TextField } from '@/components/form/TextField'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { SelectField, SelectItem } from '@/components/form/SelectField'
import { TextArea } from '@/components/form/TextArea'
import { ComboboxField, type ComboboxOption } from '@/components/form/ComboboxField'
import { useUsers } from '@/hooks/useUsers'
import { useUnits } from '@/hooks/useUnits'
import { useEquipments } from '@/hooks/useEquipments'
import { useProcedures } from '@/hooks/useProcedures'
import { useProcedureSessions } from '@/hooks/useProcedureSessions'
import type { ProcedureSession } from '@/api/procedureSessions'
import {
  useAppointments,
  useCreateAppointment,
  useUpdateAppointment,
} from '@/hooks/useAppointments'
import { useClients, useClient } from '@/hooks/useClients'
import { useCreateJourney, journeysListKey } from '@/hooks/useJourneys'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import {
  APPOINTMENT_KINDS,
  EVALUATION_KINDS,
  type Appointment,
  type AppointmentKind,
  type CreateAppointmentInput,
  type EvaluationKind,
  type UpdateAppointmentInput,
} from '@/api/appointments'
import type { Journey } from '@/api/journeys'
import { fetchJourneys, type PaginatedJourneys } from '@/api/journeys'
import {
  APPOINTMENT_KIND_LABELS,
  EVALUATION_KIND_LABELS,
  localDatetimeToIso,
  toLocalDatetimeInput,
} from './appointmentLabels'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// AppointmentFormSheet — duas formas de chamar:
//
//   mode='journey' (default): vem do detalhe de uma journey/cliente.
//     Cliente está fixo, journey está resolvida. Comportamento original.
//
//   mode='slot' (novo): vem do CalendarPage. Cliente é escolhido inline
//     via Combobox. No submit, resolve-se a journey ativa do cliente
//     (find-or-create) antes de criar o appointment.
//
// Polimorfismo do appointment continua: kind=evaluation cria a evaluation
// inline; kind=procedure exige procedureSessionId já existente.
//
// Com `appointment` passado, o sheet edita esse agendamento (PATCH): só os
// campos do slot (profissional, sala, equipamento, horário, duração, notas).
// Tipo, avaliação e sessão não mudam depois de criados (mesma regra do
// updateAppointmentSchema no backend), então somem do form.
// =====================================================================

const dtLocalRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

const formSchema = z
  .object({
    kind: z.enum(APPOINTMENT_KINDS),
    evaluationKind: z.enum(EVALUATION_KINDS).optional(),
    procedureSessionId: z.string().uuid().optional(),
    professionalId: z.string().uuid().or(z.literal('')),
    unitId: z.string().uuid().or(z.literal('')),
    equipmentId: z.string().uuid().or(z.literal('')),
    scheduledAt: z.string().regex(dtLocalRegex, 'Data/hora inválida'),
    durationMinutes: z.coerce.number().int().min(5).max(480),
    notes: z.string().trim().max(5000),
  })
  .refine((d) => d.kind !== 'evaluation' || d.evaluationKind !== undefined, {
    message: 'Tipo de avaliação obrigatório',
    path: ['evaluationKind'],
  })
  .refine(
    (d) => d.kind !== 'procedure' || (d.procedureSessionId && d.procedureSessionId !== ''),
    {
      message: 'Sessão obrigatória',
      path: ['procedureSessionId'],
    },
  )

type FormValues = z.infer<typeof formSchema>

const FORM_ID = 'appointment-form'

type CommonProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pré-seleciona kind quando aberto. */
  defaultKind?: AppointmentKind
  /** Pré-seleciona session específica (válido só em kind='procedure'). */
  defaultProcedureSessionId?: string
  /** Pré-preenche profissional (vindo da coluna clicada no calendar). */
  defaultProfessionalId?: string
  /** Pré-preenche scheduledAt em formato 'YYYY-MM-DDTHH:MM'. */
  defaultScheduledAt?: string
  /** Pré-preenche duração — override do default por kind. */
  defaultDurationMinutes?: number
  /** Agendamento existente → sheet em modo edição (PATCH dos campos do slot). */
  appointment?: Appointment | null
}

type JourneyModeProps = CommonProps & { mode?: 'journey'; journey: Journey }
type SlotModeProps = CommonProps & { mode: 'slot'; defaultClientId?: string }
type AppointmentFormSheetProps = JourneyModeProps | SlotModeProps

function isSlotMode(p: AppointmentFormSheetProps): p is SlotModeProps {
  return p.mode === 'slot'
}

function defaultScheduledAtNow(): string {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function emptyValues(
  kind: AppointmentKind,
  opts: {
    procedureSessionId?: string
    professionalId?: string
    scheduledAt?: string
    durationMinutes?: number
  },
): FormValues {
  return {
    kind,
    evaluationKind: kind === 'evaluation' ? 'initial' : undefined,
    procedureSessionId: kind === 'procedure' ? opts.procedureSessionId : undefined,
    professionalId: opts.professionalId ?? '',
    unitId: '',
    equipmentId: '',
    scheduledAt: opts.scheduledAt ?? defaultScheduledAtNow(),
    durationMinutes:
      opts.durationMinutes ?? (kind === 'evaluation' ? 30 : 60),
    notes: '',
  }
}

function valuesFromAppointment(a: Appointment): FormValues {
  return {
    kind: a.kind,
    // Edição não mexe em tipo de avaliação nem sessão; o valor só satisfaz
    // os refines do schema.
    evaluationKind: a.kind === 'evaluation' ? 'initial' : undefined,
    procedureSessionId: a.procedureSessionId ?? undefined,
    professionalId: a.professionalId ?? '',
    unitId: a.unitId ?? '',
    equipmentId: a.equipmentId ?? '',
    scheduledAt: toLocalDatetimeInput(a.scheduledAt),
    durationMinutes: a.durationMinutes,
    notes: a.notes ?? '',
  }
}

export function AppointmentFormSheet(
  props: AppointmentFormSheetProps,
): React.ReactElement {
  const {
    open,
    onOpenChange,
    defaultKind = 'evaluation',
    defaultProcedureSessionId,
    defaultProfessionalId,
    defaultScheduledAt,
    defaultDurationMinutes,
    appointment: editing = null,
  } = props
  const mode: 'journey' | 'slot' = isSlotMode(props) ? 'slot' : 'journey'
  const journey: Journey | null = isSlotMode(props) ? null : props.journey
  const defaultClientId: string | null = isSlotMode(props)
    ? (props.defaultClientId ?? null)
    : (props.journey.clientId ?? null)

  const queryClient = useQueryClient()
  const createMutation = useCreateAppointment()
  const updateMutation = useUpdateAppointment()
  const createJourneyMutation = useCreateJourney()

  // ---- Cliente (slot mode) ----
  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    defaultClientId,
  )
  const [clientSearch, setClientSearch] = useState('')
  const debouncedSearch = useDebouncedValue(clientSearch, 200)

  const clientsQuery = useClients({
    q: debouncedSearch || undefined,
    status: 'active',
    pageSize: 20,
  })
  // Carrega o cliente selecionado pra renderizar nome quando ele não está
  // na página atual de busca.
  const selectedClientQuery = useClient(
    mode === 'slot' && selectedClientId ? selectedClientId : undefined,
  )

  const clientOptions: ComboboxOption[] = useMemo(() => {
    return (clientsQuery.data?.items ?? []).map((c) => ({
      value: c.id,
      label: c.name,
      hint: c.phoneE164,
    }))
  }, [clientsQuery.data])

  // ---- Effective clientId pra carregar sessions ----
  const effectiveClientId =
    mode === 'journey' ? journey?.clientId ?? null : selectedClientId

  // Listas pra dropdowns.
  const usersQuery = useUsers({ page: 1, pageSize: 100, status: 'active' })
  const sessionsQuery = useProcedureSessions(
    {
      clientId: effectiveClientId ?? undefined,
      status: 'pending',
      pageSize: 100,
      sortBy: 'createdAt',
      sortDir: 'asc',
    },
    open && effectiveClientId !== null && !editing,
  )
  // Appointments ativos do cliente — pra excluir sessions já vinculadas a
  // outro horário (mirror do gate findActiveAppointmentForSession no backend:
  // status NOT IN ('cancelled','no_show')).
  const clientAppointmentsQuery = useAppointments(
    {
      clientId: effectiveClientId ?? undefined,
      kind: 'procedure',
      pageSize: 200,
    },
    open && effectiveClientId !== null && !editing,
  )
  const proceduresQuery = useProcedures({ status: 'active', pageSize: 100 })
  // Salas e equipamentos — opcionais. Tenants sem cadastro não veem os campos.
  const unitsQuery = useUnits({ status: 'active', pageSize: 100 })
  const equipmentsQuery = useEquipments({ status: 'active', pageSize: 100 })
  const units = unitsQuery.data?.items ?? []
  const equipments = equipmentsQuery.data?.items ?? []

  const procedureNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of proceduresQuery.data?.items ?? []) m.set(p.id, p.name)
    return m
  }, [proceduresQuery.data])

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: editing
      ? valuesFromAppointment(editing)
      : emptyValues(defaultKind, {
          procedureSessionId: defaultProcedureSessionId,
          professionalId: defaultProfessionalId,
          scheduledAt: defaultScheduledAt,
          durationMinutes: defaultDurationMinutes,
        }),
  })

  const kind = watch('kind')

  // Re-inicializa form sempre que abrir (props podem ter mudado).
  const lastResetKey = useRef<string>('')
  useEffect(() => {
    if (!open) return
    const key = [
      mode,
      defaultKind,
      defaultProcedureSessionId ?? '',
      defaultProfessionalId ?? '',
      defaultScheduledAt ?? '',
      defaultDurationMinutes ?? '',
      defaultClientId ?? '',
      editing ? `${editing.id}@${editing.updatedAt}` : '',
    ].join('|')
    if (lastResetKey.current === key) return
    lastResetKey.current = key
    reset(
      editing
        ? valuesFromAppointment(editing)
        : emptyValues(defaultKind, {
            procedureSessionId: defaultProcedureSessionId,
            professionalId: defaultProfessionalId,
            scheduledAt: defaultScheduledAt,
            durationMinutes: defaultDurationMinutes,
          }),
    )
    setSelectedClientId(defaultClientId)
    setClientSearch('')
  }, [
    open,
    mode,
    defaultKind,
    defaultProcedureSessionId,
    defaultProfessionalId,
    defaultScheduledAt,
    defaultDurationMinutes,
    defaultClientId,
    editing,
    reset,
  ])

  const handleKindChange = (newKind: AppointmentKind) => {
    setValue('kind', newKind)
    setValue(
      'durationMinutes',
      defaultDurationMinutes ?? (newKind === 'evaluation' ? 30 : 60),
    )
    if (newKind === 'evaluation') {
      setValue('evaluationKind', 'initial')
      setValue('procedureSessionId', undefined)
    } else {
      setValue('evaluationKind', undefined)
    }
    // Trocar de kind pode invalidar o profissional já selecionado (perdeu
    // a capacidade requerida). Limpa pra forçar reescolha.
    const currentProfId = watch('professionalId')
    if (currentProfId) {
      const stillEligible = users.some(
        (u) =>
          u.id === currentProfId &&
          (newKind === 'evaluation' ? u.canEvaluate : u.canApplyProcedures),
      )
      if (!stillEligible) setValue('professionalId', '')
    }
  }

  // Resolve journeyId em slot mode: ou cliente já tem ativa, ou cria uma.
  // Em journey mode, retorna a journey passada via props.
  const resolveJourneyId = async (): Promise<string> => {
    if (mode === 'journey' && journey) return journey.id
    if (!selectedClientId) {
      throw new Error('Cliente obrigatório')
    }
    const query = {
      clientId: selectedClientId,
      status: 'active' as const,
      pageSize: 1,
    }
    const result = await queryClient.fetchQuery<PaginatedJourneys>({
      queryKey: journeysListKey(query),
      queryFn: () => fetchJourneys(query),
      staleTime: 0,
    })
    if (result.items.length > 0) return result.items[0]!.id
    // Sem journey ativa — cria uma manual.
    const created = await createJourneyMutation.mutateAsync({
      clientId: selectedClientId,
      source: 'manual',
    })
    return created.id
  }

  // PATCH só com o que mudou: mandar campo igual revalidaria o slot à toa e,
  // em scheduledAt, recalcularia a subetapa do lead sem motivo.
  const submitEdit = async (current: Appointment, data: FormValues) => {
    const orNull = (v: string) => (v === '' ? null : v)
    const patch: UpdateAppointmentInput = {}
    const professionalId = orNull(data.professionalId)
    if (professionalId !== current.professionalId) patch.professionalId = professionalId
    const unitId = orNull(data.unitId)
    if (unitId !== current.unitId) patch.unitId = unitId
    if (current.kind === 'procedure') {
      const equipmentId = orNull(data.equipmentId)
      if (equipmentId !== current.equipmentId) patch.equipmentId = equipmentId
    }
    if (data.scheduledAt !== toLocalDatetimeInput(current.scheduledAt)) {
      patch.scheduledAt = localDatetimeToIso(data.scheduledAt)
    }
    if (data.durationMinutes !== current.durationMinutes) {
      patch.durationMinutes = data.durationMinutes
    }
    const notes = orNull(data.notes)
    if (notes !== current.notes) patch.notes = notes

    if (Object.keys(patch).length === 0) {
      onOpenChange(false)
      return
    }
    try {
      await updateMutation.mutateAsync({ id: current.id, input: patch })
      toast.success('Agendamento atualizado')
      onOpenChange(false)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const message = apiErrorText(err)
      if (status === 409) toast.error(message ?? 'Conflito de agendamento')
      else if (status === 400) toast.error(message ?? 'Dados inválidos')
      else toast.error('Erro ao salvar agendamento. Tente novamente.')
    }
  }

  const onSubmit = handleSubmit(async (data) => {
    if (editing) {
      await submitEdit(editing, data)
      return
    }
    if (mode === 'slot' && !selectedClientId) {
      toast.error('Selecione um cliente')
      return
    }
    try {
      const journeyId = await resolveJourneyId()
      const scheduledAt = localDatetimeToIso(data.scheduledAt)
      const common = {
        journeyId,
        professionalId:
          data.professionalId === '' ? null : (data.professionalId as string),
        unitId: data.unitId === '' ? null : (data.unitId as string),
        scheduledAt,
        durationMinutes: data.durationMinutes,
        notes: data.notes === '' ? null : data.notes,
      }
      const payload: CreateAppointmentInput =
        data.kind === 'evaluation'
          ? {
              ...common,
              kind: 'evaluation',
              evaluation: { kind: data.evaluationKind as EvaluationKind },
            }
          : {
              ...common,
              kind: 'procedure',
              procedureSessionId: data.procedureSessionId as string,
              equipmentId:
                data.equipmentId === '' ? null : (data.equipmentId as string),
            }

      await createMutation.mutateAsync(payload)
      toast.success('Agendamento criado')
      onOpenChange(false)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const message = apiErrorText(err)
      if (status === 409) toast.error(message ?? 'Conflito de agendamento')
      else if (status === 400) toast.error(message ?? 'Dados inválidos')
      else toast.error('Erro ao criar agendamento. Tente novamente.')
    }
  })

  const bookedSessionIds = useMemo(() => {
    const set = new Set<string>()
    for (const a of clientAppointmentsQuery.data?.items ?? []) {
      if (a.status === 'cancelled' || a.status === 'no_show') continue
      if (a.procedureSessionId) set.add(a.procedureSessionId)
    }
    return set
  }, [clientAppointmentsQuery.data])

  // Uma sessão por procedimento — a mais antiga pendente E sem appointment
  // ativo (sort asc por createdAt). Procedimentos cujas sessions estejam
  // todas agendadas/realizadas somem do select. Operador agenda "a próxima
  // de X"; sequenciamento é implícito no backend ao executar.
  const pendingSessions = useMemo<ProcedureSession[]>(() => {
    const items = sessionsQuery.data?.items ?? []
    const seen = new Set<string>()
    const result: ProcedureSession[] = []
    for (const s of items) {
      if (bookedSessionIds.has(s.id)) continue
      if (seen.has(s.procedureId)) continue
      seen.add(s.procedureId)
      result.push(s)
    }
    return result
  }, [sessionsQuery.data, bookedSessionIds])
  const users = usersQuery.data?.items ?? []
  // Filtra profissionais elegíveis pelo kind do appointment. Mirror do gate do
  // backend (assertProfessionalCapability): kind=evaluation exige canEvaluate;
  // kind=procedure exige canApplyProcedures.
  const eligibleUsers = useMemo(() => {
    return users.filter((u) =>
      kind === 'evaluation' ? u.canEvaluate : u.canApplyProcedures,
    )
  }, [users, kind])
  const selectedClientLabel = selectedClientQuery.data?.name ?? null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle={editing ? 'Editar agendamento' : 'Novo agendamento'}>
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            />
            <SheetToolbar.Action
              label={isSubmitting ? 'Salvando…' : editing ? 'Salvar' : 'Criar'}
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting}
            />
          </SheetToolbar>

          <SheetBody>
            <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {/* Edição: tipo/avaliação/sessão são fixos, só informa */}
          {editing && (
            <p className="text-sm text-muted-foreground">
              {APPOINTMENT_KIND_LABELS[editing.kind]} · tipo e sessão não mudam
              depois de criados. Pra trocar, cancele e agende de novo.
            </p>
          )}

          {/* Cliente — só em slot mode */}
          {mode === 'slot' && !editing && (
            <div className="flex flex-col gap-1.5">
              <ComboboxField
                label="Cliente"
                value={selectedClientId}
                onChange={setSelectedClientId}
                options={clientOptions}
                search={clientSearch}
                onSearchChange={setClientSearch}
                isLoading={clientsQuery.isFetching && debouncedSearch.length > 0}
                placeholder="Buscar por nome…"
                emptyLabel={
                  debouncedSearch
                    ? 'Nenhum cliente encontrado'
                    : 'Digite pra buscar'
                }
                selectedLabel={selectedClientLabel}
              />
              {!selectedClientId && (
                <p className="text-xs text-muted-foreground">
                  Cliente novo? Cadastre primeiro em <strong>Clientes</strong>.
                </p>
              )}
            </div>
          )}

          {/* Kind toggle */}
          {!editing && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium leading-none">Tipo</label>
              <div className="grid grid-cols-2 gap-2">
                {APPOINTMENT_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleKindChange(k)}
                    className={`rounded-md border px-3 py-2 text-sm transition-colors ${
                      kind === k
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-input bg-background hover:bg-accent/30'
                    }`}
                  >
                    {APPOINTMENT_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* kind=evaluation extras */}
          {kind === 'evaluation' && !editing && (
            <SelectField
              id="evaluation-kind"
              label="Tipo de avaliação"
              value={watch('evaluationKind') ?? 'initial'}
              onValueChange={(v) =>
                setValue('evaluationKind', v as EvaluationKind, {
                  shouldValidate: true,
                })
              }
              error={errors.evaluationKind?.message ?? null}
            >
              {EVALUATION_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {EVALUATION_KIND_LABELS[k]}
                </SelectItem>
              ))}
            </SelectField>
          )}

          {/* kind=procedure extras */}
          {kind === 'procedure' && !editing && (
            <div className="flex flex-col gap-1.5">
              <SelectField
                id="procedure-session"
                label="Sessão pendente"
                value={watch('procedureSessionId') ?? ''}
                onValueChange={(v) =>
                  setValue('procedureSessionId', v, { shouldValidate: true })
                }
                disabled={!effectiveClientId || pendingSessions.length === 0}
                placeholder={
                  !effectiveClientId
                    ? 'Selecione um cliente'
                    : pendingSessions.length === 0
                      ? 'Nenhuma sessão pendente'
                      : 'Selecione…'
                }
                error={errors.procedureSessionId?.message ?? null}
              >
                {pendingSessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {procedureNameById.get(s.procedureId) ?? s.procedureId.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectField>
              {effectiveClientId &&
                pendingSessions.length === 0 &&
                !sessionsQuery.isLoading && (
                  <p className="px-3 text-xs text-warning" role="alert">
                    Sem sessões pendentes pra este cliente. Feche uma venda
                    primeiro (quote → close-sale).
                  </p>
                )}
            </div>
          )}

          {/* Professional */}
          <div className="flex flex-col gap-1.5">
            <SelectField
              id="appt-professional"
              label="Profissional"
              value={watch('professionalId') || '__none__'}
              onValueChange={(v) =>
                setValue('professionalId', v === '__none__' ? '' : v, {
                  shouldValidate: true,
                })
              }
              helperText="Sem profissional, o gate de disponibilidade (janela + conflitos) é pulado."
            >
              <SelectItem value="__none__">Não atribuir</SelectItem>
              {eligibleUsers.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectField>
            {eligibleUsers.length === 0 && (
              <p className="px-3 text-xs text-warning" role="alert">
                Nenhum profissional habilitado como{' '}
                {kind === 'evaluation' ? 'avaliador(a)' : 'aplicador(a)'}.
                Marque a capacidade em <strong>Configurações &gt; Usuários</strong>.
              </p>
            )}
          </div>

          {/* Sala — só aparece se o tenant tiver alguma cadastrada */}
          {units.length > 0 && (
            <SelectField
              id="appt-unit"
              label="Sala (opcional)"
              value={watch('unitId') || '__none__'}
              onValueChange={(v) =>
                setValue('unitId', v === '__none__' ? '' : v, {
                  shouldValidate: true,
                })
              }
            >
              <SelectItem value="__none__">Sem sala</SelectItem>
              {units.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name}
                </SelectItem>
              ))}
            </SelectField>
          )}

          {/* Equipamento — só em kind=procedure e se houver cadastro */}
          {kind === 'procedure' && equipments.length > 0 && (
            <SelectField
              id="appt-equipment"
              label="Equipamento (opcional)"
              value={watch('equipmentId') || '__none__'}
              onValueChange={(v) =>
                setValue('equipmentId', v === '__none__' ? '' : v, {
                  shouldValidate: true,
                })
              }
            >
              <SelectItem value="__none__">Sem equipamento</SelectItem>
              {equipments.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.name}
                </SelectItem>
              ))}
            </SelectField>
          )}

          {/* Slot */}
          <div className="grid grid-cols-2 gap-3">
            <TextField
              label="Data/hora"
              type="datetime-local"
              error={errors.scheduledAt?.message ?? null}
              required
              {...register('scheduledAt')}
            />
            <TextField
              label="Duração (min)"
              type="number"
              min={5}
              max={480}
              step={5}
              error={errors.durationMinutes?.message ?? null}
              required
              {...register('durationMinutes')}
            />
          </div>

          <TextArea
            id="appt-notes"
            label="Observações"
            rows={3}
            placeholder="Notas internas pro slot"
            {...register('notes')}
          />

            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
