import { Link, useNavigate } from 'react-router-dom'
import { LogOut, Menu as MenuIcon } from 'lucide-react'
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { useVisibleMenus } from '@/hooks/useVisibleMenus'
import { useLeadsNewCount } from '@/hooks/useLeadsNewCount'
import { useLogout, useMe } from '@/hooks/useMe'
import { useUiStore, type SidebarTab } from '@/stores/uiStore'
import { useChatStore } from '@/stores/chatStore'
import { ChatSidebarPanel } from '@/components/chat/ChatSidebarPanel'
import { cn } from '@/lib/utils'
import { SidebarItem } from './SidebarItem'

interface SidebarProps {
  onNavigate?: () => void
  // Mobile drawer passa false porque os tabs MENU/CHAT já estão na
  // MobileTopBar (acima do overlay) — duplicar dentro do drawer
  // bagunça visualmente.
  showTabs?: boolean
}

// Sidebar: tabs MENU/CHAT no topo (opcional), conteúdo do tab no meio
// (menus ou lista de conversas), footer fixo (user.name + sair) em
// baixo. Mesmo componente é reusado pelo MobileDrawer — `onNavigate`
// fecha o drawer quando o user clica num link, no nome do user ou numa
// conversa.
export function Sidebar({
  onNavigate,
  showTabs = true,
}: SidebarProps): React.ReactElement {
  const { data: me } = useMe()
  const user = me?.user
  const logout = useLogout()
  const navigate = useNavigate()
  const storedTab = useUiStore((s) => s.sidebarTab)
  // Tab CHAT só existe com `me.chatEnabled` (chat:use + canal ativo). Sem
  // ele, fica no MENU mesmo que o store lembre 'chat' de outra sessão.
  const chatEnabled = !!me?.chatEnabled
  const sidebarTab: SidebarTab = chatEnabled ? storedTab : 'menu'
  const setSidebarTab = useUiStore((s) => s.setSidebarTab)
  const totalUnread = useChatStore((s) => s.totalUnread)

  const handleLogout = async (): Promise<void> => {
    onNavigate?.()
    await logout.mutateAsync()
    navigate('/login', { replace: true })
  }

  return (
    <div className="flex h-full flex-col">
      {showTabs && chatEnabled && (
        <div className="shrink-0 border-b border-border p-2">
          <ButtonGroup<SidebarTab>
            value={sidebarTab}
            onChange={setSidebarTab}
            aria-label="Alternar entre menu e conversas"
            className="w-full"
            // Tab CHAT ativo herda a paleta verde do domínio chat em vez do
            // primary (azul) do core. Reforça visualmente o switch de
            // contexto: "agora você está olhando atendimento, não cadastro".
            optionClassName={(v, isActive) =>
              v === 'chat' && isActive
                ? 'bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent/90'
                : undefined
            }
            options={[
              {
                value: 'menu',
                label: (
                  <span className="inline-flex items-center gap-1.5 w-22 justify-center">
                    <MenuIcon className="size-3.5" />
                    Menu
                  </span>
                ),
              },
              {
                value: 'chat',
                label: (
                  <span className="inline-flex items-center gap-1.5 w-22 justify-center">
                    <WhatsAppIcon variant="mono" className="size-3.5" />
                    Chat
                    {sidebarTab !== 'chat' && totalUnread > 0 && (
                      <span
                        className="ml-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-chat-accent px-1.5 py-0.5 text-[10px] font-medium leading-none text-chat-accent-foreground"
                        aria-label={`${totalUnread} ${
                          totalUnread === 1
                            ? 'mensagem não lida'
                            : 'mensagens não lidas'
                        }`}
                      >
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </span>
                    )}
                  </span>
                ),
              },
            ]}
          />
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <MenuPanel hidden={sidebarTab !== 'menu'} onNavigate={onNavigate} />
        {chatEnabled && (
          <ChatPanel hidden={sidebarTab !== 'chat'} onNavigate={onNavigate} />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border p-3">
        {user && (
          <Link
            to="/settings/preferences"
            onClick={onNavigate}
            className="min-w-0 flex-1 truncate rounded px-2 py-1 text-sm text-foreground transition-colors hover:bg-accent"
            title="Preferências"
          >
            {user.name}
          </Link>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleLogout}
          disabled={logout.isPending}
          aria-label="Sair"
        >
          <LogOut className="size-4" />
        </Button>
      </div>
    </div>
  )
}

interface PanelProps {
  hidden: boolean
  onNavigate?: () => void
}

// Painéis ficam **montados sempre** e só alternam `display`. Isso preserva
// estado interno (scroll, input de busca, query cache do TanStack) ao
// trocar de tab. Reconstruir do zero em cada toggle perderia o scroll
// position da lista de conversas — não é caro montar, é caro re-fetchar.
//
// Badges no menu (lookup `path → count`) são montados uma vez aqui pra
// respeitar Rules of Hooks — passar pra SidebarItem via prop. Hoje só
// `leads` tem badge; ao adicionar agenda/quotes/etc., plugar no objeto.
function MenuPanel({ hidden, onNavigate }: PanelProps): React.ReactElement {
  const { data: menus, isLoading, isError } = useVisibleMenus()
  const leadsNewCount = useLeadsNewCount()
  const badges: Record<string, number | undefined> = {
    leads: leadsNewCount,
  }

  return (
    <nav
      className={cn('h-full flex-col gap-1 overflow-y-auto p-3', hidden ? 'hidden' : 'flex')}
      aria-label="Menu principal"
      aria-hidden={hidden}
    >
      {isLoading && (
        <div className="px-2 py-1 text-xs text-muted-foreground">Carregando menus…</div>
      )}
      {isError && (
        <div className="px-2 py-1 text-xs text-error">Erro ao carregar menus.</div>
      )}
      {menus && menus.length === 0 && (
        <div className="px-2 py-1 text-xs text-muted-foreground">
          Nenhum menu visível pra este usuário.
        </div>
      )}
      {menus?.map((m) => (
        <SidebarItem
          key={m.id}
          node={m}
          onNavigate={onNavigate}
          badges={badges}
        />
      ))}
    </nav>
  )
}

function ChatPanel({ hidden, onNavigate }: PanelProps): React.ReactElement {
  return (
    <div className={cn('h-full', hidden ? 'hidden' : 'block')} aria-hidden={hidden}>
      <ChatSidebarPanel onSelect={onNavigate} />
    </div>
  )
}
