import * as React from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SortDir } from '@/lib/sorting'

// =====================================================================
// SortableHeader — célula de cabeçalho de tabela com ordenação clicável.
//
// Substitui um `<th>` cru. Recebe o estado atual de sort (campo +
// direção) e dispara o toggle quando o usuário clica. O cycle (asc →
// desc → limpa) é responsabilidade do `useSortState`, não daqui.
//
// Visual: chevron up/down quando esta coluna está ativa; chevrons-up-down
// translúcido nas demais (afetando densidade visual o mínimo possível).
// =====================================================================

interface SortableHeaderProps<F extends string> {
  field: F
  currentField: F | null
  currentDir: SortDir | null
  onSort: (field: F) => void
  align?: 'left' | 'right'
  className?: string
  children: React.ReactNode
}

export function SortableHeader<F extends string>({
  field,
  currentField,
  currentDir,
  onSort,
  align = 'left',
  className,
  children,
}: SortableHeaderProps<F>): React.ReactElement {
  const isActive = currentField === field && currentDir !== null
  const ariaSort: React.AriaAttributes['aria-sort'] = !isActive
    ? 'none'
    : currentDir === 'asc'
      ? 'ascending'
      : 'descending'

  const Icon = !isActive
    ? ChevronsUpDown
    : currentDir === 'asc'
      ? ChevronUp
      : ChevronDown

  return (
    <th
      aria-sort={ariaSort}
      scope="col"
      className={cn(
        'px-4 py-2.5 font-medium first:sm:pl-6 last:sm:pr-6',
        align === 'right' && 'text-right',
        className,
      )}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'inline-flex select-none items-center gap-1.5 text-xs uppercase',
          'transition-colors hover:text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'rounded-sm',
          align === 'right' && 'ml-auto flex-row-reverse',
          isActive ? 'text-foreground' : 'text-muted-foreground',
        )}
      >
        {children}
        <Icon
          className={cn(
            'size-3.5 transition-opacity',
            isActive ? 'opacity-100' : 'opacity-40',
          )}
          aria-hidden
        />
      </button>
    </th>
  )
}
