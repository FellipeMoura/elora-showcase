import { Fragment, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { Appointment } from '@/api/appointments'
import type { Procedure } from '@/api/procedures'
import { AppointmentCard, PIXELS_PER_MINUTE } from './AppointmentCard'
import type { CalendarColorMode } from './calendarColors'

// =====================================================================
// Grid de tempo com colunas dinâmicas. Day view: cols = profissionais.
// Week view: cols = dias da semana. Mesma estrutura, dados diferentes.
//
// IMPORTANTE — layout segue o padrão do corpo-bueno: cada coluna é um
// BLOCK CONTAINER com altura explícita (header + body), NÃO flex-col.
// Motivo: sticky positioning em flex-col com align-stretch + content
// overflow tem comportamento errático — o `min-height: auto` do flex
// item pode resolver pra altura do parent (= viewport), encurtando o
// containing block do sticky. Resultado: header sticky "desgruda" após
// scroll equivalente à viewport (~480-520px no caso). Block container
// com altura via style attribute resolve isso definitivamente — sticky
// usa os 1960px (header + body) como bounds reais.
// =====================================================================

export const DEFAULT_GRID_START_HOUR = 6
export const DEFAULT_GRID_END_HOUR = 22
// Aliases legadas — código antigo importava direto. Mantidos pra
// compat enquanto migração não passa por todos os call sites.
export const GRID_START_HOUR = DEFAULT_GRID_START_HOUR
export const GRID_END_HOUR = DEFAULT_GRID_END_HOUR
export const HEADER_HEIGHT_PX = 40

export interface CalendarItem {
  appointment: Appointment
  // Procedure já resolvida pelo caller (null em eval ou quando session
  // ainda não tem procedure resolvida — fallback de cor neutro no card).
  procedure: Procedure | null
  /** Nome do profissional pra mostrar no card (week view sem foco). */
  professionalName?: string
}

// Faixa de disponibilidade em minutos desde o start do grid. Caller resolve
// `professional_schedules` × data da coluna pra produzir essas ranges
// (filtrando por day_of_week + effective_from/to).
export interface AvailableRange {
  startMinutes: number
  endMinutes: number
}

export interface IntervalLabel {
  startMinutes: number
  endMinutes: number
  label?: string
}

export interface CalendarColumn {
  id: string
  label: React.ReactNode
  items: CalendarItem[]
  /** Janelas disponíveis pra essa coluna (highlight visual no body). */
  availableRanges?: AvailableRange[]
  /**
   * Faixas rotuladas dentro do body (geralmente gaps entre duas
   * `availableRanges` — intervalos de almoço/descanso). Renderizadas como
   * overlay com texto centralizado em cima do `bg-muted` que o
   * complemento de `availableRanges` já desenha — não substitui o muted,
   * apenas escreve um label por cima pra deixar explícito que aquela
   * faixa é um intervalo planejado, não "fim de expediente".
   */
  intervalLabels?: IntervalLabel[]
  onHeaderClick?: () => void
  headerSubLabel?: string
}

interface CalendarGridProps {
  columns: CalendarColumn[]
  colorMode: CalendarColorMode
  /** Hora inicial visível. Default 6. */
  startHour?: number
  /** Hora final visível (exclusive top). Default 22. */
  endHour?: number
  /** Minutos do "agora" desde startHour pra mostrar a linha. Null = não mostrar. */
  nowMinutes?: number | null
  /** Auto-scroll pro `nowMinutes` no primeiro mount com a coluna não-vazia. */
  scrollToNowOnMount?: boolean
  onAppointmentClick?: (a: Appointment, anchor: HTMLElement) => void
  /**
   * Click em slot vazio. `minutesFromStart` é arredondado pro slot de 15min
   * mais próximo. Caller usa pra pre-preencher form de novo agendamento.
   */
  onSlotClick?: (columnId: string, minutesFromStart: number) => void
  /** Drag pra mover — caller dispara PATCH. Sem prop, drag fica off. */
  onAppointmentMove?: (id: string, newScheduledAt: Date) => void
  /** Resize handle — caller dispara PATCH. Sem prop, handle não aparece. */
  onAppointmentResize?: (id: string, newDurationMinutes: number) => void
}

function generateHourLabels(start: number, end: number): { hour: number; label: string }[] {
  const out: { hour: number; label: string }[] = []
  for (let h = start; h <= end; h++) {
    out.push({ hour: h, label: `${String(h).padStart(2, '0')}:00` })
  }
  return out
}

// Offset em minutos desde startHour. Negativo se appointment está
// antes do start visível (card aparece "acima" e fica clipped).
function minutesFromGridStart(iso: string, startHour: number): number {
  const d = new Date(iso)
  return (d.getHours() - startHour) * 60 + d.getMinutes()
}

// Agrupa items que se sobrepõem transitivamente. Cada cluster recebe lanes
// independentes; dentro do cluster, lane greedy (primeira lane livre).
// Retorna por-item: { lane, totalLanes } onde totalLanes é o tamanho do
// cluster ao qual ele pertence.
interface LaneAssignment {
  lane: number
  totalLanes: number
}

function assignLanes(
  items: CalendarItem[],
  startHour: number,
): Map<string, LaneAssignment> {
  const result = new Map<string, LaneAssignment>()
  // Ordena por start ascendente; em empate, end ascendente.
  const sorted = items
    .map((it) => {
      const start = minutesFromGridStart(it.appointment.scheduledAt, startHour)
      const end = start + it.appointment.durationMinutes
      return { it, start, end }
    })
    .sort((a, b) => (a.start !== b.start ? a.start - b.start : a.end - b.end))

  let cluster: typeof sorted = []
  let clusterEnd = -Infinity

  const flushCluster = () => {
    if (cluster.length === 0) return
    // Aloca lanes greedy.
    const lanes: number[] = [] // end time per lane
    const laneByIdx: number[] = []
    for (const x of cluster) {
      let placed = -1
      for (let i = 0; i < lanes.length; i++) {
        if (lanes[i]! <= x.start) {
          lanes[i] = x.end
          placed = i
          break
        }
      }
      if (placed === -1) {
        lanes.push(x.end)
        placed = lanes.length - 1
      }
      laneByIdx.push(placed)
    }
    const totalLanes = lanes.length
    cluster.forEach((x, i) => {
      result.set(x.it.appointment.id, { lane: laneByIdx[i]!, totalLanes })
    })
    cluster = []
    clusterEnd = -Infinity
  }

  for (const x of sorted) {
    if (cluster.length === 0 || x.start < clusterEnd) {
      cluster.push(x)
      clusterEnd = Math.max(clusterEnd, x.end)
    } else {
      flushCluster()
      cluster.push(x)
      clusterEnd = x.end
    }
  }
  flushCluster()

  return result
}

export function CalendarGrid({
  columns,
  colorMode,
  startHour = DEFAULT_GRID_START_HOUR,
  endHour = DEFAULT_GRID_END_HOUR,
  nowMinutes,
  scrollToNowOnMount = false,
  onAppointmentClick,
  onSlotClick,
  onAppointmentMove,
  onAppointmentResize,
}: CalendarGridProps): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null)
  const didAutoScroll = useRef(false)

  const hourLabels = generateHourLabels(startHour, endHour)
  const totalMinutes = (endHour - startHour) * 60
  const bodyHeightPx = totalMinutes * PIXELS_PER_MINUTE
  const columnFullHeightPx = bodyHeightPx + HEADER_HEIGHT_PX

  // Auto-scroll pro "agora" no primeiro render quando solicitado.
  useEffect(() => {
    if (!scrollToNowOnMount || didAutoScroll.current) return
    if (nowMinutes == null) return
    const el = scrollRef.current
    if (!el) return
    // Centraliza vertical em torno do "agora" deixando ~30% acima.
    const targetY =
      Math.max(0, nowMinutes) * PIXELS_PER_MINUTE - el.clientHeight * 0.3
    el.scrollTop = Math.max(0, targetY)
    didAutoScroll.current = true
  }, [scrollToNowOnMount, nowMinutes])

  return (
    <div
      ref={scrollRef}
      className="relative flex min-h-0 flex-1 overflow-auto rounded-md border bg-background"
    >
      {/* Time axis */}
      <div
        className="sticky left-0 z-20 w-12 shrink-0 border-r bg-background"
        style={{ height: columnFullHeightPx }}
      >
        <div
          className="sticky top-0 z-30 border-b bg-background"
          style={{ height: HEADER_HEIGHT_PX }}
        />
        <div className="relative" style={{ height: bodyHeightPx }}>
          {hourLabels.map((h) => (
            <div
              key={h.hour}
              className="absolute inset-x-0 -translate-y-1/2 text-center text-[11px] font-medium tabular-nums text-muted-foreground"
              style={{
                top: (h.hour - startHour) * 60 * PIXELS_PER_MINUTE,
              }}
            >
              {h.label}
            </div>
          ))}
        </div>
      </div>

      {/* Colunas (event area) */}
      <div className="flex flex-1">
        {columns.map((col) => (
          <CalendarColumnView
            key={col.id}
            column={col}
            colorMode={colorMode}
            startHour={startHour}
            totalMinutes={totalMinutes}
            bodyHeightPx={bodyHeightPx}
            columnFullHeightPx={columnFullHeightPx}
            hourLabels={hourLabels}
            nowMinutes={nowMinutes}
            onAppointmentClick={onAppointmentClick}
            onSlotClick={onSlotClick}
            onAppointmentMove={onAppointmentMove}
            onAppointmentResize={onAppointmentResize}
          />
        ))}
        {columns.length === 0 && (
          <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
            Nenhuma coluna pra renderizar.
          </div>
        )}
      </div>
    </div>
  )
}

