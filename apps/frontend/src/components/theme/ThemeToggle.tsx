import { Moon, Sun, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme, type ThemeMode } from './ThemeProvider'
import { cn } from '@/lib/utils'

// Botão segmentado: light / system / dark. Estado é controlado pelo contexto.
// "system" segue prefers-color-scheme do SO e reage a mudanças em tempo real.

const OPTIONS: { value: ThemeMode; label: string; icon: React.ElementType }[] = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'system', label: 'Sistema', icon: Monitor },
  { value: 'dark', label: 'Escuro', icon: Moon },
]

export function ThemeToggle(): React.ReactElement {
  const { mode, setMode } = useTheme()

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="inline-flex items-center gap-0.5 rounded-md border border-input bg-background p-0.5"
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => {
        const active = mode === value
        return (
          <Button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            variant="ghost"
            size="sm"
            onClick={() => setMode(value)}
            className={cn(
              'h-7 px-2 text-xs',
              active && 'bg-accent text-accent-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span className="sr-only md:not-sr-only">{label}</span>
          </Button>
        )
      })}
    </div>
  )
}
