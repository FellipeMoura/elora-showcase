import * as React from 'react'

// Contexto único de tema do app. Toda mudança de modo passa por aqui;
// componentes só leem via `useTheme()`. Garante coerência:
// - 1 fonte de verdade (não dá pra um componente discordar de outro);
// - persistência consistente (localStorage);
// - reação a mudança de `prefers-color-scheme` quando o modo é "system";
// - SSR/hydration safe (lê localStorage só no client).

export type ThemeMode = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeContextValue {
  mode: ThemeMode
  resolved: ResolvedTheme
  setMode: (mode: ThemeMode) => void
  toggle: () => void
}

const STORAGE_KEY = 'elora_theme'

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === 'system' ? getSystemTheme() : mode
}

function applyThemeClass(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

interface ThemeProviderProps {
  children: React.ReactNode
  defaultMode?: ThemeMode
}

export function ThemeProvider({
  children,
  defaultMode = 'system',
}: ThemeProviderProps): React.ReactElement {
  // Estado inicial — lê localStorage no primeiro render do client.
  const [mode, setModeState] = React.useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return defaultMode
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      return stored
    }
    return defaultMode
  })

  const [resolved, setResolved] = React.useState<ResolvedTheme>(() =>
    resolveTheme(mode),
  )

  // Quando o mode muda, aplica classe na <html> + persiste.
  React.useEffect(() => {
    const next = resolveTheme(mode)
    setResolved(next)
    applyThemeClass(next)
    window.localStorage.setItem(STORAGE_KEY, mode)
  }, [mode])

  // Quando o mode é "system", escuta mudanças de prefers-color-scheme.
  React.useEffect(() => {
    if (mode !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent): void => {
      const next: ResolvedTheme = e.matches ? 'dark' : 'light'
      setResolved(next)
      applyThemeClass(next)
    }
    media.addEventListener('change', handler)
    return () => media.removeEventListener('change', handler)
  }, [mode])

  const setMode = React.useCallback((next: ThemeMode): void => {
    setModeState(next)
  }, [])

  // toggle alterna entre light/dark explícitos — sai do "system" no primeiro toque.
  const toggle = React.useCallback((): void => {
    setModeState((current) => {
      const currentResolved = resolveTheme(current)
      return currentResolved === 'dark' ? 'light' : 'dark'
    })
  }, [])

  const value = React.useMemo<ThemeContextValue>(
    () => ({ mode, resolved, setMode, toggle }),
    [mode, resolved, setMode, toggle],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme deve ser usado dentro de <ThemeProvider>')
  }
  return ctx
}
