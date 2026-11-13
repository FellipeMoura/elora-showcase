import { Menu as MenuIcon } from 'lucide-react'
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon'
import { useUiStore, type SidebarTab } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { useMe } from '@/hooks/useMe'
import { cn } from '@/lib/utils'

// Header mínimo só pra mobile (<md). Substitui a UI antiga (Header com
// MinimizedBar + HUD) por dois botões duplicados em função: abrem o
// drawer da sidebar **e** selecionam o tab ativo (MENU ou CHAT) em 1
// toque. Se o drawer já está aberto, só troca o tab.
//
// Desktop não renderiza este componente — a sidebar fixa à esquerda já
// hospeda os dois tabs.
export function MobileTopBar(): React.ReactElement {
  const open = useUiStore((s) => s.mobileSidebarOpen)
  const setOpen = useUiStore((s) => s.setMobileSidebarOpen)
  const sidebarTab = useUiStore((s) => s.sidebarTab)
  const setSidebarTab = useUiStore((s) => s.setSidebarTab)
  const totalUnread = useChatStore((s) => s.totalUnread)
  // CHAT só aparece com `me.chatEnabled` (chat:use + canal ativo).
  const { data: me } = useMe()
  const chatEnabled = !!me?.chatEnabled

  const handleTap = (tab: SidebarTab): void => {
    setSidebarTab(tab)
    if (!open) {
      setOpen(true)
    }
  }

  return (
    <header
      // `relative z-shell` mantém os botões acima do overlay do drawer
      // (z-50) — combinado com `modal={false}` no Sheet, permite alternar
      // tabs sem fechar o drawer. Sem padding/gap: botões cobrem 100% da
      // largura, divididos em metades via `flex-1`.
      className="relative z-shell flex h-12 shrink-0 border-b border-border bg-background md:hidden"
      aria-label="Barra superior"
    >
      <TabButton
        label="Menu"
        icon={<MenuIcon className="size-4" />}
        active={open && sidebarTab === 'menu'}
        onClick={() => handleTap('menu')}
      />
      {chatEnabled && (
        <TabButton
          label="Chat"
          icon={<WhatsAppIcon variant="mono" className="size-4" />}
          active={open && sidebarTab === 'chat'}
          onClick={() => handleTap('chat')}
          badge={totalUnread}
          // Tab CHAT ativo usa a paleta verde do domínio chat (consistente
          // com o ButtonGroup do desktop em <Sidebar>).
          activeClassName="bg-chat-accent text-chat-accent-foreground"
        />
      )}
    </header>
  )
}

interface TabButtonProps {
  label: string
  icon: React.ReactNode
  active: boolean
  onClick: () => void
  badge?: number
  activeClassName?: string
}

function TabButton({
  label,
  icon,
  active,
  onClick,
  badge,
  activeClassName = 'bg-primary text-primary-foreground',
}: TabButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex h-full flex-1 items-center justify-center gap-1.5 text-sm font-medium transition-colors',
        active
          ? activeClassName
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
    >
      {icon}
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-chat-accent px-1.5 py-0.5 text-[10px] font-medium leading-none text-chat-accent-foreground"
          aria-label={`${badge} ${
            badge === 1 ? 'mensagem não lida' : 'mensagens não lidas'
          }`}
        >
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}
