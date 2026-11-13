import * as React from 'react'

// Breakpoints alinhados com os defaults do Tailwind v4. Mantemos como
// fonte única de verdade pra JS-side decisions (ex: variantes de Drawer,
// densidade de tabela, virtualização condicional). Pra estilização
// pura, use as classes responsive do Tailwind direto (md:flex, lg:grid).

export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const

export type Breakpoint = keyof typeof BREAKPOINTS

function makeQuery(bp: Breakpoint): string {
  return `(min-width: ${BREAKPOINTS[bp]}px)`
}

// Retorna true quando a viewport atinge o breakpoint informado (mobile-first).
// useBreakpoint('md') === true → tela >= 768px.
export function useBreakpoint(bp: Breakpoint): boolean {
  const query = makeQuery(bp)

  // useSyncExternalStore evita race em hydration + cobre todos os listeners
  // automaticamente. Disponível em React 18+.
  const subscribe = React.useCallback(
    (callback: () => void) => {
      const media = window.matchMedia(query)
      media.addEventListener('change', callback)
      return () => media.removeEventListener('change', callback)
    },
    [query],
  )

  const getSnapshot = React.useCallback(
    () => window.matchMedia(query).matches,
    [query],
  )

  // Snapshot do server side render: assume false (mobile-first). Cliente
  // re-renderiza no primeiro paint com o valor real.
  const getServerSnapshot = React.useCallback(() => false, [])

  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

// Retorna o maior breakpoint ativo da viewport atual ('sm' | 'md' | 'lg' |
// 'xl' | '2xl' | null se < sm). Útil quando a decisão depende do nível
// atual, não de um threshold único.
export function useCurrentBreakpoint(): Breakpoint | null {
  const sm = useBreakpoint('sm')
  const md = useBreakpoint('md')
  const lg = useBreakpoint('lg')
  const xl = useBreakpoint('xl')
  const xxl = useBreakpoint('2xl')

  if (xxl) return '2xl'
  if (xl) return 'xl'
  if (lg) return 'lg'
  if (md) return 'md'
  if (sm) return 'sm'
  return null
}
