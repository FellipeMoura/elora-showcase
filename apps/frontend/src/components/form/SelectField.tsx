import * as React from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

// SelectField estilo MUI outlined — espelha o TextField. Label sempre na
// posição "flutuante" (notch na borda superior), porque Select nunca fica
// realmente vazio como um input (sempre exibe valor selecionado ou o
// placeholder do SelectValue). Por isso não temos animação `placeholder-
// shown → focused` como o TextField — label fica fixa na notch.
//
// Consumidor passa os `<SelectItem>` como children; o wrapper cuida do
// Select/SelectTrigger/SelectContent/SelectValue por dentro. `SelectItem`
// (e `SelectGroup`/`SelectLabel` pra listas agrupadas) são re-exportados
// daqui pra página não precisar importar `ui/select` direto (o lint
// bloqueia esse import em `pages/**`).

interface SelectFieldProps {
  label: string
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  required?: boolean
  error?: string | null
  helperText?: string
  id?: string
  triggerClassName?: string
  containerClassName?: string
  children: React.ReactNode
}

const SelectField = React.forwardRef<HTMLButtonElement, SelectFieldProps>(
  (
    {
      label,
      value,
      defaultValue,
      onValueChange,
      placeholder,
      disabled,
      required,
      error,
      helperText,
      id,
      triggerClassName,
      containerClassName,
      children,
    },
    ref,
  ) => {
    const generatedId = React.useId()
    const triggerId = id ?? generatedId
    const helperId = `${triggerId}-helper`
    const errorId = `${triggerId}-error`
    const hasError = Boolean(error)
    const describedBy = hasError ? errorId : helperText ? helperId : undefined

    return (
      <div className={cn('flex flex-col gap-1.5', containerClassName)}>
        <div className="relative">
          <Select
            value={value}
            defaultValue={defaultValue}
            onValueChange={onValueChange}
            disabled={disabled}
          >
            <SelectTrigger
              ref={ref}
              id={triggerId}
              aria-invalid={hasError || undefined}
              aria-describedby={describedBy}
              className={cn(
                'peer h-12 bg-transparent transition-colors',
                'focus:border-primary focus:ring-1 focus:ring-inset focus:ring-primary',
                'data-[state=open]:border-primary data-[state=open]:ring-1 data-[state=open]:ring-inset data-[state=open]:ring-primary',
                'aria-invalid:border-destructive aria-invalid:focus:ring-destructive',
                triggerClassName,
              )}
            >
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>{children}</SelectContent>
          </Select>
          <label
            htmlFor={triggerId}
            className={cn(
              // Label fixa na notch — pattern outlined do TextField (estado
              // flutuante), sem animação de descida porque Select sempre
              // exibe algo.
              'pointer-events-none absolute left-2 -top-2 z-10 bg-background px-1 text-xs text-foreground transition-colors',
              hasError && 'text-destructive',
              hasError
                ? 'peer-focus:text-destructive peer-data-[state=open]:text-destructive'
                : 'peer-focus:text-primary peer-data-[state=open]:text-primary',
              'peer-disabled:opacity-50',
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
  },
)
SelectField.displayName = 'SelectField'

export { SelectField, SelectGroup, SelectItem, SelectLabel }
export type { SelectFieldProps }
