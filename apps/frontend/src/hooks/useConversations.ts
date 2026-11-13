import { useQuery } from '@tanstack/react-query'
import {
  fetchConversationById,
  fetchConversations,
  type Conversation,
  type FindConversationsQuery,
  type PaginatedConversations,
} from '@/api/conversations'
import { useMe } from '@/hooks/useMe'

// Chave canônica de toda query do recurso. Mutations (mark-seen, send)
// invalidam pela raiz pra refletir em qualquer view (HUD + modo chat).
export const CONVERSATIONS_QUERY_KEY = ['conversations'] as const

export function conversationsListKey(query: FindConversationsQuery) {
  return [...CONVERSATIONS_QUERY_KEY, 'list', query] as const
}

export function conversationByIdKey(id: string) {
  return [...CONVERSATIONS_QUERY_KEY, 'detail', id] as const
}

export function useConversation(id: string | null | undefined) {
  const { data: me } = useMe()
  return useQuery<Conversation, Error>({
    queryKey: conversationByIdKey(id ?? ''),
    queryFn: () => fetchConversationById(id as string),
    enabled: Boolean(id) && !!me?.user && !!me?.chatEnabled,
    staleTime: 30 * 1000,
  })
}

// Lista paginada. `placeholderData` mantém os dados antigos visíveis enquanto
// a próxima página/busca carrega — evita flash de "Loading…" em paginação.
// Mesma estratégia do useClients.
//
// `enabled: !!me?.user` impede o fetch antes do login. ChatRealtimeBoot monta
// fora do RequireAuth pra manter o socket vivo, então sem o gate aqui o GET
// /conversations dispara 401 desnecessário no boot.
export function useConversations(query: FindConversationsQuery = {}) {
  const { data: me } = useMe()
  return useQuery<PaginatedConversations, Error>({
    queryKey: conversationsListKey(query),
    queryFn: () => fetchConversations(query),
    placeholderData: (prev) => prev,
    enabled: !!me?.user && !!me?.chatEnabled,
    // Conversas são very-live data — mas o socket invalida pra nós em cada
    // inbound, então um staleTime curto evita refetch desnecessário entre
    // re-renders sem perder reatividade.
    staleTime: 15 * 1000,
  })
}
