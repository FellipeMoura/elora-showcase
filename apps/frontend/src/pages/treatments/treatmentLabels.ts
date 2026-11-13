import type { TreatmentStatus } from '@/api/treatments'

export const TREATMENT_STATUS_LABELS: Record<TreatmentStatus, string> = {
  active: 'Ativo',
  completed: 'Concluído',
  abandoned: 'Abandonado',
  manually_closed: 'Fechado manualmente',
}

export const TREATMENT_STATUS_BADGE_CLASS: Record<TreatmentStatus, string> = {
  active: 'bg-info/15 text-info',
  completed: 'bg-success/15 text-success',
  abandoned: 'bg-error/15 text-error',
  manually_closed: 'bg-muted text-muted-foreground',
}
