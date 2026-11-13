import type {
  ScheduleExceptionKind,
  Weekday,
} from '@/api/availability'

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: 'Segunda',
  tue: 'Terça',
  wed: 'Quarta',
  thu: 'Quinta',
  fri: 'Sexta',
  sat: 'Sábado',
  sun: 'Domingo',
}

export const WEEKDAY_SHORT_LABELS: Record<Weekday, string> = {
  mon: 'Seg',
  tue: 'Ter',
  wed: 'Qua',
  thu: 'Qui',
  fri: 'Sex',
  sat: 'Sáb',
  sun: 'Dom',
}

export const EXCEPTION_KIND_LABELS: Record<ScheduleExceptionKind, string> = {
  vacation: 'Férias',
  sick: 'Atestado',
  training: 'Treinamento',
  holiday: 'Feriado',
  other: 'Outro',
}

export const EXCEPTION_KIND_BADGE_CLASS: Record<
  ScheduleExceptionKind,
  string
> = {
  vacation: 'bg-info/15 text-info',
  sick: 'bg-error/15 text-error',
  training: 'bg-tertiary text-tertiary-foreground',
  holiday: 'bg-success/15 text-success',
  other: 'bg-muted text-muted-foreground',
}

// 'HH:MM:SS' (Postgres TIME) ou 'HH:MM' → 'HH:MM' pra display.
export function formatTime(time: string): string {
  return time.slice(0, 5)
}

// 'YYYY-MM-DD' → 'DD/MM/YYYY' (sem timezone shift).
export function formatIsoDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

// ISO datetime → 'DD/MM HH:MM' (formato compacto pra listas de exceções).
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${day}/${month} ${hours}:${minutes}`
}
