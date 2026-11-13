import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Message } from '@/api/messages'
import { MessageBubble } from './MessageBubble'

interface MessageListProps {
  messages: Message[]
  isLoading?: boolean
  isError?: boolean
  // Quando presente, bolhas outbound habilitam menu de ações (editar/apagar).
  // Ausente = visualização só-leitura (caso de uso futuro: histórico,
  // dashboard de auditoria).
  conversationId?: string
}

// Renderiza balões em ordem cronológica (mais antigo no topo, mais recente
// embaixo). Backend retorna desc por sent_at — invertemos no client pra
// preservar a UX de chat normal.
//
// Auto-scroll pro fim em qualquer mudança que altere a última mensagem
// (id da última muda): novo envio optimistic, inbound via socket, ou
// substituição temp→real. Usar `lastId` em vez de `length` cobre o caso
// de substituição (length igual, id diferente) que era ponto cego antes.
// Trade-off: se usuário está no meio do scroll lendo histórico, o scroll
// vai pro fim na próxima msg. Aceito pro V1; etapa 7 adiciona "detecção
// de scroll-do-fim" pra preservar posição.
export function MessageList({
  messages,
  isLoading,
  isError,
  conversationId,
}: MessageListProps): React.ReactElement {
  const ordered = useMemo(() => [...messages].reverse(), [messages])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Map de id → message pra QuotedSnippet resolver o alvo do reply sem fetch
  // extra (ele mora dentro de MessageBubble, então recebe o lookup via prop).
  // Memoizado pra não rerenderizar todas as bolhas em cada atualização.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>()
    for (const m of messages) map.set(m.id, m)
    return map
  }, [messages])

  const lookupMessage = useCallback(
    (id: string) => messagesById.get(id),
    [messagesById],
  )
  // ID da última mensagem visível (mais recente cronologicamente).
  // Dispara o auto-scroll em qualquer transição relevante. Vazio quando
  // a lista é vazia — primeiro item carregado também conta como mudança.
  const lastId = ordered.length > 0 ? ordered[ordered.length - 1].id : ''

  useEffect(() => {
    if (!lastId) return
    // Double rAF: primeiro espera o React comitar o re-render; segundo
    // espera o browser fazer layout/paint com o novo conteúdo. Sem isso,
    // scrollHeight pode ler altura pré-render em casos de inserção rápida
    // (especialmente com optimistic update que entra síncrono no cache).
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollRef.current
        if (!el) return
        el.scrollTop = el.scrollHeight
      })
    })
  }, [lastId])

  return (
    <div
      ref={scrollRef}
      // Sem chat-bg próprio — herdado do wrapper de ConversationView pra
      // o pattern se estender também por trás do composer transparente.
      className="flex-1 space-y-1.5 overflow-y-auto p-3"
    >
      {isLoading && messages.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Carregando mensagens…
        </div>
      ) : isError ? (
        <div className="flex h-full items-center justify-center text-sm text-error">
          Erro ao carregar mensagens.
        </div>
      ) : ordered.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          Nenhuma mensagem ainda. Comece a conversa.
        </div>
      ) : (
        ordered.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            conversationId={conversationId}
            lookupMessage={lookupMessage}
          />
        ))
      )}
    </div>
  )
}
