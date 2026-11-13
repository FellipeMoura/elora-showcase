import { useState } from 'react'
import { toast } from 'sonner'
import {
  Bell,
  BellOff,
  Circle,
  MessageSquareDot,
  Monitor,
  Moon,
  Palette,
  Sun,
} from 'lucide-react'
import { useTheme, type ThemeMode } from '@/components/theme/ThemeProvider'
import {
  DEFAULT_PREFERENCES,
  useMyPreferences,
  useUpdateMyPreferences,
} from '@/hooks/useMyPreferences'
import type { UserPreferences } from '@/api/me'
import { useMe } from '@/hooks/useMe'
import { PushDeviceSettings } from '@/components/notifications/PushDeviceSettings'
import { cn } from '@/lib/utils'

// Página única de preferências do usuário corrente. Agrupa todas as
// configurações pessoais (não de admin) em seções verticais. Acessada
// via link "user.name" no Header (não tem item de sidebar — preferência
// é pessoal, não navegação do produto).

type ChatLevel = NonNullable<UserPreferences['chatNotificationLevel']>
type CalendarColorMode = NonNullable<UserPreferences['calendarColorMode']>

interface RadioOption<V extends string> {
  value: V
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  /** Pinta um badge "Padrão" — usar na opção que o app assume sem prefs. */
  isDefault?: boolean
}

const THEME_OPTIONS: RadioOption<ThemeMode>[] = [
  {
    value: 'light',
    label: 'Claro',
    description: 'Fundo claro. Boa visibilidade em ambientes iluminados.',
    icon: Sun,
  },
  {
    value: 'system',
    label: 'Sistema',
    description:
      'Segue a preferência do sistema operacional. Acompanha mudanças em tempo real.',
    icon: Monitor,
    isDefault: true,
  },
  {
    value: 'dark',
    label: 'Escuro',
    description: 'Fundo escuro. Reduz fadiga visual à noite.',
    icon: Moon,
  },
]

const CALENDAR_COLOR_OPTIONS: RadioOption<CalendarColorMode>[] = [
  {
    value: 'status',
    label: 'Por status',
    description:
      'Cor do card reflete o status (agendado / confirmado / atendido). Procedimento aparece como ícone no canto do card.',
    icon: Circle,
    isDefault: true,
  },
  {
    value: 'procedure',
    label: 'Por procedimento',
    description:
      'Cor do card reflete o procedimento (cor cadastrada). Status aparece como ícone no canto do card.',
    icon: Palette,
  },
]

const CHAT_OPTIONS: RadioOption<ChatLevel>[] = [
  {
    value: 'quiet',
    label: 'Discreto',
    description: 'Apenas badge no cabeçalho. Sem toast, sem pop-up.',
    icon: BellOff,
  },
  {
    value: 'medium',
    label: 'Médio',
    description:
      'Badge + toast com prévia da mensagem no canto da tela. Padrão.',
    icon: Bell,
    isDefault: true,
  },
  {
    value: 'aggressive',
    label: 'Agressivo',
    description:
      'Badge + toast + abre a conversa automaticamente no pop-up flutuante.',
    icon: MessageSquareDot,
  },
]

export function PreferencesPage(): React.ReactElement {
  const { data: me } = useMe()
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Preferências</h1>
        <p className="text-sm text-muted-foreground">
          Configurações pessoais da sua conta. As mudanças salvam sozinhas.
        </p>
      </header>

      <AppearanceSection />
      <CalendarSection />
      <NotificationsSection />
      {me?.chatEnabled && (
        <PreferenceSection
          title="Notificações neste aparelho"
          description="Aviso do sistema (como o do WhatsApp) quando chegar mensagem. Vale só para este navegador ou celular."
        >
          <PushDeviceSettings />
        </PreferenceSection>
      )}

      <footer>
        <p className="text-xs text-muted-foreground">
          Som de notificação, idioma e fuso horário entram em uma próxima versão.
        </p>
      </footer>
    </div>
  )
}

// Aparência — modo do tema (light/system/dark). Salva em localStorage
// via ThemeProvider; não envolve backend.
function AppearanceSection(): React.ReactElement {
  const { mode, setMode } = useTheme()
  return (
    <PreferenceSection
      title="Aparência"
      description="Cor da interface."
    >
      <RadioPreferenceList
        ariaLabel="Tema"
        options={THEME_OPTIONS}
        current={mode}
        onChange={setMode}
      />
    </PreferenceSection>
  )
}

