import { useEffect, useState } from 'react'

// Atrasa atualização de `value` em `delayMs` — usado em input de busca pra
// evitar uma request por keystroke. Padrão React: snapshot do valor em
// effect com cleanup que limpa o timeout em mudança rápida.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
