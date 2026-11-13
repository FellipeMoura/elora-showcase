import * as React from 'react'
import { TextField, type TextFieldProps } from './TextField'

// UsernameInput — campo de digitação de username com filtragem em tempo real.
//
// Regras de formato: só aceita `[a-z0-9_]`. Espaço, letras maiúsculas e
// caracteres especiais são rejeitados a cada keystroke. Decisão intencional:
// **converter maiúsculas para minúsculas em vez de simplesmente removê-las**.
// Digita "Maria.Silva" → vira "mariasilva". Menos frustrante que "MariaSilva"
// virar "arialva". O underscore é permitido porque o backfill da migration
// 0042 (adoção de username) usa `_` como sufixo em conflitos (`base_2`,
// `base_3`), então já existem usernames válidos com underscore no DB.
//
// Composto sobre TextField pra herdar floating-label + error + helperText +
// pattern do design system. NÃO wrappar o primitivo `<Input>` cru — os forms
// que consomem esse campo (LoginForm, UserFormSheet) usam TextField.
//
// Ref forwarding preservado pra que `{...register('username')}` do React
// Hook Form continue funcionando: register injeta ref + onChange + onBlur +
// name; interceptamos o onChange pra filtrar antes de repassar, o resto
// desce intacto via spread.

const FILTER_REGEX = /[^a-z0-9_]/g

function normalizeUsername(raw: string): string {
  return raw.toLowerCase().replace(FILTER_REGEX, '')
}

type UsernameInputProps = Omit<TextFieldProps, 'type'>

const UsernameInput = React.forwardRef<HTMLInputElement, UsernameInputProps>(
  ({ onChange, onPaste, autoComplete, ...props }, ref) => {
    return (
      <TextField
        ref={ref}
        type="text"
        autoComplete={autoComplete ?? 'username'}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(e) => {
          const raw = e.target.value
          const filtered = normalizeUsername(raw)
          if (filtered !== raw) {
            // Reescreve o valor no target antes de chamar o onChange
            // recebido — garante que o React Hook Form armazene o valor
            // filtrado (e não o cru digitado). Cursor pode "pular" quando
            // o filtro remove caracteres do meio, mas o caso comum é
            // digitação no fim, onde não há salto perceptível.
            e.target.value = filtered
          }
          onChange?.(e)
        }}
        onPaste={(e) => {
          // O onChange já é disparado após o paste com o value final, então
          // a normalização acima cobre o caso. Mantemos o handler pra
          // repassar o evento a callers que queiram observar (raro).
          onPaste?.(e)
        }}
        {...props}
      />
    )
  },
)
UsernameInput.displayName = 'UsernameInput'

export { UsernameInput, normalizeUsername }
export type { UsernameInputProps }
