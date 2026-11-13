import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  editMessage,
  fetchMessageMediaUrl,
  fetchMessages,
  retryMessage,
  revokeMessage,
  sendMessage,
  uploadMedia,
  type FindMessagesQuery,
  type MediaUrlResponse,
  type Message,
  type PaginatedMessages,
  type SendMessageInput,
  type UploadMediaResponse,
} from '@/api/messages'
import { markConversationSeen } from '@/api/conversations'
import { CONVERSATIONS_QUERY_KEY } from './useConversations'

export function conversationMessagesKey(
  conversationId: string,
  query: FindMessagesQuery = {},
) {
  return ['conversation', conversationId, 'messages', query] as const
}

// V1: uma página única de até 50 mensagens. Infinite scroll com
// useInfiniteQuery + virtualização entra na etapa 7 quando o modo chat
// puxar histórico longo. Pro flutuante (foco em conversa ativa), 50
// mensagens cobre quase todos os casos práticos sem complicação.
const DEFAULT_PAGE_SIZE = 50

export function useConversationMessages(
  conversationId: string | null | undefined,
  query: Omit<FindMessagesQuery, 'page' | 'pageSize'> = {},
) {
  const fullQuery: FindMessagesQuery = {
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    ...query,
  }
  return useQuery<PaginatedMessages, Error>({
    queryKey: conversationMessagesKey(conversationId ?? '', fullQuery),
    queryFn: () => fetchMessages(conversationId as string, fullQuery),
    enabled: Boolean(conversationId),
    placeholderData: (prev) => prev,
    staleTime: 5 * 1000,
  })
}

// =====================================================================
// Send — backend insere a row em `messages` com `deliveryStatus='pending'`
// e retorna o id real imediatamente. Worker do backend processa pre-flight
// + adapter + UPDATE assincronamente, publicando `wa.message.status_changed`
// via socket (useChatRealtime invalida).
//
// Sem tempId, sem optimistic update, sem onMutate/onError de cache:
//   - HTTP response chega rápido (sub-100ms — só INSERT + enqueue, sem rede)
//   - Bolha aparece via `setQueriesData` no onSuccess, com `id` real
//   - MessageBubble lê `deliveryStatus` pra desenhar spinner (pending),
//     check (sent), ou alerta laranja (failed/rejected).
//
// Race entre onSuccess HTTP e socket `message.created` da mesma sessão é
// inofensiva: ambos resultam no mesmo cache final, e setQueriesData é
// idempotente (map por id preserva o estado mais recente).
// =====================================================================

export function useSendMessage(conversationId: string | null | undefined) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, SendMessageInput>({
    mutationFn: (input) => {
      if (!conversationId) throw new Error('conversationId obrigatório')
      return sendMessage(conversationId, input)
    },
    onSuccess: (real) => {
      if (!conversationId) return
      // Injeta a row real no cache sem refetch — bolha pending aparece
      // imediatamente. Se já estiver no cache (socket message.created chegou
      // antes), o map por id é no-op semântico.
      const prefix = ['conversation', conversationId, 'messages'] as const
      queryClient.setQueriesData<PaginatedMessages>({ queryKey: prefix }, (old) => {
        if (!old) return old
        const exists = old.items.some((m) => m.id === real.id)
        if (exists) {
          return {
            ...old,
            items: old.items.map((m) => (m.id === real.id ? real : m)),
          }
        }
        return {
          ...old,
          items: [...old.items, real],
          total: old.total + 1,
        }
      })
      // Lista de conversations atualiza last_message_at + preview.
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY })
    },
  })
}

export function useMarkConversationSeen() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (conversationId) => markConversationSeen(conversationId),
    onSuccess: () => {
      // Atualiza unreadCount no listing — badge e dropdown refletem.
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY })
    },
  })
}

// =====================================================================
// Upload de mídia (multipart) — passo 1 do envio de mídia.
// onProgress recebe (loaded, total) em bytes pra UI mostrar barra.
// =====================================================================
export interface UploadMediaArgs {
  file: File
  onProgress?: (loaded: number, total: number) => void
}

export function useUploadMedia(conversationId: string | null | undefined) {
  return useMutation<UploadMediaResponse, Error, UploadMediaArgs>({
    mutationFn: ({ file, onProgress }) => {
      if (!conversationId) throw new Error('conversationId obrigatório')
      return uploadMedia(conversationId, file, { onProgress })
    },
  })
}

// =====================================================================
// Edit (PATCH) — recebe { messageId, body }. Invalida cache da
// conversation pra UI refletir editedAt + novo body.
// =====================================================================
export interface EditMessageArgs {
  messageId: string
  body: string
}

export function useEditMessage(conversationId: string | null | undefined) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, EditMessageArgs>({
    mutationFn: ({ messageId, body }) => editMessage(messageId, body),
    onSuccess: () => {
      if (conversationId) {
        queryClient.invalidateQueries({
          queryKey: ['conversation', conversationId, 'messages'],
        })
      }
      // Last message preview pode ter mudado se editaram a última msg.
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY })
    },
  })
}

// =====================================================================
// Retry (POST /messages/:id/retry) — reenvia bolha failed/rejected.
// Atualiza o cache da conversation com a row retornada (já com
// deliveryStatus='pending') sem esperar o socket — feedback imediato no
// click. `wa.message.status_changed` chega depois e mantém idempotência.
// =====================================================================
export function useRetryMessage(conversationId: string | null | undefined) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, string>({
    mutationFn: (messageId) => retryMessage(messageId),
    onSuccess: (updated) => {
      if (!conversationId) return
      const prefix = ['conversation', conversationId, 'messages'] as const
      queryClient.setQueriesData<PaginatedMessages>({ queryKey: prefix }, (old) => {
        if (!old) return old
        return {
          ...old,
          items: old.items.map((m) => (m.id === updated.id ? updated : m)),
        }
      })
    },
  })
}

// =====================================================================
// Revoke (DELETE) — soft delete. Recebe messageId. Invalida cache da
// conversation pra UI mostrar "Você apagou esta mensagem".
// =====================================================================
export function useRevokeMessage(conversationId: string | null | undefined) {
  const queryClient = useQueryClient()
  return useMutation<Message, Error, string>({
    mutationFn: (messageId) => revokeMessage(messageId),
    onSuccess: () => {
      if (conversationId) {
        queryClient.invalidateQueries({
          queryKey: ['conversation', conversationId, 'messages'],
        })
      }
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY })
    },
  })
}

// =====================================================================
// Presigned URL pra mídia já gravada (GET /messages/:id/media-url).
// Lazy: ativa quando UI renderiza a mídia. staleTime alto porque a URL
// vale ~7d e bater na API em cada scroll é desperdício.
// =====================================================================
export function messageMediaUrlKey(messageId: string) {
  return ['message', messageId, 'media-url'] as const
}

export function useMessageMediaUrl(messageId: string | null | undefined) {
  return useQuery<MediaUrlResponse, Error>({
    queryKey: messageMediaUrlKey(messageId ?? ''),
    queryFn: () => fetchMessageMediaUrl(messageId as string),
    enabled: Boolean(messageId),
    // 1h: presigned URL backend default é 7d. Re-fetchar de hora em hora
    // garante que sessões longas não exibam URL expirada se TTL for menor.
    staleTime: 60 * 60 * 1000,
    // Pequena tolerância a erro de rede; falha persistente vira UI de erro.
    retry: 1,
  })
}
