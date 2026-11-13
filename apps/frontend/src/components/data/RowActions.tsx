import * as React from 'react'
import { MoreVertical } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// =====================================================================
// RowActions — botões de ação inline pra cada linha de tabela.
//
// Regra de colapso: até `maxInline` ações (default 2) renderiza ícones
// soltos. A partir disso, agrupa TUDO num popover único disparado pelo
// ícone "MoreVertical" — evita header/coluna vazando com 3+ ícones.
//
// Cada ação declara `label` (texto = tooltip + aria-label) + `icon`
// (componente lucide). `destructive` pinta o ícone em --error pro hover.
//
// Tooltip funciona porque <TooltipProvider> está no App.tsx (raiz).
// =====================================================================

export interface RowAction {
  /** Texto do tooltip + aria-label. Obrigatório (acessibilidade). */
  label: string
  icon: React.ReactNode
  onClick: () => void
  disabled?: boolean
  /** Aplica cor de erro no ícone + hover. Default: false. */
  destructive?: boolean
}

interface RowActionsProps {
  actions: RowAction[]
  /** Quantas ações cabem inline antes de colapsar pro popover. Default 2. */
  maxInline?: number
  className?: string
}

export function RowActions({
  actions,
  maxInline = 3,
  className,
}: RowActionsProps): React.ReactElement | null {
  if (actions.length === 0) return null

  const shouldCollapse = actions.length > maxInline

  if (shouldCollapse) {
    return (
      <div className={cn('flex items-center', className)}>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Mais ações"
              className="size-8"
            >
              <MoreVertical />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-48 p-1">
            {actions.map((action, i) => (
              <button
                key={i}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                  'transition-colors hover:bg-accent hover:text-accent-foreground',
                  'focus-visible:bg-accent focus-visible:outline-none',
                  'disabled:pointer-events-none disabled:opacity-50',
                  action.destructive && 'text-error hover:bg-error/10 hover:text-error',
                )}
              >
                <span className="[&_svg]:size-4 [&_svg]:shrink-0">
                  {action.icon}
                </span>
                {action.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>
    )
  }

  return (
    <div className={cn('flex items-center gap-0.5', className)}>
      {actions.map((action, i) => (
        <InlineAction key={i} action={action} />
      ))}
    </div>
  )
}

function InlineAction({
  action,
}: {
  action: RowAction
}): React.ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          onClick={action.onClick}
          disabled={action.disabled}
          aria-label={action.label}
          className={cn(
            'size-8',
            action.destructive &&
              'text-muted-foreground hover:bg-error/10 hover:text-error',
          )}
        >
          {action.icon}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{action.label}</TooltipContent>
    </Tooltip>
  )
}

// Tamanho `icon-sm` reaproveitável: precisa override do size do Button
// (h-10 w-10 default) — `size-8` em className cobre. Não criamos size
// novo no CVA pra não inchar a API do Button.
export type RowActionsButtonSize = NonNullable<ButtonProps['size']>
