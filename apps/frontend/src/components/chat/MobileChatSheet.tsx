import { ArrowLeft } from 'lucide-react'
import { useConversation } from '@/hooks/useConversations'
import { displayPhone } from '@/lib/format'
import { useChatStore } from '@/stores/chatStore'
import { useUiStore } from '@/stores/uiStore'
import { ConversationActions } from './ConversationActions'
import { ConversationView } from './ConversationView'

interface MobileChatSheetProps {
  conversationId: string
}

// Bottom-sheet ocupando todo o espaço abaixo da MobileTopBar (h-12).
// Substitui FloatingChatWindow em telas <768px — flutuante arrastável não
// é viável em touchscreen pequeno. Comportamento simplificado: sem drag,
// sem resize. Só fechar.
//
// Ancoragem via `top-12 inset-x-0 bottom-0` (em vez de `height: vh`) — sem
// magic numbers e robusto contra a barra do browser mobile que come `vh`
// (anti-pattern §3 do design system).
export function MobileChatSheet({
  conversationId,
}: MobileChatSheetProps): React.ReactElement {
  const { data: conv, isLoading } = useConversation(conversationId)
  const closeFloating = useChatStore((s) => s.closeFloating)
  const setMobileSidebarOpen = useUiStore((s) => s.setMobileSidebarOpen)
  const setSidebarTab = useUiStore((s) => s.setSidebarTab)

  // "Voltar" do mobile = padrão WhatsApp app: fecha o chat individual e
  // expõe a lista de conversas. Aqui isso significa abrir o drawer mobile
  // com o tab CHAT pré-selecionado.
  const handleBack = (): void => {
    closeFloating()
    setSidebarTab('chat')
    setMobileSidebarOpen(true)
  }

  return (
    <div
      className="chat-scope fixed inset-x-0 bottom-0 top-12 z-40 flex flex-col border-t border-border bg-background shadow-2xl"
      role="dialog"
      aria-modal="false"
      aria-label={`Conversa com ${conv?.client.name ?? 'cliente'}`}
    >
      <header className="relative flex shrink-0 items-center gap-2 border-b border-border bg-card px-2 pt-4 pb-2">
        {/* Pequena "alça" visual indicando que dá pra arrastar pra baixo
            (apenas decorativa por enquanto — gesto não implementado V1).
            Posicionada relativa ao header via `relative` no parent. */}
        <span
          aria-hidden
          className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/30"
        />
        {/* Seta esquerda no canto esquerdo — padrão WhatsApp app mobile.
            Substitui o X que ficaria no canto direito (pattern desktop). */}
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded text-foreground hover:bg-muted"
          aria-label="Voltar"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {isLoading ? 'Carregando…' : (conv?.client.name ?? 'Conversa')}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {conv ? displayPhone(conv.client.phoneE164) : ' '}
          </div>
        </div>
        {conv && (
          <ConversationActions
            conv={conv}
            // Sheet cobre a tela toda — fecha pra mostrar a página de destino.
            onNavigate={closeFloating}
            triggerClassName="shrink-0 text-foreground hover:bg-muted"
          />
        )}
      </header>

      <div className="min-h-0 flex-1">
        <ConversationView
          key={conversationId}
          conversationId={conversationId}
        />
      </div>
    </div>
  )
}
