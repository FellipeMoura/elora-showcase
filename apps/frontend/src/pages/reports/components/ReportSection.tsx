import { ChevronDown } from 'lucide-react'
import { useId, useState } from 'react'
import { cn } from '@/lib/utils'

// Accordion section pra agrupar blocos do relatório. Usa <details>/<summary>
// HTML nativo pra acessibilidade gratuita (Enter/Space, aria-expanded). State
// local controlado pra animar o chevron + classe `data-state` opcional.
//
// No print, força aberto (via CSS @media print) pra TODAS as seções
// aparecerem no PDF — comportamento esperado de "exportar tudo".

interface ReportSectionProps {
  title: string
  defaultOpen?: boolean
  // Quando setado, suprime a indicação visual de quantidade (subtitle).
  subtitle?: string | null
  children: React.ReactNode
}

export function ReportSection({
  title,
  defaultOpen = false,
  subtitle,
  children,
}: ReportSectionProps): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  const headerId = useId()

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      data-report-section
      // print: sempre aberto pra renderizar tudo no PDF
      className="group rounded-md border bg-card print:break-inside-avoid"
    >
      <summary
        id={headerId}
        className={cn(
          'flex cursor-pointer select-none items-center justify-between gap-2 px-4 py-3',
          'transition-colors hover:bg-accent/30',
          'list-none [&::-webkit-details-marker]:hidden',
          'print:cursor-default print:hover:bg-transparent',
        )}
      >
        <div className="flex flex-col">
          <span className="text-sm font-semibold uppercase tracking-wide">
            {title}
          </span>
          {subtitle && (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          )}
        </div>
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 text-muted-foreground transition-transform',
            'group-open:rotate-180',
            'print:hidden',
          )}
        />
      </summary>
      <div className="border-t p-4">{children}</div>
    </details>
  )
}