// Agenda — qual cor vai como destaque no card (status vs procedure).
// A outra vira ícone no canto. Persiste no backend.
function CalendarSection(): React.ReactElement {
  const { data, isLoading } = useMyPreferences()
  const updateMutation = useUpdateMyPreferences()

  const serverMode =
    data?.calendarColorMode ?? DEFAULT_PREFERENCES.calendarColorMode
  const [selected, setSelected] = useState<CalendarColorMode | null>(null)
  const current = selected ?? serverMode

  const handleChange = async (mode: CalendarColorMode): Promise<void> => {
    if (mode === current) return
    setSelected(mode)
    try {
      await updateMutation.mutateAsync({ calendarColorMode: mode })
      toast.success('Preferência salva')
    } catch {
      setSelected(null)
      toast.error('Erro ao salvar preferência. Tente novamente.')
    }
  }

  return (
    <PreferenceSection
      title="Agenda — destaque do card"
      description="Qual informação domina visualmente cada card: o status do agendamento ou a cor do procedimento."
    >
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <RadioPreferenceList
          ariaLabel="Destaque do card de agenda"
          options={CALENDAR_COLOR_OPTIONS}
          current={current}
          onChange={handleChange}
          disabled={updateMutation.isPending}
        />
      )}
    </PreferenceSection>
  )
}

// Notificações de chat — nível de obtrusividade. Persiste no backend
// via /me/preferences; UI otimista com rollback em erro.
function NotificationsSection(): React.ReactElement {
  const { data, isLoading } = useMyPreferences()
  const updateMutation = useUpdateMyPreferences()

  const serverLevel =
    data?.chatNotificationLevel ?? DEFAULT_PREFERENCES.chatNotificationLevel
  const [selected, setSelected] = useState<ChatLevel | null>(null)
  const current = selected ?? serverLevel

  const handleChange = async (level: ChatLevel): Promise<void> => {
    if (level === current) return
    setSelected(level)
    try {
      await updateMutation.mutateAsync({ chatNotificationLevel: level })
      toast.success('Preferência salva')
    } catch {
      // Rollback otimista — volta pro valor do servidor.
      setSelected(null)
      toast.error('Erro ao salvar preferência. Tente novamente.')
    }
  }

  return (
    <PreferenceSection
      title="Notificações"
      description="Como você quer ser avisado quando chegar mensagem nova."
    >
      {isLoading ? (
        <div className="p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : (
        <RadioPreferenceList
          ariaLabel="Nível de notificação"
          options={CHAT_OPTIONS}
          current={current}
          onChange={handleChange}
          disabled={updateMutation.isPending}
        />
      )}
    </PreferenceSection>
  )
}

// Casca de seção: heading + descrição + card branco com o conteúdo.
function PreferenceSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="text-base font-medium tracking-tight">{title}</h2>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        {children}
      </div>
    </section>
  )
}

// Lista de opções estilo radio. Cada item é um botão clicável com ícone
// + label + descrição. Usado pra trocas mutuamente exclusivas que
// merecem explicação (tema, nível de notificação).
function RadioPreferenceList<V extends string>({
  ariaLabel,
  options,
  current,
  onChange,
  disabled,
}: {
  ariaLabel: string
  options: RadioOption<V>[]
  current: V
  onChange: (value: V) => void
  disabled?: boolean
}): React.ReactElement {
  return (
    <ul role="radiogroup" aria-label={ariaLabel} className="divide-y divide-border">
      {options.map((opt) => {
        const isActive = current === opt.value
        const Icon = opt.icon
        return (
          <li key={opt.value}>
            <button
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(opt.value)}
              disabled={disabled}
              className={cn(
                'flex w-full items-start gap-3 p-4 text-left transition-colors',
                'hover:bg-accent disabled:cursor-wait disabled:opacity-60',
                isActive && 'bg-accent/40',
              )}
            >
              {/* Marca visual do radio. */}
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2',
                  isActive
                    ? 'border-primary bg-primary'
                    : 'border-input bg-background',
                )}
              >
                {isActive && (
                  <span className="size-2 rounded-full bg-primary-foreground" />
                )}
              </span>
              <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium">{opt.label}</span>
                  {opt.isDefault && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Padrão
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {opt.description}
                </p>
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
