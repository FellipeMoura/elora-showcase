import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DeltaStatus } from './leadsSummaryHelpers'

interface ComparisonCellProps {
  value: string // já formatado pelo caller
  status: DeltaStatus
  direction: 'above' | 'within' | 'below'
  // Mostrado em tooltip-like (subtítulo) quando relevante.
  hint?: string
  align?: 'left' | 'right' | 'center'
  className?: string
}

const STATUS_CLASS: Record<DeltaStatus, string> = {
  success: 'text-success',
  primary: 'text-primary',
  error: 'text-error',
}

// Célula numérica com indicador visual de comparação vs média.
// Direção (above/within/below) controla qual seta; status controla a cor.
// Cor desacoplada da seta porque pra métricas invertidas (ex: tempo de
// resposta), `above` ainda mostra ArrowUp mas a cor vira `error`.
export function ComparisonCell({
  value,
  status,
  direction,
  hint,
  align = 'right',
  className,
}: ComparisonCellProps): React.ReactElement {
  const Icon =
    direction === 'above' ? ArrowUp : direction === 'below' ? ArrowDown : ArrowRight

  return (
    <div
      className={cn(
        'flex items-center gap-1 font-medium tabular-nums',
        STATUS_CLASS[status],
        align === 'right' && 'justify-end',
        align === 'center' && 'justify-center',
        align === 'left' && 'justify-start',
        className,
      )}
      title={hint}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span>{value}</span>
    </div>
  )
}

// Variante "sem comparação" — usada em colunas que o user pediu pra não
// comparar (ex: Pendentes %). Mantém alinhamento numérico e formato sem
// seta nem cor de status.
export function PlainNumericCell({
  value,
  align = 'right',
  className,
}: {
  value: string
  align?: 'left' | 'right' | 'center'
  className?: string
}): React.ReactElement {
  return (
    <div
      className={cn(
        'tabular-nums',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center',
        align === 'left' && 'text-left',
        className,
      )}
    >
      {value}
    </div>
  )
}
