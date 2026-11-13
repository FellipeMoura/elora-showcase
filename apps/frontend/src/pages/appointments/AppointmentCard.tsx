import { useRef, useState, useEffect } from 'react'
import { cn } from '@/lib/utils'
import { useClient } from '@/hooks/useClients'
import type { Appointment } from '@/api/appointments'
import type { Procedure } from '@/api/procedures'
import { getCardColors, lighten, type CalendarColorMode } from './calendarColors'

// Pixels por minuto — define a escala vertical do grid. 2 px/min dá:
//   - 30min = 60px (suficiente pra time + 1 linha)
//   - 60min = 120px (folgado)
//   - 16h = 1920px scrollable.
export const PIXELS_PER_MINUTE = 2

// Threshold em pixels pra distinguir click de drag. Movimento abaixo disso
// no pointerup é tratado como click (abre popover).
const DRAG_THRESHOLD_PX = 4
// Snap padrão pro drag/resize.
const SNAP_MINUTES = 15

interface AppointmentCardProps {
  appointment: Appointment
  procedure?: Procedure | null
  /** Nome do profissional — exibido no card em week view sem foco. */
  professionalName?: string
  colorMode: CalendarColorMode
  // Offset em minutos desde o topo do grid (= time_start configurado).
  topMinutes: number
  // Largura útil — quando duas colunas/horários se sobrepõem, caller
  // pode passar < 1 pra cards lado-a-lado.
  widthFraction?: number
  leftFraction?: number
  /** Click no card. `anchor` permite parent posicionar popover. */
  onClick?: (anchor: HTMLElement) => void
  /**
   * Drag pra mover. Caller recebe novo scheduledAt e dispara PATCH.
   * Sem onMove, drag fica desabilitado (card só clicável).
   */
  onMove?: (id: string, newScheduledAt: Date) => void
  /**
   * Resize via handle na borda inferior. Caller recebe nova duração.
   * Sem onResize, handle não aparece.
   */
  onResize?: (id: string, newDurationMinutes: number) => void
}

interface DragState {
  mode: 'move' | 'resize'
  startY: number
  pointerId: number
  /** Indica se já passou do threshold — depois disso, pointerup não dispara click. */
  exceededThreshold: boolean
  /** Offset em minutos atual (delta arredondado pro snap). */
  deltaMinutes: number
}

