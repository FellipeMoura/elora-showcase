import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { openChatConversation } from '@/lib/chatBridge'

// =====================================================================
// Clique na notificação push → abre a conversa. Dois caminhos (ver
// public/sw.js, `notificationclick`):
//   - app fechado: o SW abre `/?conversation=<id>` — lido aqui no mount e
//     tirado da URL;
//   - app aberto: o SW foca a janela e manda `open-conversation` por
//     postMessage.
// Usar DEPOIS do registerChatBridge (AppShell) — effects rodam na ordem.
// =====================================================================
export function usePushNavigation(): void {
  const [searchParams, setSearchParams] = useSearchParams()
  const conversationParam = searchParams.get('conversation')

  useEffect(() => {
    if (!conversationParam) return
    openChatConversation(conversationParam)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('conversation')
        return next
      },
      { replace: true },
    )
  }, [conversationParam, setSearchParams])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onMessage = (event: MessageEvent): void => {
      const data = event.data as { type?: string; conversationId?: string } | null
      if (data?.type === 'open-conversation' && typeof data.conversationId === 'string') {
        openChatConversation(data.conversationId)
      }
    }
    navigator.serviceWorker.addEventListener('message', onMessage)
    return () => navigator.serviceWorker.removeEventListener('message', onMessage)
  }, [])
}
