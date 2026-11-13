import * as React from 'react'
import { cn } from '@/lib/utils'

// TextField estilo MUI outlined: label flutua sobre a borda quando o input
// tem foco OU já tem valor; volta pra dentro quando vazio e sem foco.
// A detecção do "vazio" é via CSS puro (`peer-placeholder-shown`) — pra
// isso o input recebe placeholder=' ' por default. Se o consumidor passar
// um placeholder próprio, ele substitui o space e a animação segue
// funcionando (o "placeholder shown" reflete o vazio do valor, não o
// conteúdo do atributo).

interface TextFieldProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: string
  error?: string | null
  helperText?: string
  required?: boolean
  id?: string
  containerClassName?: string
}

const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  (
    {
      label,
      error,
      helperText,
      required,
      id,
      containerClassName,
      className,
      placeholder,
      disabled,
      ...inputProps
    },
    ref,
  ) => {
    const generatedId = React.useId()
    const inputId = id ?? generatedId
    const helperId = `${inputId}-helper`
    const errorId = `${inputId}-error`
    const hasError = Boolean(error)
    const describedBy = hasError ? errorId : helperText ? helperId : undefined

    // `:placeholder-shown` precisa de placeholder não-vazio pra refletir
    // o estado do VALOR. Se o consumidor não passou placeholder, usamos
    // um espaço — invisível, mas faz o CSS funcionar. Se passou um real,
    // o placeholder fica visível só quando o input está focado (label
    // sobe e libera o lugar).
    const effectivePlaceholder = placeholder ?? ' '
    const hasRealPlaceholder = Boolean(placeholder)

    return (
      <div className={cn('flex flex-col gap-1.5', containerClassName)}>
        <div className="relative">
          <input
            id={inputId}
            ref={ref}
            placeholder={effectivePlaceholder}
            required={required}
            disabled={disabled}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            className={cn(
              'peer h-12 w-full rounded-md border border-input bg-transparent px-3 pt-3 pb-1 text-sm',
              // Esconde o placeholder enquanto a label está embutida
              // (vazio sem foco) — evita sobreposição visual. Aparece
              // quando focado, junto com a label que subiu.
              'placeholder:text-transparent focus:placeholder:text-muted-foreground',
              !hasRealPlaceholder && 'focus:placeholder:text-transparent',
              'transition-colors',
              'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary',
              'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
              'disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
            {...inputProps}
          />
          <label
            htmlFor={inputId}
            className={cn(
              // Estado padrão = FLUTUANTE (label no topo, embutida na borda).
              'pointer-events-none absolute left-2 -top-2 z-10 bg-background px-1 text-xs text-foreground transition-all',
              // Cor flutuante quando há erro.
              hasError && 'text-destructive',
              // VAZIO + SEM foco → desce pro centro, fica tamanho do input.
              'peer-placeholder-shown:left-3 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-sm peer-placeholder-shown:text-muted-foreground peer-placeholder-shown:bg-transparent',
              // FOCO → volta pro topo (mesmo se vazio), cor primary.
              'peer-focus:left-2 peer-focus:top-0 peer-focus:-translate-y-1/2 peer-focus:text-xs peer-focus:bg-background',
              hasError
                ? 'peer-focus:text-destructive'
                : 'peer-focus:text-primary',
              // Disabled propaga atenuação.
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
TextField.displayName = 'TextField'

export { TextField }
export type { TextFieldProps }
