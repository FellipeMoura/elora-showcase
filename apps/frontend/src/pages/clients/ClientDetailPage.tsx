import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Activity,
  ArrowLeft,
  Ban,
  CalendarPlus,
  Check,
  ClipboardCheck,
  ClipboardPen,
  ClipboardX,
  CornerDownRight,
  ExternalLink,
  FilePlus,
  FileText,
  FileX,
  HandCoins,
  Pencil,
  PenLine,
  Plus,
  Receipt,
  RotateCcw,
  Send,
  Trophy,
  Undo2,
  X,
} from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import {
  useActivateClient,
  useClient,
  useDeactivateClient,
} from '@/hooks/useClients'
import { useJourneys, useJourneyEvents } from '@/hooks/useJourneys'
import { useAppointments } from '@/hooks/useAppointments'
import { useClientForms } from '@/hooks/useClientForms'
import { useEvaluations } from '@/hooks/useEvaluations'
import { useQuotes } from '@/hooks/useQuotes'
import { useTreatments, useTreatment } from '@/hooks/useTreatments'
import { useProcedures } from '@/hooks/useProcedures'
import { useCreateQuote } from '@/hooks/useQuotes'
import { useUsers } from '@/hooks/useUsers'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import {
  displayDateTime,
  displayIsoDate,
  displayMoney,
  displayPhone,
  displayRelativeTime,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  eventStageOrigin,
  labelForEventType,
  STAGE_BADGE_CLASS,
  STAGE_LABELS,
  STAGE_LINE_CLASS,
  STAGE_PIN_CLASS,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
} from '@/pages/journeys/journeyLabels'
import {
  APPOINTMENT_STATUS_BADGE_CLASS,
  APPOINTMENT_STATUS_LABELS,
  formatAppointmentDateTime,
} from '@/pages/appointments/appointmentLabels'
import { AppointmentFormSheet } from '@/pages/appointments/AppointmentFormSheet'
import { SessionEvolutionSheet } from '@/pages/appointments/SessionEvolutionSheet'
import { EvaluationFormSheet } from '@/pages/evaluations/EvaluationFormSheet'
import { QUOTE_STATUSES, type QuoteStatus } from '@/api/quotes'
import type { Treatment, TreatmentStatus } from '@/api/treatments'
import type { ProcedureSession } from '@/api/procedureSessions'
import type { Appointment } from '@/api/appointments'
import type { Client } from '@/api/clients'
import type { ClientForm } from '@/api/clientForms'
import type { Evaluation } from '@/api/evaluations'
import {
  EVALUATION_KIND_LABELS,
  EVALUATION_STATUS_BADGE_CLASS,
  EVALUATION_STATUS_LABELS,
} from '@/api/evaluations'
import type { Journey, JourneyEvent, JourneyStage } from '@/api/journeys'
import { ClientFormSheet } from './ClientFormSheet'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// Detalhamento do cliente — histórico completo: linha do tempo da jornada
// atual + avaliações + vendas + tratamentos. Substitui edição direta na
// lista por navegação pra cá; Editar/Desativar moram na toolbar daqui.
// =====================================================================

export function ClientDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()

  const client = useClient(id)
  const activeJourneys = useJourneys(
    { clientId: id, status: 'active', page: 1, pageSize: 1 },
  )
  const activeJourney: Journey | undefined = activeJourneys.data?.items[0]

  const [editOpen, setEditOpen] = useState(false)
  const deactivate = useDeactivateClient()
  const activate = useActivateClient()

  const handleToggleActive = async (): Promise<void> => {
    if (!client.data) return
    const c = client.data
    const ok = await confirm(
      c.active
        ? {
            title: `Desativar ${c.name}?`,
            description: 'Histórico preservado.',
            confirmLabel: 'Desativar',
            variant: 'destructive',
          }
        : {
            title: `Reativar ${c.name}?`,
            confirmLabel: 'Reativar',
          },
    )
    if (!ok) return
    try {
      if (c.active) {
        await deactivate.mutateAsync(c.id)
        toast.success('Cliente desativado')
      } else {
        await activate.mutateAsync(c.id)
        toast.success('Cliente reativado')
      }
    } catch (err) {
      const message =
        apiErrorText(err)
      toast.error(message ?? 'Erro ao alterar status')
    }
  }

  if (client.isLoading || !id) {
    return (
      <PageContainer>
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Carregando cliente…
        </div>
      </PageContainer>
    )
  }

  if (client.isError || !client.data) {
    return (
      <PageContainer>
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>Erro ao carregar cliente.</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/clients')}>
            Voltar
          </Button>
        </div>
      </PageContainer>
    )
  }

  const c = client.data

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Action
          icon={<ArrowLeft />}
          onClick={() => navigate('/clients')}
          variant="ghost"
          aria-label="Voltar"
        />
        <PageToolbar.Action
          label="Editar"
          icon={<Pencil />}
          onClick={() => setEditOpen(true)}
          variant="outline"
        />
        <PageToolbar.Action
          label={c.active ? 'Desativar' : 'Reativar'}
          icon={c.active ? <Ban /> : <Undo2 />}
          onClick={handleToggleActive}
          variant="outline"
          disabled={deactivate.isPending || activate.isPending}
        />
      </PageToolbar>

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {/* Cabeçalho do cliente — full width */}
        <ClientInfoSection client={c} />

        {/* Strip horizontal de stages da jornada — visão macro */}
        <JourneyStripSection journey={activeJourney} />

        {/* Demais seções em grid 2x2 */}
        <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-2">
          <EvaluationsSection clientId={c.id} journey={activeJourney} />
          <SalesSection clientId={c.id} journey={activeJourney} />
          <TreatmentsSection clientId={c.id} journey={activeJourney} />
          {/* Contratos ocultos por enquanto. Pra voltar: renderizar
              <ClientContractsSection clientId={c.id} /> de
              pages/contracts/ClientContractsSection. */}
        </div>
      </div>

      <ClientFormSheet
        open={editOpen}
        client={c}
        onOpenChange={setEditOpen}
      />
    </PageContainer>
  )
}

