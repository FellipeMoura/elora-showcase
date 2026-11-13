import { useEffect, useState } from 'react'
import type { AvailableRange } from './CalendarGrid'
import type { ProfessionalSchedule, Weekday } from '@/api/availability'

// =====================================================================
// Helpers de cálculo de agenda compartilhados por CalendarPage e
// EvolutionsPage. Originalmente moravam em CalendarPage; movidos pra cá
// quando uma segunda página passou a depender da mesma matemática
// (schedules → ranges visíveis) e dos mesmos limites de janela visível.
//
// Convenções:
//   - `minutes` = minutos desde o `startHour` do grid.
//   - `time` = string `HH:MM[:SS]` vinda do Postgres TIME.
//   - `dateIso` = `YYYY-MM-DD` (date column / chave de comparação).
// =====================================================================

export const DEFAULT_START_HOUR = 6
export const DEFAULT_END_HOUR = 22
export const HARD_MIN_START_HOUR = 0
export const HARD_MAX_END_HOUR = 24

export const WEEKDAY_FROM_JS: Record<number, Weekday> = {
  0: 'sun',
  1: 'mon',
  2: 'tue',
  3: 'wed',
  4: 'thu',
  5: 'fri',
  6: 'sat',
}

export function startOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

export function endOfDay(d: Date): Date {
  const r = new Date(d)
  r.setHours(23, 59, 59, 999)
  return r
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d)
  r.setDate(d.getDate() + days)
  return r
}

export function isoDateOnly(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function timeStringToMinutes(time: string): number {
  const [hStr, mStr] = time.split(':')
  const h = Number(hStr ?? 0)
  const m = Number(mStr ?? 0)
  return h * 60 + m
}

// Conjunto de userIds com schedule vigente na data passada.
export function userIdsAvailableOnDate(
  schedules: ProfessionalSchedule[] | undefined,
  date: Date,
): Set<string> {
  const out = new Set<string>()
  if (!schedules || schedules.length === 0) return out
  const dayKey = WEEKDAY_FROM_JS[date.getDay()]
  const dateIso = isoDateOnly(date)
  for (const s of schedules) {
    if (s.dayOfWeek !== dayKey) continue
    if (s.effectiveFrom && s.effectiveFrom > dateIso) continue
    if (s.effectiveTo && s.effectiveTo < dateIso) continue
    out.add(s.userId)
  }
  return out
}

// Resolve schedules → ranges visíveis pra (user|null, data). Filtra por
// dia_da_semana + vigência. Quando userIds=null, agrega todos os
// profissionais. Faixas adjacentes/sobrepostas são mescladas — buracos
// entre elas viram "indisponível" automaticamente no CalendarGrid (e
// renderizam como intervalo entre dois períodos de trabalho).
export function schedulesToRangesForDate(
  schedules: ProfessionalSchedule[] | undefined,
  userIds: string[] | null,
  date: Date,
  startHour: number,
  endHour: number,
): AvailableRange[] {
  if (!schedules || schedules.length === 0) return []
  const dayKey = WEEKDAY_FROM_JS[date.getDay()]
  const dateIso = isoDateOnly(date)
  const totalMinutes = (endHour - startHour) * 60
  const startBaseMin = startHour * 60
  const allow = userIds ? new Set(userIds) : null
  const raw: AvailableRange[] = []
  for (const s of schedules) {
    if (allow && !allow.has(s.userId)) continue
    if (s.dayOfWeek !== dayKey) continue
    if (s.effectiveFrom && s.effectiveFrom > dateIso) continue
    if (s.effectiveTo && s.effectiveTo < dateIso) continue
    const start = Math.max(0, timeStringToMinutes(s.startTime) - startBaseMin)
    const end = Math.min(totalMinutes, timeStringToMinutes(s.endTime) - startBaseMin)
    if (end > start) raw.push({ startMinutes: start, endMinutes: end })
  }
  if (raw.length <= 1) return raw
  raw.sort((a, b) => a.startMinutes - b.startMinutes)
  const merged: AvailableRange[] = [raw[0]!]
  for (let i = 1; i < raw.length; i++) {
    const last = merged[merged.length - 1]!
    const cur = raw[i]!
    if (cur.startMinutes <= last.endMinutes) {
      last.endMinutes = Math.max(last.endMinutes, cur.endMinutes)
    } else {
      merged.push(cur)
    }
  }
  return merged
}

// Inverte um array de `availableRanges` em "gaps" — janelas entre uma
// faixa disponível e a próxima. Usado pra rotular visualmente intervalos
// (almoço, descanso) entre dois turnos do mesmo profissional. Lacunas no
// começo/fim do dia NÃO entram aqui — só gaps internos, entre duas
// faixas existentes (chrome do EvolutionsPage só rotula intervalo real).
export function gapsBetweenRanges(
  ranges: AvailableRange[],
): AvailableRange[] {
  if (ranges.length < 2) return []
  const sorted = [...ranges].sort((a, b) => a.startMinutes - b.startMinutes)
  const gaps: AvailableRange[] = []
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const cur = sorted[i]!
    if (cur.startMinutes > prev.endMinutes) {
      gaps.push({
        startMinutes: prev.endMinutes,
        endMinutes: cur.startMinutes,
      })
    }
  }
  return gaps
}

// Janela de horas derivada dos schedules cadastrados (min/max com 1h de
// folga em cada ponta, clampado em [0, 24]). Pelo menos 6h de span pra
// não ficar microscópica.
export function deriveGridHours(
  schedules: ProfessionalSchedule[] | undefined,
): { startHour: number; endHour: number } {
  if (!schedules || schedules.length === 0) {
    return { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR }
  }
  let minStart = Infinity
  let maxEnd = -Infinity
  for (const s of schedules) {
    const startMin = timeStringToMinutes(s.startTime)
    const endMin = timeStringToMinutes(s.endTime)
    if (startMin < minStart) minStart = startMin
    if (endMin > maxEnd) maxEnd = endMin
  }
  if (minStart === Infinity || maxEnd === -Infinity) {
    return { startHour: DEFAULT_START_HOUR, endHour: DEFAULT_END_HOUR }
  }
  const startHour = Math.max(HARD_MIN_START_HOUR, Math.floor(minStart / 60) - 1)
  const endHour = Math.min(HARD_MAX_END_HOUR, Math.ceil(maxEnd / 60) + 1)
  const span = endHour - startHour
  if (span < 6) {
    return { startHour, endHour: Math.min(HARD_MAX_END_HOUR, startHour + 6) }
  }
  return { startHour, endHour }
}

// Hook: minutos do "agora" desde startHour. Tick a cada minuto. Null
// quando fora da janela visível.
export function useNowMinutes(
  startHour: number,
  endHour: number,
): number | null {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])
  const totalMinutes = (endHour - startHour) * 60
  const m = (now.getHours() - startHour) * 60 + now.getMinutes()
  if (m < 0 || m > totalMinutes) return null
  return m
}
