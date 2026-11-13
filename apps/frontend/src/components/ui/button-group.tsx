import * as React from 'react'
import { cn } from '@/lib/utils'

// Grupo de botões mutuamente exclusivos (radio-style). Visualmente similar
// a um segmented control iOS / pill toggle. Genérico no tipo do `value` pra
// aceitar string literal unions sem cast.
//
// Uso típico:
//   <ButtonGroup
//     value={status}
//     onChange={setStatus}
//     options={[
//       { value: 'active', label: 'Ativos' },
//       { value: 'inactive', label: 'Inativos' },
//       { value: 'all', label: 'Todos' },
//     ]}
//   />

export interface ButtonGroupOption<T extends string> {
  value: T
  label: React.ReactNode
  disabled?: boolean
}

export interface ButtonGroupProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<ButtonGroupOption<T>>
  className?: string
  size?: 'sm' | 'md'
  'aria-label'?: string
  // Override visual da classe do botão por opção. Retorne classes Tailwind
  // pra substituir o default (active=primary, idle=muted-foreground/hover-accent).
  // Útil quando uma opção pertence a outro escopo de cor (ex.: tab CHAT em verde).
  optionClassName?: (value: T, isActive: boolean) => string | undefined
}

export function ButtonGroup<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
  'aria-label': ariaLabel,
  optionClassName,
}: ButtonGroupProps<T>): React.ReactElement {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-10 items-center gap-1 rounded-md border border-input bg-background p-1',
        size === 'sm' && 'h-9',
        className,
      )}
    >
      {options.map((opt) => {
        const isActive = opt.value === value
        const override = optionClassName?.(opt.value, isActive)
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center justify-center rounded px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'disabled:pointer-events-none disabled:opacity-50',
              size === 'sm' ? 'h-7' : 'h-8',
              override ??
                (isActive
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'),
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
