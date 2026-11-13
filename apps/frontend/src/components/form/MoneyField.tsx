import * as React from 'react'
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { TextField, type TextFieldProps } from './TextField'

// MoneyField — input de valor monetário com entrada em centavos.
//
// UX: o usuário só digita dígitos. Cada keystroke remapeia "dígitos →
// centavos → reais → display formatado". Digita "200" → grava 2.00 no
// form, exibe "R$ 2,00". Sem ambiguidade de vírgula/ponto/milhar — não
// dá pra digitar "errado". Equivalente ao VCash de outro projeto, sem
// MUI/InputAdornment (o "R$ " é parte do value renderizado).
//
// Estado do form = number decimal em reais (1234.56). Backend (Drizzle
// `decimal`) já espera number — sem conversão extra no submit.
//
// TODO input de valor monetário usa este componente — nunca
// `<TextField type="number">` (o lint de `pages/**` bloqueia). Dois modos
// de ligação:
//   - react-hook-form: `control` + `name` (padrão dos forms).
//   - controlado: `value` + `onValueChange`, pra telas com `useState`
//     (linha de tabela, dialog pequeno). `value` aceita number ou a string
//     decimal da API ("12.50"); o consumer que guarda string converte no
//     callback: `onValueChange={(v) => setPrice(v.toFixed(2))}`.

// Ligado a react-hook-form.
type MoneyFieldRhfBinding<T extends FieldValues> = {
  control: Control<T>
  name: FieldPath<T>
  value?: undefined
  // Notifica o consumer quando o valor numérico muda (já em reais).
  onValueChange?: (value: number) => void
}

// Controlado pelo consumer (sem react-hook-form).
type MoneyFieldControlledBinding = {
  control?: undefined
  name?: undefined
  // Reais — number ou string decimal da API. Vazio/null = 0.
  value: number | string | null | undefined
  onValueChange: (value: number) => void
}

type MoneyFieldBaseProps<T extends FieldValues> = (
  | MoneyFieldRhfBinding<T>
  | MoneyFieldControlledBinding
) & {
  // Limite superior em reais. Excedeu → erro inline.
  max?: number
}

// Standard: renderiza floating-label TextField com helper/erro embaixo.
// Use em forms verticais. Aceita todas as props do TextField (label, etc).
type MoneyFieldStandardProps<T extends FieldValues> = MoneyFieldBaseProps<T> &
  Omit<
    TextFieldProps,
    | 'value'
    | 'onChange'
    | 'onBlur'
    | 'name'
    | 'defaultValue'
    | 'inputMode'
    | 'type'
    | 'ref'
  > & {
    compact?: false
  }

// Compact: renderiza Input shadcn cru, sem floating-label nem wrapper de
// helper. Use em linhas de tabela onde cada coluna é um input plano. O
// caller deve passar `aria-label` (ou um `<label>` externo) — não há
// label visível. `className` aplica direto no Input.
type MoneyFieldCompactProps<T extends FieldValues> = MoneyFieldBaseProps<T> & {
  compact: true
  'aria-label'?: string
  className?: string
  disabled?: boolean
  // Marca erro visual quando o caller já validou em outro lugar (ex.
  // cross-field). Soma com fieldState.error e overflow de max.
  error?: boolean
  // Edição inline (célula que vira input): foco programático e atalhos
  // de teclado (Enter salva / Esc cancela) ficam com o caller.
  inputRef?: React.Ref<HTMLInputElement>
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>
}

type MoneyFieldProps<T extends FieldValues> =
  | MoneyFieldStandardProps<T>
  | MoneyFieldCompactProps<T>

const formatCentsToBrl = (cents: number): string => {
  const safe = Math.max(0, Math.floor(cents))
  const integer = Math.floor(safe / 100)
  const decimal = (safe % 100).toString().padStart(2, '0')
  // 1234 → "1.234", 100 → "100". Separador BR de milhar.
  const integerStr = integer.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${integerStr},${decimal}`
}

// Cap de dígitos = R$ 9.999.999.999,99 — proteção contra paste de
// string enorme. Acima desse teto a aritmética em JS já vira problemática.
const MAX_DIGITS = 12

// O que o modo de ligação entrega pro render — o resto é igual nos dois.
interface MoneyBinding {
  value: unknown
  onChange: (value: number) => void
  onBlur?: () => void
  ref?: React.Ref<HTMLInputElement>
  fieldError?: string
}

export function MoneyField<T extends FieldValues = FieldValues>(
  props: MoneyFieldProps<T>,
): React.ReactElement {
  if (props.control !== undefined) {
    const { control, name, onValueChange } = props
    return (
      <Controller
        control={control}
        name={name}
        render={({ field, fieldState }) =>
          renderMoneyField(props, {
            value: field.value,
            onChange: (value) => {
              field.onChange(value)
              onValueChange?.(value)
            },
            onBlur: field.onBlur,
            ref: field.ref,
            fieldError: fieldState.error?.message,
          })
        }
      />
    )
  }
  return renderMoneyField(props, {
    value: props.value,
    onChange: props.onValueChange,
  })
}

function renderMoneyField<T extends FieldValues>(
  props: MoneyFieldProps<T>,
  binding: MoneyBinding,
): React.ReactElement {
  const { max } = props
  const numericValue =
    typeof binding.value === 'number'
      ? binding.value
      : Number(binding.value) || 0
  const cents = Math.round(numericValue * 100)
  const display = `R$ ${formatCentsToBrl(cents)}`

  const hasMaxError = max !== undefined && numericValue > max
  const maxMessage =
    hasMaxError && max !== undefined
      ? `Máximo: R$ ${formatCentsToBrl(Math.round(max * 100))}`
      : null

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digits = e.target.value.replace(/\D/g, '').slice(0, MAX_DIGITS)
    const newCents = digits ? parseInt(digits, 10) : 0
    binding.onChange(newCents / 100)
  }

  if (props.compact) {
    const externalError = props.error ?? false
    const hasError = Boolean(binding.fieldError) || hasMaxError || externalError
    return (
      <Input
        ref={props.inputRef ?? binding.ref}
        value={display}
        onChange={handleChange}
        onBlur={binding.onBlur}
        onKeyDown={props.onKeyDown}
        inputMode="numeric"
        autoComplete="off"
        aria-label={props['aria-label']}
        aria-invalid={hasError || undefined}
        disabled={props.disabled}
        className={cn(
          'tabular-nums',
          hasError && 'border-error',
          props.className,
        )}
      />
    )
  }

  const {
    // Props consumidas pelo MoneyField — não repassar pra TextField.
    compact: _compact,
    control: _c,
    name: _n,
    value: _v,
    max: _m,
    onValueChange: _ov,
    error,
    helperText,
    ...rest
  } = props
  void _compact
  void _c
  void _n
  void _v
  void _m
  void _ov
  const combinedError = error ?? binding.fieldError ?? maxMessage ?? null
  return (
    <TextField
      {...rest}
      value={display}
      onChange={handleChange}
      onBlur={binding.onBlur}
      ref={binding.ref}
      inputMode="numeric"
      autoComplete="off"
      error={combinedError}
      helperText={helperText}
    />
  )
}