// =====================================================================
// Section: Informações do cliente — dados pessoais + badges contextuais.
// Vive no topo do detail, full-width. Mantém o "quem é esse cliente" à
// vista quando o staff entra na tela; demais sections (timeline,
// avaliações, etc) ficam no grid 2x2 abaixo.
// =====================================================================

function ClientInfoSection({ client }: { client: Client }): React.ReactElement {
  return (
    <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="truncate text-lg font-semibold">{client.name}</h1>
        {client.currentJourneyStage && (
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium',
              STAGE_BADGE_CLASS[client.currentJourneyStage],
            )}
          >
            {STAGE_LABELS[client.currentJourneyStage]}
          </span>
        )}
        {client.isVip && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            VIP
          </span>
        )}
        {!client.active && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
            Inativo
          </span>
        )}
      </header>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <InfoField label="Telefone" value={displayPhone(client.phoneE164)} />
        <InfoField label="E-mail" value={client.email} />
        <InfoField
          label="Data de nascimento"
          value={displayIsoDate(client.birthDate)}
        />
        <InfoField
          label="Cadastrado em"
          value={displayRelativeTime(client.createdAt)}
        />
      </dl>

      {client.notes && (
        <div className="flex flex-col gap-1 border-t pt-3">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Observações
          </span>
          <p className="whitespace-pre-wrap text-sm text-foreground">
            {client.notes}
          </p>
        </div>
      )}
    </section>
  )
}

