import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  activateChannel,
  createChannel,
  deactivateChannel,
  deleteChannel,
  fetchChannelById,
  fetchChannelConnectionState,
  fetchChannelQrCode,
  fetchChannels,
  provisionChannel,
  purgeChannelConversations,
  updateChannel,
  type ChannelConnectionState,
  type ChannelQrCode,
  type CreateChannelInput,
  type FindChannelsQuery,
  type PaginatedChannels,
  type UpdateChannelInput,
  type WhatsappChannel,
} from '@/api/whatsappChannels'
import { CONVERSATIONS_QUERY_KEY } from '@/hooks/useConversations'

// Chave raiz dos canais — mutations invalidam por raiz pra pegar lista +
// detail + estado de conexão de uma vez.
export const WHATSAPP_CHANNELS_QUERY_KEY = ['whatsappChannels'] as const

export function channelsListKey(query: FindChannelsQuery) {
  return [...WHATSAPP_CHANNELS_QUERY_KEY, 'list', query] as const
}

export function channelByIdKey(id: string) {
  return [...WHATSAPP_CHANNELS_QUERY_KEY, 'detail', id] as const
}

export function channelQrCodeKey(id: string) {
  return [...WHATSAPP_CHANNELS_QUERY_KEY, 'qr', id] as const
}

export function channelConnectionStateKey(id: string) {
  return [...WHATSAPP_CHANNELS_QUERY_KEY, 'connectionState', id] as const
}

export function useWhatsappChannels(query: FindChannelsQuery) {
  return useQuery<PaginatedChannels, Error>({
    queryKey: channelsListKey(query),
    queryFn: () => fetchChannels(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useWhatsappChannel(id: string | undefined) {
  return useQuery<WhatsappChannel, Error>({
    queryKey: channelByIdKey(id ?? ''),
    queryFn: () => fetchChannelById(id as string),
    enabled: Boolean(id),
  })
}

export function useCreateWhatsappChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateChannelInput) => createChannel(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WHATSAPP_CHANNELS_QUERY_KEY })
    },
  })
}

export function useUpdateWhatsappChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateChannelInput }) =>
      updateChannel(id, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: WHATSAPP_CHANNELS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: channelByIdKey(vars.id) })
    },
  })
}

export function useDeleteWhatsappChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteChannel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WHATSAPP_CHANNELS_QUERY_KEY })
    },
  })
}

// Purge apaga conversas/contatos do canal — invalida tudo que mostra chat
// (lista de conversas, mensagens abertas, contatos).
export function usePurgeWhatsappChannelConversations() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => purgeChannelConversations(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: ['conversation'] })
      queryClient.invalidateQueries({ queryKey: ['whatsappContacts'] })
    },
  })
}

export function useActivateWhatsappChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => activateChannel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WHATSAPP_CHANNELS_QUERY_KEY })
    },
  })
}

export function useDeactivateWhatsappChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deactivateChannel(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: WHATSAPP_CHANNELS_QUERY_KEY })
    },
  })
}

export function useProvisionWhatsappChannel() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => provisionChannel(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: WHATSAPP_CHANNELS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: channelByIdKey(id) })
      // Provisionou agora — pareamento começa do zero. Força refetch do
      // QR e do estado pra UI atualizar imediatamente.
      queryClient.invalidateQueries({ queryKey: channelQrCodeKey(id) })
      queryClient.invalidateQueries({
        queryKey: channelConnectionStateKey(id),
      })
    },
  })
}

// Polling: QR muda a cada ~30s no Evolution. Atualizar a cada 5s mantém a
// UI fresca sem martelar o backend. Só ativa quando `enabled` (modal aberta
// e canal precisa pareamento) — desliga sozinho ao fechar.
export function useChannelQrCode(
  id: string | undefined,
  options: { enabled: boolean },
) {
  return useQuery<ChannelQrCode, Error>({
    queryKey: channelQrCodeKey(id ?? ''),
    queryFn: () => fetchChannelQrCode(id as string),
    enabled: Boolean(id) && options.enabled,
    refetchInterval: options.enabled ? 5000 : false,
    refetchOnWindowFocus: false,
  })
}

// Polling: estado de conexão muda no momento que o usuário escaneia o QR.
// 2s é agressivo o suficiente pra UI parecer "instantânea" no pareamento.
// Para quando connection-state vira `open` (handled fora — quem ativa o
// hook decide).
export function useChannelConnectionState(
  id: string | undefined,
  options: { enabled: boolean; intervalMs?: number },
) {
  return useQuery<ChannelConnectionState, Error>({
    queryKey: channelConnectionStateKey(id ?? ''),
    queryFn: () => fetchChannelConnectionState(id as string),
    enabled: Boolean(id) && options.enabled,
    refetchInterval: options.enabled ? (options.intervalMs ?? 2000) : false,
    refetchOnWindowFocus: false,
  })
}
