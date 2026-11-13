import * as React from 'react'
import { Combobox, type ComboboxOption } from '@/components/ui/combobox'
import { cn } from '@/lib/utils'

// ComboboxField estilo MUI outlined — espelha o SelectField. Label fixa
// na notch da borda superior (sem animação de descida): o Combobox
// sempre mostra algo no input (valor selecionado ou placeholder de
// busca), então não existe o estado "vazio sem foco" do TextField.
//
// Wrapper fino sobre `ui/combobox`: mesma API (value/onChange/options/
// search/onSearchChange…) + label/required/error/helperText do resto do
// kit. Página nunca importa `ui/combobox` direto em form — o lint
// bloqueia. Combobox em filtro de toolbar continua usando o primitivo
// (com justificativa no eslint-disable).

type ComboboxProps = React.ComponentProps<typeof Combobox>

interface ComboboxFieldProps
  extends Omit<
    ComboboxProps,
    'className' | 'aria-label' | 'aria-invalid' | 'aria-describedby'
  > {
  label: string
  required?: boolean
  error?: string | null
  helperText?: string
  containerClassName?: string
  /** Aplicado no anchor (a "borda" do campo). */
  className?: string
}

function ComboboxField({
  label,
  required,
  error,
  helperText,
  id,
  containerClassName,
  className,
  disabled,
  ...comboboxProps
}: ComboboxFieldProps): React.ReactElement {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const helperId = `${inputId}-helper`
  const errorId = `${inputId}-error`
  const hasError = Boolean(error)
  const describedBy = hasError ? errorId : helperText ? helperId : undefined

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      <div className="relative">
        <Combobox
          {...comboboxProps}
          id={inputId}
          disabled={disabled}
          aria-label={label}
          aria-invalid={hasError}
          aria-describedby={describedBy}
          className={cn(
            'peer h-12 bg-transparent transition-colors',
            // Anchor é um div com focus-within (o foco real está no input).
            'focus-within:border-primary focus-within:ring-1 focus-within:ring-inset focus-within:ring-primary',
            hasError &&
              'border-destructive focus-within:border-destructive focus-within:ring-destructive',
            className,
          )}
        />
        <label
          htmlFor={inputId}
          className={cn(
            'pointer-events-none absolute left-2 -top-2 z-10 bg-background px-1 text-xs text-foreground transition-colors',
            hasError
              ? 'text-destructive peer-focus-within:text-destructive'
              : 'peer-focus-within:text-primary',
            disabled && 'opacity-50',
          )}
        >
          {label}
          {required && (
            <span aria-hidden className="ml-0.5 text-destructive">
              *
            </span>
          )}
        </label>
      </div>

      {hasError ? (
        <p id={errorId} className="px-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : helperText ? (
        <p id={helperId} className="px-3 text-xs text-muted-foreground">
          {helperText}
        </p>
      ) : null}
    </div>
  )
}

export { ComboboxField }
export type { ComboboxFieldProps, ComboboxOption }