function InfoField({
  label,
  value,
}: {
  label: string
  value: string | null | undefined
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="text-sm text-foreground">
        {value && value.trim().length > 0 ? (
          value
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </dd>
    </div>
  )
}

// =====================================================================
// Section: Strip horizontal de stages da jornada — visão macro.
//
// Renderiza os 5 stages (lead → evaluation → sale → treatment → result)
// como pinos coloridos conectados por linhas. Estados:
//   - done    → pino preenchido com a cor do stage + check
//   - current → pino preenchido + ring de destaque + texto bold
//   - pending → pino outline com número
//
// Status especiais:
//   - won  → todos os anteriores `done` + result vira `done` com check
//   - lost → o pino current fica vermelho com X; subsequentes ficam pending
//
// Timestamps por stage: pra `lead` usa journey.createdAt; pros demais,
// procura o primeiro `stage_transitioned` com payload.to=stage no histórico
// de events (não bloqueia se o event não existir — só não mostra a data).
// =====================================================================

const JOURNEY_STRIP_STAGES: readonly JourneyStage[] = [
  'lead',
  'evaluation',
  'sale',
  'treatment',
  'result',
] as const

// Mapa eventType → ícone Lucide. Coordenado com `eventStageOrigin` em
// journeyLabels.ts (só eventos que retornam stage != null vão pra strip).
// Quando um novo eventType entrar no vocabulário, adicionar aqui pra
// que apareça com ícone reconhecível na strip — fallback usa Activity.
const EVENT_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  // lead reabrir/reciclar
  recycled_from: RotateCcw,
  reopened_from_inbound: CornerDownRight,
  // evaluation
  evaluation_created: ClipboardPen,
  evaluation_scheduled: CalendarPlus,
  evaluation_done: ClipboardCheck,
  form_completed: FileText,
  // sale
  quote_created: Receipt,
  quote_sent: Send,
  quote_rejected: FileX,
  quote_deleted: FileX,
  sale_closed: HandCoins,
  // treatment
  treatment_started: Activity,
  treatment_completed: Trophy,
  treatment_abandoned: ClipboardX,
  treatment_manually_closed: ClipboardX,
}

function iconForEvent(
  eventType: string,
): React.ComponentType<{ className?: string }> {
  return EVENT_ICON_MAP[eventType] ?? Activity
}

function JourneyStripSection({
  journey,
}: {
  journey: Journey | undefined
}): React.ReactElement {
  const events = useJourneyEvents(journey?.id, { pageSize: 100 })

  // Mapeia stage → timestamp em que foi atingido. Backend devolve events
  // por createdAt desc; pegamos o primeiro pra cada stage (em journeys
  // forward, cada stage só transita 1 vez, então "primeiro" = "único").
  const stageTimestamps = useMemo(() => {
    const map = new Map<JourneyStage, string>()
    if (journey) map.set('lead', journey.createdAt)
    for (const ev of events.data?.items ?? []) {
      if (ev.eventType !== 'stage_transitioned' || !ev.payload) continue
      const to = (ev.payload as { to?: unknown }).to
      if (typeof to !== 'string') continue
      if (
        (JOURNEY_STRIP_STAGES as readonly string[]).includes(to) &&
        !map.has(to as JourneyStage)
      ) {
        map.set(to as JourneyStage, ev.createdAt)
      }
    }
    return map
  }, [journey, events.data])

  // Agrupa eventos "secundários" pelo stage de origem. Segmento entre os
  // pinos X e X+1 exibe os eventos cujo origin === X (i.e. aconteceram
  // enquanto a journey estava em X). Ordenados por createdAt asc — leitura
  // natural da esquerda pra direita.
  const eventsByOriginStage = useMemo(() => {
    const map = new Map<JourneyStage, JourneyEvent[]>()
    for (const ev of events.data?.items ?? []) {
      const origin = eventStageOrigin(ev.eventType)
      if (!origin) continue
      const list = map.get(origin) ?? []
      list.push(ev)
      map.set(origin, list)
    }
    for (const list of map.values()) {
      list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    }
    return map
  }, [events.data])

  return (
    <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Jornada</h2>
        {journey && (
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className={cn(
                'rounded px-1.5 py-0.5 font-medium',
                STATUS_BADGE_CLASS[journey.status],
              )}
            >
              {STATUS_LABELS[journey.status]}
            </span>
            <Link
              to={`/journeys/${journey.id}`}
              className="text-primary hover:underline"
            >
              Abrir →
            </Link>
          </div>
        )}
      </header>

      {!journey && (
        <p className="text-sm text-muted-foreground">
          Sem jornada ativa. Histórico fica visível nas seções abaixo.
        </p>
      )}

      {journey && (
        <ol className="flex items-start">
          {JOURNEY_STRIP_STAGES.map((stage, idx) => {
            const currentIdx = JOURNEY_STRIP_STAGES.indexOf(journey.stage)
            const isWon = journey.status === 'won'
            const isLost = journey.status === 'lost'

            // Determina state do pino. `won` força `done` em tudo até o
            // último; `lost` marca o atual como lost e os seguintes como
            // pending. `active` segue o currentIdx normal.
            let state: 'done' | 'current' | 'pending' | 'lost'
            if (isWon) {
              state = idx <= currentIdx ? 'done' : 'pending'
              // Em won, o `result` (último) vira done explicitamente —
              // currentIdx já cobre porque won terminal exige result.
            } else if (isLost) {
              if (idx < currentIdx) state = 'done'
              else if (idx === currentIdx) state = 'lost'
              else state = 'pending'
            } else {
              if (idx < currentIdx) state = 'done'
              else if (idx === currentIdx) state = 'current'
              else state = 'pending'
            }

            const isLastPin = idx === JOURNEY_STRIP_STAGES.length - 1

            // Cor do conector segue o stage do pino ANTERIOR — segmento
            // entre lead e evaluation usa cor de lead. Só "preenche" se o
            // pino anterior está done; se anterior é current/lost/pending,
            // segmento fica neutro.
            return (
              <li
                key={stage}
                className={cn(
                  'flex min-w-0 flex-1 items-start gap-0',
                  isLastPin && 'flex-none',
                )}
              >
                <JourneyPin
                  stage={stage}
                  state={state}
                  timestamp={stageTimestamps.get(stage)}
                />
                {!isLastPin && (
                  <JourneyConnector
                    fromStage={stage}
                    filled={state === 'done'}
                    events={eventsByOriginStage.get(stage) ?? []}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

// =====================================================================
// JourneyPin — pino circular com label e timestamp abaixo. Estado decide
// background, ícone e enfase. Largura mínima dimensiona o item flexível
// no <ol> (evita pino "esmagar" o connector quando label é longa).
// =====================================================================

function JourneyPin({
  stage,
  state,
  timestamp,
}: {
  stage: JourneyStage
  state: 'done' | 'current' | 'pending' | 'lost'
  timestamp: string | undefined
}): React.ReactElement {
  const pinColorClass = STAGE_PIN_CLASS[stage]

  const circleClass = (() => {
    switch (state) {
      case 'done':
        return cn('shrink-0', pinColorClass)
      case 'current':
        return cn(
          'shrink-0 ring-4 ring-primary/30',
          pinColorClass,
        )
      case 'lost':
        return 'shrink-0 bg-error text-error-foreground ring-4 ring-error/30'
      case 'pending':
        return 'shrink-0 bg-muted text-muted-foreground border-2 border-dashed border-border'
    }
  })()

  const icon = (() => {
    if (state === 'done') return <Check className="size-4" />
    if (state === 'lost') return <X className="size-4" />
    // current/pending: número do stage (1-indexed)
    const idx = ['lead', 'evaluation', 'sale', 'treatment', 'result'].indexOf(
      stage,
    )
    return <span className="text-xs font-semibold">{idx + 1}</span>
  })()

  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5">
      <div
        className={cn(
          'grid size-9 place-items-center rounded-full transition-shadow',
          circleClass,
        )}
        aria-current={state === 'current' ? 'step' : undefined}
      >
        {icon}
      </div>
      <div className="flex min-w-0 flex-col items-center gap-0.5 text-center">
        <span
          className={cn(
            'truncate text-xs',
            state === 'current'
              ? 'font-semibold text-foreground'
              : state === 'pending'
                ? 'text-muted-foreground'
                : 'font-medium text-foreground',
          )}
        >
          {STAGE_LABELS[stage]}
        </span>
        {timestamp && state !== 'pending' && (
          <span className="truncate text-[10px] text-muted-foreground">
            {displayIsoDate(timestamp.slice(0, 10))}
          </span>
        )}
      </div>
    </div>
  )
}

// =====================================================================
// JourneyConnector — barra horizontal entre dois pinos. `filled` indica
// que o stage anterior já foi concluído (cor sólida); senão fica neutro.
// Alinhada ao centro vertical do pino (mt = metade da altura do círculo).
//
// `events` são "updates secundários" que aconteceram durante `fromStage`
// — renderizados como dots ao longo da linha, distribuídos uniformemente.
// Hover/click mostra Tooltip com label + relative time. Posicionamento
// não é temporalmente exato — só preserva ordem cronológica (já vem
// ordenado do caller).
// =====================================================================

function JourneyConnector({
  fromStage,
  filled,
  events,
}: {
  fromStage: JourneyStage
  filled: boolean
  events: JourneyEvent[]
}): React.ReactElement {
  const lineClass = filled ? STAGE_LINE_CLASS[fromStage] : 'bg-border'
  const dotBorderClass = filled
    ? STAGE_LINE_CLASS[fromStage]
    : 'bg-muted-foreground'

  return (
    <div className="relative mt-[14px] flex min-w-0 flex-1 flex-col items-stretch">
      {/* Linha base */}
      <div className={cn('h-0.5 w-full', lineClass)} aria-hidden />

      {/* Dots dos eventos centralizados sobre a linha. flex justify-around
          distribui automaticamente; pointer-events-none no wrapper +
          pointer-events-auto no botão pra que só os dots capturem clique. */}
      {events.length > 0 && (
        <div className="pointer-events-none absolute inset-x-0 top-0 -translate-y-1/2 flex items-center justify-around">
          {events.map((ev) => (
            <JourneyConnectorDot
              key={ev.id}
              event={ev}
              borderClass={dotBorderClass}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function JourneyConnectorDot({
  event,
  borderClass,
}: {
  event: JourneyEvent
  borderClass: string
}): React.ReactElement {
  const Icon = iconForEvent(event.eventType)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className={cn(
            'pointer-events-auto grid size-5 place-items-center rounded-full bg-background ring-2 transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          style={{
            // ring usa cor via Tailwind ring-{color}? Sem token dinâmico,
            // usamos box-shadow inline com classe que pinta background.
            // Solução: aplicar `borderClass` num filho (vai como cor).
          }}
          aria-label={labelForEventType(event.eventType)}
        >
          <span
            className={cn(
              'grid size-full place-items-center rounded-full text-foreground',
              borderClass,
              // bg do dot é a cor; ícone fica em cima com mix
              'text-white dark:text-white',
            )}
          >
            <Icon className="size-3" />
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            {labelForEventType(event.eventType)}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {displayRelativeTime(event.createdAt)}
          </span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

// =====================================================================
// Section: Avaliações (unificada — entidade clínica + appointment + fichas)
//
// Lista evaluations do cliente. Pra cada uma, cruza com:
//   - appointment vinculado (kind=evaluation, match por evaluationId)
//   - client_forms vinculadas (match por evaluationId)
//
// Visualmente, três cenários:
//   A. Evaluation COM appointment → mostra status+horário do slot, kind
//   B. Evaluation SEM appointment (criada standalone) → mostra "Sem
//      agendamento", kind
//   C. Em ambos os casos acima: se ainda não tem ficha, botão "Criar ficha";
//      se já tem, "Acessar fichas" + resumo (X finalizadas, Y rascunho).
//
// Os dois botões do header continuam: "Nova avaliação" (entidade direto)
// e "Agendar" (slot na agenda, eval inline).
// =====================================================================

function EvaluationsSection({
  clientId,
  journey,
}: {
  clientId: string
  journey: Journey | undefined
}): React.ReactElement {
  const evaluationsQuery = useEvaluations({
    clientId,
    page: 1,
    pageSize: 50,
    sortBy: 'createdAt',
    sortDir: 'desc',
  })
  const appointmentsQuery = useAppointments({
    clientId,
    kind: 'evaluation',
    pageSize: 100,
  })
  const formsQuery = useClientForms(clientId)

  const [createOpen, setCreateOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  const [editingAppointment, setEditingAppointment] =
    useState<Appointment | null>(null)
  const disabled = !journey || journey.status !== 'active'

  // Cruza appointment.evaluation_id → appointment. Pode ter múltiplos
  // (reagendamento gera linhas novas); mantemos o mais recente ativo.
  const appointmentByEvaluationId = useMemo(() => {
    const m = new Map<string, Appointment>()
    for (const a of appointmentsQuery.data?.items ?? []) {
      if (!a.evaluationId) continue
      const existing = m.get(a.evaluationId)
      // Prefere ativo sobre cancelado; entre ativos, o mais recente.
      const isCancelled = a.status === 'cancelled'
      const existingIsCancelled = existing?.status === 'cancelled'
      if (!existing) {
        m.set(a.evaluationId, a)
      } else if (existingIsCancelled && !isCancelled) {
        m.set(a.evaluationId, a)
      } else if (
        !isCancelled &&
        !existingIsCancelled &&
        new Date(a.scheduledAt) > new Date(existing.scheduledAt)
      ) {
        m.set(a.evaluationId, a)
      }
    }
    return m
  }, [appointmentsQuery.data])

  const formsByEvaluationId = useMemo(() => {
    const m = new Map<string, ClientForm[]>()
    for (const f of formsQuery.data?.items ?? []) {
      const list = m.get(f.evaluationId) ?? []
      list.push(f)
      m.set(f.evaluationId, list)
    }
    return m
  }, [formsQuery.data])

  const items = evaluationsQuery.data?.items ?? []
  const isLoading = evaluationsQuery.isLoading
  const isError = evaluationsQuery.isError

  return (
    <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Avaliações</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCreateOpen(true)}
            disabled={disabled}
            title={
              disabled
                ? 'Precisa de jornada ativa pra criar avaliação'
                : undefined
            }
          >
            <ClipboardPen className="mr-1 size-4" />
            Nova avaliação
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setScheduleOpen(true)}
            disabled={disabled}
            title={
              disabled
                ? 'Precisa de jornada ativa pra agendar avaliação'
                : undefined
            }
          >
            <CalendarPlus className="mr-1 size-4" />
            Agendar
          </Button>
        </div>
      </header>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {isError && (
        <p className="text-sm text-error">Erro ao carregar avaliações.</p>
      )}
      {!isLoading && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma avaliação registrada.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((ev) => (
          <EvaluationRow
            key={ev.id}
            evaluation={ev}
            appointment={appointmentByEvaluationId.get(ev.id)}
            forms={formsByEvaluationId.get(ev.id) ?? []}
            onEditAppointment={setEditingAppointment}
          />
        ))}
      </ul>

      <AppointmentFormSheet
        open={editingAppointment !== null}
        mode="slot"
        appointment={editingAppointment}
        defaultClientId={clientId}
        onOpenChange={(o) => {
          if (!o) setEditingAppointment(null)
        }}
      />

      {journey && (
        <>
          <EvaluationFormSheet
            open={createOpen}
            journeyId={journey.id}
            journeyStage={journey.stage}
            onOpenChange={setCreateOpen}
          />
          <AppointmentFormSheet
            open={scheduleOpen}
            journey={journey}
            defaultKind="evaluation"
            onOpenChange={setScheduleOpen}
          />
        </>
      )}
    </section>
  )
}

function EvaluationRow({
  evaluation,
  appointment,
  forms,
  onEditAppointment,
}: {
  evaluation: Evaluation
  appointment: Appointment | undefined
  forms: ClientForm[]
  onEditAppointment: (appointment: Appointment) => void
}): React.ReactElement {
  const canEditAppointment =
    appointment !== undefined &&
    (appointment.status === 'scheduled' || appointment.status === 'confirmed')
  const counts = useMemo(() => {
    let completed = 0
    let draft = 0
    for (const f of forms) {
      if (f.status === 'completed') completed += 1
      else if (f.status === 'draft') draft += 1
    }
    return { completed, draft }
  }, [forms])

  const hasForms = forms.length > 0
  const actionHref = `/evaluations/${evaluation.id}/forms`

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded border bg-muted/20 p-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <ClipboardPen className="size-4 text-muted-foreground" />
          <span className="font-medium">
            {EVALUATION_KIND_LABELS[evaluation.kind]}
          </span>
          {appointment ? (
            <>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs font-medium',
                  APPOINTMENT_STATUS_BADGE_CLASS[appointment.status],
                )}
              >
                {APPOINTMENT_STATUS_LABELS[appointment.status]}
              </span>
              <span className="text-xs text-muted-foreground">
                {formatAppointmentDateTime(appointment.scheduledAt)}
              </span>
            </>
          ) : (
            <>
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-xs font-medium',
                  EVALUATION_STATUS_BADGE_CLASS[evaluation.status],
                )}
              >
                {EVALUATION_STATUS_LABELS[evaluation.status]}
              </span>
              <span className="text-xs text-muted-foreground italic">
                Sem agendamento
              </span>
            </>
          )}
        </div>
        {hasForms && (
          <div className="text-xs text-muted-foreground">
            {counts.completed > 0 && (
              <span className="text-success">
                {counts.completed} ficha{counts.completed > 1 ? 's' : ''}{' '}
                finalizada{counts.completed > 1 ? 's' : ''}
              </span>
            )}
            {counts.completed > 0 && counts.draft > 0 && ' · '}
            {counts.draft > 0 && (
              <span>
                {counts.draft} rascunho{counts.draft > 1 ? 's' : ''}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {canEditAppointment && appointment && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={() => onEditAppointment(appointment)}
            title="Alterar profissional, horário ou sala"
          >
            <Pencil className="mr-1 size-3.5" />
            Editar agendamento
          </Button>
        )}
        <Button asChild variant="ghost" size="sm" className="h-8 px-2">
          <Link to={actionHref}>
            {hasForms ? (
              <>
                <FileText className="mr-1 size-3.5" />
                Acessar fichas
              </>
            ) : (
              <>
                <FilePlus className="mr-1 size-3.5" />
                Criar ficha
              </>
            )}
          </Link>
        </Button>
      </div>
    </li>
  )
}

// =====================================================================
// Section: Histórico de vendas
// =====================================================================

const QUOTE_STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviado',
  accepted: 'Aceito',
  rejected: 'Recusado',
  expired: 'Expirado',
}

const QUOTE_STATUS_BADGE_CLASS: Record<QuoteStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-info/15 text-info',
  accepted: 'bg-success/15 text-success',
  rejected: 'bg-error/15 text-error',
  expired: 'bg-warning/15 text-warning',
}
// QUOTE_STATUSES é importado pra forçar exhaustiveness check em PR review.
void QUOTE_STATUSES

function SalesSection({
  clientId,
  journey,
}: {
  clientId: string
  journey: Journey | undefined
}): React.ReactElement {
  const navigate = useNavigate()
  const { data, isLoading, isError } = useQuotes({
    clientId,
    pageSize: 50,
    sortBy: 'createdAt',
    sortDir: 'desc',
  })
  const createQuote = useCreateQuote()

  const disabled = !journey || journey.status !== 'active'

  const handleCreate = async (): Promise<void> => {
    if (!journey) return
    try {
      const q = await createQuote.mutateAsync({
        journeyId: journey.id,
        // direct_sale = caminho operacional padrão. UI de detalhe permite
        // ajustar items + status; origin é só rastreabilidade.
        origin: 'direct_sale',
      })
      navigate(`/quotes/${q.id}`)
    } catch (err) {
      const message =
        apiErrorText(err)
      toast.error(message ?? 'Erro ao criar orçamento')
    }
  }

  const items = data?.items ?? []

  return (
    <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Vendas</h2>
        <Button
          variant="outline"
          size="sm"
          onClick={handleCreate}
          disabled={disabled || createQuote.isPending}
          title={
            disabled ? 'Precisa de jornada ativa pra criar venda' : undefined
          }
        >
          <Plus className="mr-1 size-4" />
          Nova venda
        </Button>
      </header>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {isError && (
        <p className="text-sm text-error">Erro ao carregar vendas.</p>
      )}
      {!isLoading && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhuma venda ou orçamento registrado.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {items.map((q) => (
          <li
            key={q.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded border bg-muted/20 p-2.5"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-medium',
                    QUOTE_STATUS_BADGE_CLASS[q.status],
                  )}
                >
                  {QUOTE_STATUS_LABELS[q.status]}
                </span>
                <span className="font-medium">
                  {displayMoney(q.totalAmount)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {displayRelativeTime(q.createdAt)}
                </span>
              </div>
            </div>
            <Link
              to={`/quotes/${q.id}`}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            >
              <ExternalLink className="size-3.5" />
              Abrir
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

// =====================================================================
// Section: Histórico de tratamentos
// =====================================================================

const TREATMENT_STATUS_LABELS: Record<TreatmentStatus, string> = {
  active: 'Ativo',
  completed: 'Concluído',
  abandoned: 'Abandonado',
  manually_closed: 'Fechado manualmente',
}

const TREATMENT_STATUS_BADGE_CLASS: Record<TreatmentStatus, string> = {
  active: 'bg-info/15 text-info',
  completed: 'bg-success/15 text-success',
  abandoned: 'bg-error/15 text-error',
  manually_closed: 'bg-muted text-muted-foreground',
}

function TreatmentsSection({
  clientId,
  journey,
}: {
  clientId: string
  journey: Journey | undefined
}): React.ReactElement {
  const { data, isLoading, isError } = useTreatments({
    clientId,
    pageSize: 20,
    sortBy: 'createdAt',
    sortDir: 'desc',
  })

  const items = data?.items ?? []

  return (
    <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Tratamentos</h2>
      </header>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      )}
      {isError && (
        <p className="text-sm text-error">Erro ao carregar tratamentos.</p>
      )}
      {!isLoading && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum tratamento. Vendas aceitas geram tratamentos automaticamente.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {items.map((t) => (
          <TreatmentRow
            key={t.id}
            treatment={t}
            clientId={clientId}
            journey={journey}
          />
        ))}
      </ul>
    </section>
  )
}

function TreatmentRow({
  treatment,
  clientId,
  journey,
}: {
  treatment: Treatment
  clientId: string
  journey: Journey | undefined
}): React.ReactElement {
  const detail = useTreatment(treatment.id)
  const procedures = useProcedures({
    page: 1,
    pageSize: 200,
    status: 'all',
  })
  // Appointments de procedimento do cliente — usamos pra checar se cada
  // session já tem um agendamento (com data) ou se ainda precisa ser
  // marcada. `kind=procedure` ignora avaliações.
  const procedureAppointments = useAppointments({
    clientId,
    kind: 'procedure',
    pageSize: 200,
  })

  const appointmentBySessionId = useMemo(() => {
    const m = new Map<string, Appointment>()
    for (const a of procedureAppointments.data?.items ?? []) {
      if (
        a.procedureSessionId &&
        a.status !== 'cancelled' &&
        // Mantemos o mais recente por session (raríssimo ter dois — defesa).
        (!m.has(a.procedureSessionId) ||
          new Date(m.get(a.procedureSessionId)!.scheduledAt) <
            new Date(a.scheduledAt))
      ) {
        m.set(a.procedureSessionId, a)
      }
    }
    return m
  }, [procedureAppointments.data])

  const procedureNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of procedures.data?.items ?? []) m.set(p.id, p.name)
    return m
  }, [procedures.data])

  // Nome de quem executou a sessão (executedByUserId). status 'all' porque
  // o aplicador pode ter sido desativado depois.
  const usersQuery = useUsers({ page: 1, pageSize: 200, status: 'all' })
  const userNameById = useMemo(() => {
    const m = new Map<string, string>()
    for (const u of usersQuery.data?.items ?? []) m.set(u.id, u.name)
    return m
  }, [usersQuery.data])

  const [scheduleSessionId, setScheduleSessionId] = useState<string | null>(
    null,
  )
  const [evolveSession, setEvolveSession] = useState<ProcedureSession | null>(
    null,
  )
  const [editingAppointment, setEditingAppointment] =
    useState<Appointment | null>(null)

  // Sessões agrupadas por procedimento (um item do accordion por grupo).
  // Ordem dentro do grupo: executada → data de execução; senão data do
  // agendamento; sem agendamento vai pro fim (por createdAt).
  const groups = useMemo(() => {
    const byProcedure = new Map<string, ProcedureSession[]>()
    for (const s of detail.data?.sessions ?? []) {
      const list = byProcedure.get(s.procedureId) ?? []
      list.push(s)
      byProcedure.set(s.procedureId, list)
    }
    const sortKey = (s: ProcedureSession): [number, number] => {
      if (s.executedAt) return [0, new Date(s.executedAt).getTime()]
      const appt = appointmentBySessionId.get(s.id)
      if (appt) return [0, new Date(appt.scheduledAt).getTime()]
      return [1, new Date(s.createdAt).getTime()]
    }
    return Array.from(byProcedure.entries()).map(([procedureId, list]) => {
      const sessions = [...list].sort((a, b) => {
        const [ga, ta] = sortKey(a)
        const [gb, tb] = sortKey(b)
        return ga - gb || ta - tb
      })
      const nextAppointment =
        sessions
          .map((s) => appointmentBySessionId.get(s.id))
          .filter(
            (a): a is Appointment =>
              a !== undefined &&
              (a.status === 'scheduled' || a.status === 'confirmed'),
          )
          .sort(
            (a, b) =>
              new Date(a.scheduledAt).getTime() -
              new Date(b.scheduledAt).getTime(),
          )[0] ?? null
      return {
        procedureId,
        sessions,
        done: sessions.filter((s) => s.status === 'done').length,
        awaitingEvolution: sessions.filter((s) => s.status === 'signed').length,
        nextAppointment,
      }
    })
  }, [detail.data, appointmentBySessionId])

  return (
    <li className="flex flex-col gap-2 rounded border bg-muted/20 p-3">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{treatment.name}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium',
              TREATMENT_STATUS_BADGE_CLASS[treatment.status],
            )}
          >
            {TREATMENT_STATUS_LABELS[treatment.status]}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          Iniciado{' '}
          {treatment.startedAt
            ? displayRelativeTime(treatment.startedAt)
            : '—'}
        </span>
      </header>

      {detail.isLoading && (
        <p className="text-xs text-muted-foreground">Carregando sessões…</p>
      )}
      {detail.data?.sessions.length === 0 && (
        <p className="text-xs text-muted-foreground">
          Sem procedimentos vinculados.
        </p>
      )}

      {groups.length > 0 && (
        <Accordion
          type="multiple"
          className="rounded border bg-background px-3"
        >
          {groups.map((g) => (
            <AccordionItem key={g.procedureId} value={g.procedureId}>
              <AccordionTrigger className="py-2.5 hover:no-underline">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="truncate">
                    {procedureNameById.get(g.procedureId) ?? '—'}
                  </span>
                  <span className="text-xs font-normal text-muted-foreground">
                    {g.done}/{g.sessions.length} realizadas
                  </span>
                  {g.awaitingEvolution > 0 && (
                    <span className="rounded bg-warning-soft px-1.5 py-0.5 text-xs font-medium text-warning-soft-foreground">
                      {g.awaitingEvolution} aguardando evolução
                    </span>
                  )}
                  {g.nextAppointment && (
                    <span className="text-xs font-normal text-muted-foreground">
                      Próxima: {formatAppointmentDateTime(g.nextAppointment.scheduledAt)}
                    </span>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <ol className="flex flex-col gap-2.5">
                  {g.sessions.map((s, idx) => (
                    <SessionRow
                      key={s.id}
                      index={idx + 1}
                      session={s}
                      appointment={appointmentBySessionId.get(s.id)}
                      executedByName={
                        s.executedByUserId
                          ? (userNameById.get(s.executedByUserId) ?? null)
                          : null
                      }
                      canSchedule={Boolean(journey && journey.status === 'active')}
                      onSchedule={() => setScheduleSessionId(s.id)}
                      onEvolve={() => setEvolveSession(s)}
                      onEditAppointment={setEditingAppointment}
                    />
                  ))}
                </ol>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      <AppointmentFormSheet
        open={editingAppointment !== null}
        mode="slot"
        appointment={editingAppointment}
        defaultClientId={clientId}
        onOpenChange={(o) => {
          if (!o) setEditingAppointment(null)
        }}
      />

      {journey && scheduleSessionId && (
        <AppointmentFormSheet
          open={scheduleSessionId !== null}
          journey={journey}
          defaultKind="procedure"
          defaultProcedureSessionId={scheduleSessionId}
          onOpenChange={(o) => {
            if (!o) setScheduleSessionId(null)
          }}
        />
      )}

      <SessionEvolutionSheet
        open={evolveSession !== null}
        onOpenChange={(o) => {
          if (!o) setEvolveSession(null)
        }}
        session={evolveSession}
      />
    </li>
  )
}

function SessionRow({
  index,
  session,
  appointment,
  executedByName,
  canSchedule,
  onSchedule,
  onEvolve,
  onEditAppointment,
}: {
  /** Posição da sessão dentro do grupo do procedimento (1-based). */
  index: number
  session: ProcedureSession
  appointment: Appointment | undefined
  executedByName: string | null
  canSchedule: boolean
  onSchedule: () => void
  onEvolve: () => void
  onEditAppointment: (appointment: Appointment) => void
}): React.ReactElement {
  const canEditAppointment =
    appointment !== undefined &&
    (appointment.status === 'scheduled' || appointment.status === 'confirmed')
  const isPending = session.status === 'pending'
  const isSigned = session.status === 'signed'
  const isDone = session.status === 'done'
  const needsScheduling = isPending && !appointment

  return (
    <li className="flex flex-col gap-1.5 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground">Sessão {index}</span>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium',
              session.status === 'done'
                ? 'bg-success/15 text-success'
                : session.status === 'cancelled'
                  ? 'bg-error/15 text-error'
                  : isSigned
                    ? 'bg-warning-soft text-warning-soft-foreground'
                    : 'bg-muted text-muted-foreground',
            )}
          >
            {session.status === 'done'
              ? 'Realizado'
              : session.status === 'cancelled'
                ? 'Cancelado'
                : isSigned
                  ? 'Aguardando evolução'
                  : 'Pendente'}
          </span>
          {appointment && (
            <span className="text-xs text-muted-foreground">
              {formatAppointmentDateTime(appointment.scheduledAt)} ·{' '}
              {APPOINTMENT_STATUS_LABELS[appointment.status]}
            </span>
          )}
        </div>

        {needsScheduling && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onSchedule}
            disabled={!canSchedule}
            title={
              canSchedule ? 'Agendar sessão' : 'Jornada não ativa'
            }
            className="h-7 px-2 text-xs"
          >
            <CalendarPlus className="mr-1 size-3.5" />
            Agendar
          </Button>
        )}

        {canEditAppointment && appointment && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onEditAppointment(appointment)}
            title="Alterar profissional, horário ou sala"
            className="h-7 px-2 text-xs"
          >
            <Pencil className="mr-1 size-3.5" />
            Editar
          </Button>
        )}

        {(isSigned || isDone) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onEvolve}
            title={isSigned ? 'Registrar evolução clínica' : 'Ver evolução'}
            className={cn('h-7 px-2 text-xs', isSigned && 'text-success')}
          >
            <PenLine className="mr-1 size-3.5" />
            {isSigned ? 'Evoluir' : 'Evolução'}
          </Button>
        )}
      </div>

      {(session.executedAt || executedByName) && (
        <span className="text-xs text-muted-foreground">
          {session.executedAt && (
            <>Executado em {displayDateTime(session.executedAt)}</>
          )}
          {session.executedAt && executedByName && ' · '}
          {executedByName && <>por {executedByName}</>}
        </span>
      )}

      {/* Mesmo bloco da TreatmentDetailPage */}
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

