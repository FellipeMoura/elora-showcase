import * as React from 'react'
import { cn } from '@/lib/utils'

// TextArea multi-linha com o mesmo esquema de label flutuante do
// `TextField` outlined. Estado default = label FLUTUANDO na borda
// superior; quando vazio e sem foco a label desce pra dentro no
// top-inside (não vertical-center como no TextField, porque a textarea
// é alta demais pra isso fazer sentido). CSS puro via
// `peer-placeholder-shown` — `placeholder=' '` por default pra ativar
// o pseudo-classe sem placeholder visível.
//
// `resize-y` por default — usuário estica verticalmente; horizontal
// travado pra preservar o layout da página.

interface TextAreaProps
  extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: string
  error?: string | null
  helperText?: string
  required?: boolean
  id?: string
  containerClassName?: string
}

const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(
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
      rows = 5,
      ...textAreaProps
    },
    ref,
  ) => {
    const generatedId = React.useId()
    const inputId = id ?? generatedId
    const helperId = `${inputId}-helper`
    const errorId = `${inputId}-error`
    const hasError = Boolean(error)
    const describedBy = hasError ? errorId : helperText ? helperId : undefined

    const effectivePlaceholder = placeholder ?? ' '
    const hasRealPlaceholder = Boolean(placeholder)

    return (
      <div className={cn('flex flex-col gap-1.5', containerClassName)}>
        <div className="relative">
          <textarea
            id={inputId}
            ref={ref}
            placeholder={effectivePlaceholder}
            required={required}
            disabled={disabled}
            rows={rows}
            aria-invalid={hasError || undefined}
            aria-describedby={describedBy}
            className={cn(
              'peer w-full resize-y rounded-md border border-input bg-transparent px-3 pt-4 pb-2 text-sm',
              // Placeholder invisível enquanto label está embutida —
              // aparece só quando focado (label subiu pra borda).
              'placeholder:text-transparent focus:placeholder:text-muted-foreground',
              !hasRealPlaceholder && 'focus:placeholder:text-transparent',
              'transition-colors',
              'focus-visible:outline-none focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary',
              'aria-invalid:border-destructive aria-invalid:focus-visible:ring-destructive',
              'disabled:cursor-not-allowed disabled:opacity-50',
              className,
            )}
            {...textAreaProps}
          />
          <label
            htmlFor={inputId}
            className={cn(
              // Default = FLUTUANTE (label sobre a borda superior).
              'pointer-events-none absolute left-2 -top-2 z-10 bg-background px-1 text-xs text-foreground transition-all',
              hasError && 'text-destructive',
              // VAZIO + SEM foco → desce pro top-inside (não center;
              // textarea é alta).
              'peer-placeholder-shown:left-3 peer-placeholder-shown:top-3 peer-placeholder-shown:text-sm peer-placeholder-shown:text-muted-foreground peer-placeholder-shown:bg-transparent',
              // FOCO → volta pra borda superior, cor primary.
              'peer-focus:left-2 peer-focus:-top-2 peer-focus:text-xs peer-focus:bg-background',
              hasError
                ? 'peer-focus:text-destructive'
                : 'peer-focus:text-primary',
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
TextArea.displayName = 'TextArea'

export { TextArea }
export type { TextAreaProps }