interface ColumnViewProps {
  column: CalendarColumn
  colorMode: CalendarColorMode
  startHour: number
  totalMinutes: number
  bodyHeightPx: number
  columnFullHeightPx: number
  hourLabels: { hour: number; label: string }[]
  nowMinutes: number | null | undefined
  onAppointmentClick?: (a: Appointment, anchor: HTMLElement) => void
  onSlotClick?: (columnId: string, minutesFromStart: number) => void
  onAppointmentMove?: (id: string, newScheduledAt: Date) => void
  onAppointmentResize?: (id: string, newDurationMinutes: number) => void
}

const SLOT_SNAP_MINUTES = 15

function CalendarColumnView({
  column,
  colorMode,
  startHour,
  totalMinutes,
  bodyHeightPx,
  columnFullHeightPx,
  hourLabels,
  nowMinutes,
  onAppointmentClick,
  onSlotClick,
  onAppointmentMove,
  onAppointmentResize,
}: ColumnViewProps): React.ReactElement {
  const lanes = assignLanes(column.items, startHour)

  const handleBodyClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onSlotClick) return
    // Só dispara se o alvo for o próprio body (não card/decoração).
    if (e.target !== e.currentTarget) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const minutes = y / PIXELS_PER_MINUTE
    const snapped = Math.max(
      0,
      Math.min(
        totalMinutes - SLOT_SNAP_MINUTES,
        Math.round(minutes / SLOT_SNAP_MINUTES) * SLOT_SNAP_MINUTES,
      ),
    )
    onSlotClick(column.id, snapped)
  }

  return (
    <div
      className="relative min-w-[180px] flex-1 border-r last:border-r-0"
      style={{ height: columnFullHeightPx }}
    >
      <button
        type="button"
        onClick={column.onHeaderClick}
        disabled={!column.onHeaderClick}
        className={cn(
          'sticky top-0 z-10 flex w-full items-center justify-center border-b bg-background px-2 text-sm font-medium',
          column.onHeaderClick && 'cursor-pointer hover:bg-accent/30',
        )}
        style={{ height: HEADER_HEIGHT_PX }}
      >
        <div className="flex flex-col items-center justify-center leading-tight">
          <span className="truncate">{column.label}</span>
          {column.headerSubLabel && (
            <span className="text-[10px] font-normal text-muted-foreground">
              {column.headerSubLabel}
            </span>
          )}
        </div>
      </button>

      <div
        className={cn(
          'relative',
          onSlotClick && 'cursor-pointer',
          'bg-background',
        )}
        style={{ height: bodyHeightPx }}
        onClick={handleBodyClick}
      >
        {/* Janelas indisponíveis (complemento de availableRanges em
            [0, totalMinutes]). Disponível = bg-background (sem overlay);
            indisponível = bg-muted, sinalizando "fora do horário". Quando o
            caller não passa availableRanges, nada é pintado (estado neutro). */}
        {column.availableRanges &&
          (() => {
            const total = totalMinutes
            const unavailable: AvailableRange[] = []
            let cursor = 0
            for (const r of column.availableRanges) {
              const s = Math.max(0, Math.min(total, r.startMinutes))
              const e = Math.max(0, Math.min(total, r.endMinutes))
              if (s > cursor) unavailable.push({ startMinutes: cursor, endMinutes: s })
              if (e > cursor) cursor = e
            }
            if (cursor < total) {
              unavailable.push({ startMinutes: cursor, endMinutes: total })
            }
            return unavailable.map((range, i) => {
              const top = range.startMinutes * PIXELS_PER_MINUTE
              const height = (range.endMinutes - range.startMinutes) * PIXELS_PER_MINUTE
              if (height <= 0) return null
              return (
                <div
                  key={`unavail-${i}`}
                  className="pointer-events-none absolute inset-x-0 bg-muted"
                  style={{ top, height }}
                />
              )
            })
          })()}

        {/* Labels de intervalo (gaps entre faixas disponíveis). Renderizam
            por cima do `bg-muted` já desenhado. Só aparece o texto quando
            a altura do gap é grande o suficiente — gaps de <30min ficam só
            com o muted (texto seria ilegível). */}
        {column.intervalLabels?.map((range, i) => {
          const top = range.startMinutes * PIXELS_PER_MINUTE
          const height = (range.endMinutes - range.startMinutes) * PIXELS_PER_MINUTE
          if (height <= 0) return null
          const showLabel = height >= 30 * PIXELS_PER_MINUTE
          return (
            <div
              key={`interval-${i}`}
              className="pointer-events-none absolute inset-x-0 flex items-center justify-center"
              style={{ top, height }}
            >
              {showLabel && (
                <span className="rounded bg-background/70 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {range.label ?? 'Intervalo'}
                </span>
              )}
            </div>
          )
        })}

        {/* Background lines */}
        {hourLabels.map((h) => (
          <Fragment key={h.hour}>
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-border "
              style={{
                top: (h.hour - startHour) * 60 * PIXELS_PER_MINUTE,
              }}
            />
            <div
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/30"
              style={{
                top:
                  (h.hour - startHour) * 60 * PIXELS_PER_MINUTE +
                  30 * PIXELS_PER_MINUTE,
              }}
            />
          </Fragment>
        ))}

        {/* Linha do "agora" */}
        {nowMinutes != null && nowMinutes >= 0 && nowMinutes <= totalMinutes && (
          <div
            className="pointer-events-none absolute inset-x-0 z-[5]"
            style={{ top: nowMinutes * PIXELS_PER_MINUTE }}
          >
            <div className="absolute -left-1 -top-1 size-2 rounded-full bg-error" />
            <div className="absolute inset-x-0 h-px bg-error/80" />
          </div>
        )}

        {/* Cards com lane assignment pra overlap */}
        {column.items.map((item) => {
          const assignment = lanes.get(item.appointment.id) ?? {
            lane: 0,
            totalLanes: 1,
          }
          const widthFraction = 1 / assignment.totalLanes
          const leftFraction = assignment.lane * widthFraction
          return (
            <AppointmentCard
              key={item.appointment.id}
              appointment={item.appointment}
              procedure={item.procedure}
              professionalName={item.professionalName}
              colorMode={colorMode}
              topMinutes={minutesFromGridStart(
                item.appointment.scheduledAt,
                startHour,
              )}
              widthFraction={widthFraction}
              leftFraction={leftFraction}
              onClick={(anchor) =>
                onAppointmentClick?.(item.appointment, anchor)
              }
              onMove={onAppointmentMove}
              onResize={onAppointmentResize}
            />
          )
        })}
      </div>
    </div>
  )
}
