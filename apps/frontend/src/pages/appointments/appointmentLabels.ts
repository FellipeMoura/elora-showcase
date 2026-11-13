import type {
  AppointmentKind,
  AppointmentStatus,
  EvaluationKind,
} from '@/api/appointments'

export const APPOINTMENT_KIND_LABELS: Record<AppointmentKind, string> = {
  evaluation: 'Avaliação',
  procedure: 'Procedimento',
}

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  attended: 'Atendido',
  no_show: 'Não compareceu',
  cancelled: 'Cancelado',
}

export const APPOINTMENT_STATUS_BADGE_CLASS: Record<
  AppointmentStatus,
  string
> = {
  scheduled: 'bg-info/15 text-info',
  confirmed: 'bg-primary/15 text-primary',
  attended: 'bg-success/15 text-success',
  no_show: 'bg-warning/15 text-warning',
  cancelled: 'bg-error/15 text-error',
}

export const APPOINTMENT_KIND_BADGE_CLASS: Record<AppointmentKind, string> = {
  evaluation: 'bg-primary/15 text-primary',
  procedure: 'bg-tertiary text-tertiary-foreground',
}

export const EVALUATION_KIND_LABELS: Record<EvaluationKind, string> = {
  initial: 'Inicial',
  reevaluation: 'Reavaliação',
  return: 'Retorno',
}

// ISO datetime → 'DD/MM HH:MM' compacto (mesmo formato usado em
// availabilityLabels — duplicado pra evitar cross-module import).
export function formatAppointmentDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ISO datetime → datetime-local input value ('YYYY-MM-DDTHH:MM').
export function toLocalDatetimeInput(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// datetime-local string → ISO pra mandar ao backend.
export function localDatetimeToIso(local: string): string {
  return new Date(local).toISOString()
}