export function AppointmentCard({
  appointment,
  procedure,
  professionalName,
  colorMode,
  topMinutes,
  widthFraction = 1,
  leftFraction = 0,
  onClick,
  onMove,
  onResize,
}: AppointmentCardProps): React.ReactElement {
  const { data: client } = useClient(appointment.clientId)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  const colors = getCardColors({
    kind: appointment.kind,
    status: appointment.status,
    procedureColor: procedure?.color,
    mode: colorMode,
  })

  // Render usa o delta atual do drag pra mover/esticar visualmente.
  const visualDeltaY = drag ? drag.deltaMinutes * PIXELS_PER_MINUTE : 0
  const baseTop = topMinutes * PIXELS_PER_MINUTE
  const baseHeight = appointment.durationMinutes * PIXELS_PER_MINUTE

  const top = drag?.mode === 'move' ? baseTop + visualDeltaY : baseTop
  const height =
    drag?.mode === 'resize'
      ? Math.max(SNAP_MINUTES * PIXELS_PER_MINUTE, baseHeight + visualDeltaY)
      : baseHeight

  const wrapperStyle: React.CSSProperties = {
    top,
    height,
    left: `${leftFraction * 100}%`,
    width: `${widthFraction * 100}%`,
  }

  const cardStyle: React.CSSProperties =
    colors.style === 'dark'
      ? {
          backgroundColor: colors.primary,
          borderColor: colors.primary,
          color: '#ffffff',
        }
      : {
          backgroundColor: lighten(colors.primary, 0.88),
          borderColor: colors.primary,
          color: colors.primary,
        }

  // Pointer handlers ─────────────────────────────────────────────────
  const startDrag = (
    e: React.PointerEvent,
    mode: 'move' | 'resize',
  ) => {
    if (mode === 'move' && !onMove) return
    if (mode === 'resize' && !onResize) return
    e.preventDefault()
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    setDrag({
      mode,
      startY: e.clientY,
      pointerId: e.pointerId,
      exceededThreshold: false,
      deltaMinutes: 0,
    })
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const deltaPx = e.clientY - drag.startY
    const exceeded = drag.exceededThreshold || Math.abs(deltaPx) > DRAG_THRESHOLD_PX
    if (!exceeded) return
    const deltaMinRaw = deltaPx / PIXELS_PER_MINUTE
    const snapped = Math.round(deltaMinRaw / SNAP_MINUTES) * SNAP_MINUTES
    if (snapped !== drag.deltaMinutes || exceeded !== drag.exceededThreshold) {
      setDrag({ ...drag, exceededThreshold: exceeded, deltaMinutes: snapped })
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    const wasClick = !drag.exceededThreshold
    const deltaMin = drag.deltaMinutes
    const mode = drag.mode
    setDrag(null)

    if (wasClick) {
      if (mode === 'move' && onClick && wrapperRef.current) {
        onClick(wrapperRef.current)
      }
      return
    }
    if (mode === 'move' && onMove && deltaMin !== 0) {
      const newAt = new Date(
        new Date(appointment.scheduledAt).getTime() + deltaMin * 60_000,
      )
      onMove(appointment.id, newAt)
    } else if (mode === 'resize' && onResize) {
      const newDuration = Math.max(
        SNAP_MINUTES,
        appointment.durationMinutes + deltaMin,
      )
      if (newDuration !== appointment.durationMinutes) {
        onResize(appointment.id, newDuration)
      }
    }
  }

  const handlePointerCancel = (e: React.PointerEvent) => {
    if (!drag || e.pointerId !== drag.pointerId) return
    setDrag(null)
  }

  // Keyboard fallback (sem drag): Enter/Space abre detalhe.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (drag) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (onClick && wrapperRef.current) onClick(wrapperRef.current)
    }
  }

  // Tempo (HH:MM ~ HH:MM) — reflete o estado visual (delta inclui).
  const fmtTime = (date: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  const effectiveStart =
    drag?.mode === 'move'
      ? new Date(
          new Date(appointment.scheduledAt).getTime() + drag.deltaMinutes * 60_000,
        )
      : new Date(appointment.scheduledAt)
  const effectiveDuration =
    drag?.mode === 'resize'
      ? Math.max(SNAP_MINUTES, appointment.durationMinutes + drag.deltaMinutes)
      : appointment.durationMinutes
  const startStr = fmtTime(effectiveStart)
  const endStr = fmtTime(
    new Date(effectiveStart.getTime() + effectiveDuration * 60_000),
  )

  const procedureName = procedure?.name ?? null
  const evalKindLabel =
    appointment.kind === 'evaluation' ? 'Avaliação' : null

  // Listeners globais pra continuar recebendo move/up mesmo se cursor sair
  // da capture region (ex: scroll do container ancestral).
  useEffect(() => {
    if (!drag) return
    const onMoveDoc = (e: PointerEvent) => {
      if (e.pointerId !== drag.pointerId) return
      const deltaPx = e.clientY - drag.startY
      const exceeded =
        drag.exceededThreshold || Math.abs(deltaPx) > DRAG_THRESHOLD_PX
      if (!exceeded) return
      const deltaMinRaw = deltaPx / PIXELS_PER_MINUTE
      const snapped = Math.round(deltaMinRaw / SNAP_MINUTES) * SNAP_MINUTES
      if (snapped !== drag.deltaMinutes || exceeded !== drag.exceededThreshold) {
        setDrag({ ...drag, exceededThreshold: exceeded, deltaMinutes: snapped })
      }
    }
    document.addEventListener('pointermove', onMoveDoc)
    return () => document.removeEventListener('pointermove', onMoveDoc)
  }, [drag])

  return (
    <div
      ref={wrapperRef}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={(e) => startDrag(e, 'move')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      className={cn(
        'absolute p-[2px] focus:outline-none',
        drag && 'z-10',
      )}
      style={wrapperStyle}
    >
      <div
        className={cn(
          'relative h-full overflow-hidden rounded-md border-2 px-2 py-1 text-xs leading-tight transition-shadow',
          drag ? 'shadow-lg ring-2 ring-primary/40' : 'hover:shadow-md',
          (onMove || onClick) && 'cursor-pointer',
        )}
        style={cardStyle}
      >
        {/* Indicador do "outro" lado da cor (o que não está em destaque). */}
        <span
          aria-hidden
          className="absolute left-1 top-1 size-2 rounded-full ring-1 ring-white/30"
          style={{ backgroundColor: colors.iconColor }}
        />

        <div className="pl-3.5 font-semibold tabular-nums">
          {startStr} ~ {endStr}
        </div>

        <div className="truncate font-medium">
          {client ? client.name : '…'}
        </div>

        <div className="truncate text-[11px] opacity-90">
          {procedureName ?? evalKindLabel ?? '—'}
        </div>

        {professionalName && (
          <div className="truncate text-[10px] opacity-75">
            {professionalName}
          </div>
        )}

        {/* Resize handle — só aparece quando onResize está disponível. */}
        {onResize && (
          <div
            onPointerDown={(e) => startDrag(e, 'resize')}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
            aria-label="Redimensionar"
          >
            <div className="mx-auto mt-0.5 h-0.5 w-6 rounded-full bg-current opacity-30" />
          </div>
        )}
      </div>
    </div>
  )
}
