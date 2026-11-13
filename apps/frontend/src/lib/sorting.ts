import * as React from 'react'

// =====================================================================
// Sorting helpers — espelho frontend do helper backend
// (apps/core/src/shared/sorting/buildSort.ts).
//
// Contrato com o backend: ?sortBy=<field>&sortDir=asc|desc, ambos
// opcionais. Sem nada = backend aplica o default declarado na spec.
//
// Cycle do toggle (tri-state, padrão Linear/Notion):
//   campo X "novo"   → asc no X
//   campo X asc      → desc no X
//   campo X desc     → limpa (volta ao default do servidor)
//   campo Y          → asc no Y (reset)
// =====================================================================

export type SortDir = 'asc' | 'desc'

export interface SortState<F extends string> {
  sortBy: F | null
  sortDir: SortDir | null
}

// Estado vazio que satisfaz o tipo. Usado como default do hook quando
// o caller não passa um initial.
function emptyState<F extends string>(): SortState<F> {
  return { sortBy: null, sortDir: null }
}

// Hook genérico. Type param `F` deve ser a union literal dos campos
// sortáveis (ex: 'name' | 'createdAt' | ...). Garante que `toggleSort`
// só aceite campos válidos pra esse endpoint.
export function useSortState<F extends string>(
  initial?: SortState<F>,
): {
  state: SortState<F>
  toggleSort: (field: F) => void
  reset: () => void
  /**
   * Retorna o par {sortBy, sortDir} pra spread no query da API. Quando
   * o estado é vazio, retorna `{}` — backend aplica o default.
   */
  toQueryParams: () => Partial<{ sortBy: F; sortDir: SortDir }>
} {
  const [state, setState] = React.useState<SortState<F>>(
    initial ?? emptyState<F>(),
  )

  const toggleSort = React.useCallback((field: F) => {
    setState((prev) => {
      if (prev.sortBy !== field) return { sortBy: field, sortDir: 'asc' }
      if (prev.sortDir === 'asc') return { sortBy: field, sortDir: 'desc' }
      return emptyState<F>()
    })
  }, [])

  const reset = React.useCallback(() => setState(emptyState<F>()), [])

  const toQueryParams = React.useCallback((): Partial<{
    sortBy: F
    sortDir: SortDir
  }> => {
    if (!state.sortBy || !state.sortDir) return {}
    return { sortBy: state.sortBy, sortDir: state.sortDir }
  }, [state])

  return { state, toggleSort, reset, toQueryParams }
}
