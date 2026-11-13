import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  activateMessageTemplate,
  createMessageTemplate,
  deactivateMessageTemplate,
  deleteMessageTemplate,
  fetchMessageTemplates,
  updateMessageTemplate,
  type CreateMessageTemplateInput,
  type FindMessageTemplatesQuery,
  type MessageTemplate,
  type PaginatedMessageTemplates,
  type UpdateMessageTemplateInput,
} from '@/api/messageTemplates'
import { useMe } from '@/hooks/useMe'

export const MESSAGE_TEMPLATES_QUERY_KEY = ['message-templates'] as const

export function messageTemplatesListKey(query: FindMessageTemplatesQuery) {
  return [...MESSAGE_TEMPLATES_QUERY_KEY, 'list', query] as const
}

// Lista templates do tenant. Default carrega só ativos (status='active') —
// é o que o composer fora-de-janela precisa exibir. Filtros (q, kind, stage)
// expostos pro caller refinar quando precisar.
//
// staleTime alto: templates mudam raramente; uma página padrão pageSize=20
// cobre o caso comum sem invalidação agressiva.
export function useMessageTemplates(query: FindMessageTemplatesQuery = {}) {
  const { data: me } = useMe()
  return useQuery<PaginatedMessageTemplates, Error>({
    queryKey: messageTemplatesListKey(query),
    queryFn: () => fetchMessageTemplates(query),
    placeholderData: (prev) => prev,
    enabled: !!me?.user,
    staleTime: 5 * 60 * 1000,
  })
}

// Invalida toda a árvore de templates — listagens com filtros distintos são
// keys diferentes e todas precisam reidratar após mutation. Cheap: pageSize
// padrão é 20 e a única consumer (página de admin) está visível.
function invalidateAll(
  queryClient: ReturnType<typeof useQueryClient>,
): void {
  queryClient.invalidateQueries({ queryKey: MESSAGE_TEMPLATES_QUERY_KEY })
}

export function useCreateMessageTemplate() {
  const queryClient = useQueryClient()
  return useMutation<MessageTemplate, Error, CreateMessageTemplateInput>({
    mutationFn: (input) => createMessageTemplate(input),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export interface UpdateMessageTemplateArgs {
  id: string
  input: UpdateMessageTemplateInput
}

export function useUpdateMessageTemplate() {
  const queryClient = useQueryClient()
  return useMutation<MessageTemplate, Error, UpdateMessageTemplateArgs>({
    mutationFn: ({ id, input }) => updateMessageTemplate(id, input),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export function useDeactivateMessageTemplate() {
  const queryClient = useQueryClient()
  return useMutation<MessageTemplate, Error, string>({
    mutationFn: (id) => deactivateMessageTemplate(id),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export function useActivateMessageTemplate() {
  const queryClient = useQueryClient()
  return useMutation<MessageTemplate, Error, string>({
    mutationFn: (id) => activateMessageTemplate(id),
    onSuccess: () => invalidateAll(queryClient),
  })
}

export function useDeleteMessageTemplate() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => deleteMessageTemplate(id),
    onSuccess: () => invalidateAll(queryClient),
  })
}
