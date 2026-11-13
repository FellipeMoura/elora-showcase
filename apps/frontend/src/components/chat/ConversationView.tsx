import { useEffect } from 'react'
import {
  useConversationMessages,
  useMarkConversationSeen,
} from '@/hooks/useConversationMessages'
import { useConversation } from '@/hooks/useConversations'
import { MessageComposer } from './MessageComposer'
import { MessageList } from './MessageList'
import { TemplateComposer } from './TemplateComposer'

interface ConversationViewProps {
  conversationId: string
}

// Janela de 24h do WhatsApp Cloud API: pode mandar texto livre se o último
// inbound do cliente foi nas últimas 24h. Fora disso só template aprovado.
// Backend valida em MessagesService.send (passo 6); calculamos no front pra
// trocar o composer antes do envio em vez de tentar+falhar.
//
// IMPORTANTE: só vale pra canais Cloud (`providerType='meta_cloud'`). No
// Baileys o protocolo não tem janela e templates não existem como conceito
// aprovado — o composer fica sempre livre. Defesa contra ban Baileys mora
// no backend (OutboundGuard: rate limit + dedupe).
const WINDOW_MS = 24 * 60 * 60 * 1000

function shouldShowTemplateComposer(
  providerType: string | undefined,
  lastInboundAt: string | null,
): boolean {
  if (providerType !== 'meta_cloud') return false
  if (!lastInboundAt) return true
  const delta = Date.now() - new Date(lastInboundAt).getTime()
  return delta >= WINDOW_MS
}

// "Coração" reutilizável de qualquer tela que exibe uma conversa.
// Renderiza apenas Lista + Composer; header e wrappers visuais (drag,
// resize, layout) são responsabilidade do container externo
// (FloatingChatWindow ou MobileChatSheet).
//
// Composer dinâmico (provider-aware):
//   - Cloud API fora da janela 24h: TemplateComposer (Meta enforça
//     templates aprovados no protocolo).
//   - Cloud API dentro da janela OU qualquer canal Baileys/mock:
//     MessageComposer (texto/mídia/áudio livres). Em Baileys, a defesa
//     contra ban é o OutboundGuard do backend (rate limit + dedupe), não
//     gate na UI.
//
// Auto mark-seen ao montar a conversa: idempotente no backend (sempre
// atualiza last_staff_seen_at = NOW()). A mutation invalida a key de
// conversations, que faz o totalUnread reconciliar via ChatRealtimeBoot.
export function ConversationView({
  conversationId,
}: ConversationViewProps): React.ReactElement {
  const { data, isLoading, isError } = useConversationMessages(conversationId)
  const { data: conversation } = useConversation(conversationId)
  const markSeen = useMarkConversationSeen()

  useEffect(() => {
    if (!conversationId) return
    markSeen.mutate(conversationId)
    // markSeen.mutate é estável (TanStack mutation) — referência ignorada
    // de propósito no array de deps pra não relooping.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId])

  const useTemplateComposer = shouldShowTemplateComposer(
    conversation?.channel.providerType,
    conversation?.lastInboundAt ?? null,
  )

  return (
    // chat-bg no wrapper inteiro pra o pattern se estender por trás do
    // composer também (composer é transparente). MessageList já não precisa
    // do chat-bg próprio — herda do parent por ser transparente.
    <div className="chat-bg flex h-full flex-col">
      <MessageList
        messages={data?.items ?? []}
        isLoading={isLoading}
        isError={isError}
        conversationId={conversationId}
      />
      {useTemplateComposer ? (
        <TemplateComposer conversationId={conversationId} />
      ) : (
        <MessageComposer conversationId={conversationId} />
      )}
    </div>
  )
}
