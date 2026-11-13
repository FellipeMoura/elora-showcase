import { Rnd } from 'react-rnd'
import { Link } from 'react-router-dom'
import { Maximize2, Minimize2, X } from 'lucide-react'
import { useConversation } from '@/hooks/useConversations'
import { useChatStore } from '@/stores/chatStore'
import { displayPhone } from '@/lib/format'
import { cn } from '@/lib/utils'
import { ConversationActions } from './ConversationActions'
import { ConversationView } from './ConversationView'

// Drag handle: classe usada por react-rnd pra limitar arrasto ao header.
// Sem isso, qualquer ponto da flutuante vira "arrastável" — inviável
// porque você não conseguiria selecionar texto nas mensagens.
const DRAG_HANDLE = 'elora-floating-drag-handle'

interface FloatingChatWindowProps {
  conversationId: string
}

// Janela ÚNICA do chat flutuante. Posição/tamanho e o flag `expanded`
// vivem em chatStore.floating (persistidos em localStorage). Trocar de
// conversa = trocar o `conversationId` → conteúdo muda, geometria fica.
//
// Modo flutuante (`expanded=false`): Rnd com drag (header) + resize
// (cantos/bordas), z-40, dentro do viewport.
// Modo expandido (`expanded=true`): fullscreen estilo MobileChatSheet —
// ancorado abaixo da MobileTopBar (top-12) ou do topo (md+), sem drag/
// resize. Pra colapsar de volta, click no mesmo botão (vira Minimize2).
//
// Mobile não chega aqui — ChatFloatingPortal escolhe MobileChatSheet pra
// <md, que já é fullscreen sem botão de toggle.
export function FloatingChatWindow({
  conversationId,
}: FloatingChatWindowProps): React.ReactElement | null {
  const geometry = useChatStore((s) => s.floating.geometry)
  const expanded = useChatStore((s) => s.floating.expanded)
  const updateGeometry = useChatStore((s) => s.updateGeometry)
  const closeFloating = useChatStore((s) => s.closeFloating)
  const toggleExpanded = useChatStore((s) => s.toggleExpanded)

  // Lê dados da conversa pro header. Se ainda carregando, mostra
  // placeholder — sem bloquear renderização da janela (geometria já é
  // visível enquanto o conteúdo carrega).
  const { data: conv, isLoading } = useConversation(conversationId)

  const header = (
    <header
      className={cn(
        // Em modo expandido o drag handle não é usado (não tem Rnd
        // wrappando), mas manter a classe não causa dano e simplifica a
        // composição. Cursor `move` só aparece em modo flutuante.
        !expanded && DRAG_HANDLE,
        'flex shrink-0 select-none flex-col gap-0.5 border-b border-border bg-chat-background-card px-3 py-2',
        !expanded && 'cursor-move',
      )}
      style={
        conv?.channel.color
          ? { borderTop: `3px solid ${conv.channel.color}` }
          : undefined
      }
    >
      <div className="flex items-center justify-between gap-2">
        {conv ? (
          // Nome + telefone clicáveis → ClientDetail. stopPropagation no
          // mousedown impede que react-rnd dispare drag a partir do clique
          // no link (header inteiro é drag handle em modo flutuante).
          <div
           
            className="block min-w-0 flex-1 "
            
          >
            <Link
             to={`/clients/${conv.client.id}`}
            onMouseDown={(e) => e.stopPropagation()}
            title={`Abrir cadastro de ${conv.client.name}`}
            className="truncate text-sm font-semibold text-chat-txt-card hover:underline">
              {conv.client.name}
            </Link>
            <div className="truncate text-xs text-chat-txt-card">
              {displayPhone(conv.client.phoneE164)}
            </div>
          </div>
        ) : (
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-chat-txt-card">
              {isLoading ? 'Carregando…' : 'Conversa'}
            </div>
          </div>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {conv && (
            <ConversationActions
              conv={conv}
              // Expandida cobre a página de destino — recolhe pra mostrá-la.
              onNavigate={expanded ? toggleExpanded : undefined}
              triggerClassName="text-chat-txt-card hover:bg-white/15"
            />
          )}
          <button
            type="button"
            onClick={toggleExpanded}
            className="inline-flex size-9 items-center justify-center rounded text-chat-txt-card hover:bg-white/15"
            aria-label={expanded ? 'Reduzir' : 'Expandir'}
            title={expanded ? 'Reduzir' : 'Expandir'}
          >
            {expanded ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </button>
          <button
            type="button"
            onClick={closeFloating}
            className="inline-flex size-9 items-center justify-center rounded text-chat-txt-card hover:bg-white/15"
            aria-label="Fechar"
            title="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>
    </header>
  )

  const body = (
    <div className="min-h-0 flex-1">
      <ConversationView conversationId={conversationId} />
    </div>
  )

  // Modo expandido — ocupa toda a área de conteúdo SEM cobrir a sidebar
  // (w-64 em md+). Em telas <md o ChatFloatingPortal já roteia pro
  // MobileChatSheet, então este caminho não é atingido — mas mantemos os
  // breakpoints corretos por defesa caso o boundary mude.
  if (expanded) {
    return (
      <div
        className="chat-scope fixed inset-y-0 right-0 left-0 top-12 z-40 flex flex-col border-t border-border bg-background shadow-2xl md:left-64 md:top-0"
        role="dialog"
        aria-modal="false"
        aria-label={`Conversa com ${conv?.client.name ?? 'cliente'}`}
      >
        {header}
        {body}
      </div>
    )
  }

  return (
    <Rnd
      size={{ width: geometry.width, height: geometry.height }}
      position={{ x: geometry.x, y: geometry.y }}
      minWidth={300}
      minHeight={360}
      // Mantém a flutuante dentro do viewport — sem isso é fácil "perder"
      // ela arrastando pra fora.
      bounds="window"
      dragHandleClassName={DRAG_HANDLE}
      onDragStop={(_e, d) => updateGeometry({ x: d.x, y: d.y })}
      onResizeStop={(_e, _dir, ref, _delta, position) => {
        updateGeometry({
          x: position.x,
          y: position.y,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        })
      }}
      // z-index alto pra ficar acima do conteúdo da página. Modais Radix
      // (z-50) ainda passam por cima — comportamento correto: form/dialog
      // crítico não deve ser tampado por flutuante.
      style={{ zIndex: 40 }}
      className="chat-scope overflow-hidden rounded-lg border border-border shadow-xl"
    >
      <div className="flex h-full flex-col">
        {header}
        {body}
      </div>
    </Rnd>
  )
}
