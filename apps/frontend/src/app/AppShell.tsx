import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { ChatFloatingPortal } from '@/components/chat/ChatFloatingPortal'
import { useChatStore } from '@/stores/chatStore'
import { registerChatBridge } from '@/lib/chatBridge'
import { usePushNavigation } from '@/hooks/usePushNavigation'
import { useUiStore } from '@/stores/uiStore'
import { Sidebar } from './shell/Sidebar'
import { MobileDrawer } from './shell/MobileDrawer'
import { MobileTopBar } from './shell/MobileTopBar'

// Shell da área autenticada.
//
// Desktop (>=md): sidebar fixa à esquerda (com tabs MENU/CHAT no topo)
// + content. Sem header — o conteúdo ganha a faixa de volta.
//
// Mobile (<md): MobileTopBar mínimo com os dois botões MENU/CHAT que
// controlam o drawer overlay. A sidebar real vive dentro do drawer.
//
// `useChatRealtime` mora no <ChatRealtimeBoot /> em App.tsx — fora do
// AppShell — pra a conexão socket sobreviver ao logout/login. O
// ChatFloatingPortal aqui dentro renderiza a janela flutuante quando há
// conversa aberta no slot.
export function AppShell(): React.ReactElement {
  // Registra a bridge core→chat uma vez na montagem. Permite que `core/`
  // dispare `openChatConversation(id)` sem importar de `chat/`.
  useEffect(() => {
    registerChatBridge((conversationId, draftText) => {
      useChatStore.getState().openConversation(conversationId, draftText)
      const ui = useUiStore.getState()
      // Tab CHAT pré-selecionada: o "Voltar" do MobileChatSheet cai na lista.
      ui.setSidebarTab('chat')
      // Mobile: fecha o drawer, igual ao clique na lista. Aberto, ele fica por
      // cima do MobileChatSheet e o usuário via a lista em vez da conversa
      // (deep link do push, botão "Conversa" em Clientes). Desktop ignora — a
      // flutuante aparece sozinha em cima do content.
      if (window.matchMedia('(max-width: 767px)').matches) {
        ui.setMobileSidebarOpen(false)
      }
    })
  }, [])

  // Clique em notificação push → abre a conversa (depende do bridge acima).
  usePushNavigation()

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <MobileTopBar />
      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden w-64 shrink-0 border-r border-border md:block">
          <Sidebar />
        </aside>
        <MobileDrawer />
        {/* min-h-0 quebra o `min-height: auto` implícito do flex item.
            h-full explícito reforça a propagação de "altura definida" pros
            filhos — sem ele, alguns browsers tratam `flex-1` como altura
            indefinida pra fins de `height: 100%` dos descendentes.
            Ver design-system §3 (cascata h-svh → flex-1 → h-full
            → flex-initial min-h-0). */}
        <main className="h-full flex-1 min-h-0 overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <ChatFloatingPortal />
    </div>
  )
}
