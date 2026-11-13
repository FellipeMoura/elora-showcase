import { useEffect } from 'react'
import { useChatRealtime } from '@/hooks/useChatRealtime'
import { useConversations } from '@/hooks/useConversations'
import { useMe } from '@/hooks/useMe'
import { usePresenceReporter } from '@/hooks/usePresenceReporter'
import { syncPushSubscription } from '@/lib/pushNotifications'
import { useChatStore } from '@/stores/chatStore'

// Tamanho de página pro fetch inicial que alimenta o badge de unread no
// botão CHAT da sidebar. Limitação conhecida: a soma considera apenas os
// 20 mais recentes — se houver >20 conversas com unread, o badge
// sub-conta. Aceito pro MVP; endpoint dedicado `/conversations/unread-
// summary` entra quando virar dor real.
const UNREAD_PAGE_SIZE = 20

// Monta o hook do socket.io uma única vez em alto nível na árvore React.
// Vive abaixo do QueryClientProvider e do BrowserRouter (precisa de ambos),
// mas acima dos layouts. Sem renderização visual.
//
// Também serve como dono do fetch inicial de conversations que alimenta
// `totalUnread`. Por viver fora dos layouts, garante que o contador é
// reativo mesmo quando o usuário não abriu a sidebar CHAT — o badge no
// botão MENU/CHAT fica correto desde o login.
export function ChatRealtimeBoot(): null {
  useChatRealtime()

  // Push: presença (suprime push enquanto o app está na frente) e
  // re-sincronização da assinatura deste aparelho. Depois do
  // useChatRealtime — o effect dele é quem cria o socket.
  const { data: me } = useMe()
  const chatReady = !!me?.user && !!me?.chatEnabled
  usePresenceReporter(chatReady)
  useEffect(() => {
    if (chatReady) void syncPushSubscription()
  }, [chatReady])

  // Mesma query key que a ChatSidebarPanel usa — TanStack dedupe garante
  // que o fetch acontece uma vez por intervalo de staleness.
  const { data } = useConversations({ page: 1, pageSize: UNREAD_PAGE_SIZE })
  const setTotalUnread = useChatStore((s) => s.setTotalUnread)

  // Reduz pra escalares antes do useEffect — `data?.items ?? []` retorna
  // referência nova a cada render, e usar o array direto nas deps
  // looparia.
  const items = data?.items ?? []
  const unreadSum = items.reduce((acc, c) => acc + (c.unreadCount ?? 0), 0)
  // Gate na presença de `data` (não no comprimento) — lista vazia é um
  // estado legítimo de "tudo lido" e deve zerar o badge. O gate antigo
  // (`itemsLength === 0`) deixava badges fantasmas quando a última
  // conversa unread era lida e a lista voltava vazia.
  const hasData = data !== undefined

  useEffect(() => {
    if (!hasData) return
    setTotalUnread(unreadSum)
  }, [unreadSum, hasData, setTotalUnread])

  return null
}
