import * as React from 'react'
import {
  Controller,
  type Control,
  type FieldPath,
  type FieldValues,
} from 'react-hook-form'
import { TextField, type TextFieldProps } from './TextField'
import { formatCep, formatCnpj, formatCpf, onlyDigits } from '@/lib/format'

// Máscaras BR pra documentos. Adicionar novas aqui mantém a API homogênea.
type MaskKind = 'cpf' | 'cnpj' | 'cep'

const MASK_MAX_DIGITS: Record<MaskKind, number> = {
  cpf: 11,
  cnpj: 14,
  cep: 8,
}

function applyMask(digits: string, kind: MaskKind): string {
  if (kind === 'cpf') return formatCpf(digits)
  if (kind === 'cnpj') return formatCnpj(digits)
  return formatCep(digits)
}

// MaskedField mantém no estado do form a string em DÍGITOS apenas (que é o
// que o backend espera), enquanto exibe formatada. Controller é necessário
// porque a transformação precisa rodar a cada keystroke (não dá pra
// delegar pro register).
//
// O valor inicial vindo do backend já é digits-only — formatamos só na
// renderização. Limpa pra null/undefined é responsabilidade do caller no
// onSubmit (transformar string vazia em null).
type MaskedFieldProps<T extends FieldValues> = Omit<
  TextFieldProps,
  'value' | 'onChange' | 'onBlur' | 'name' | 'defaultValue'
> & {
  control: Control<T>
  name: FieldPath<T>
  mask: MaskKind
}

export function MaskedField<T extends FieldValues>({
  control,
  name,
  mask,
  ...rest
}: MaskedFieldProps<T>): React.ReactElement {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => {
        const raw = typeof field.value === 'string' ? field.value : ''
        return (
          <TextField
            {...rest}
            value={applyMask(raw, mask)}
            onChange={(e) => {
              const digits = onlyDigits(e.target.value).slice(
                0,
                MASK_MAX_DIGITS[mask],
              )
              field.onChange(digits)
            }}
            onBlur={field.onBlur}
            ref={field.ref}
            inputMode="numeric"
            autoComplete="off"
          />
        )
      }}
    />
  )
}
