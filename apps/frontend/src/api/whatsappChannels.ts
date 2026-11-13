import { chatApi } from '@/api/client'

// Espelha WhatsappChannel + schemas auxiliares do backend
// (apps/chat/src/modules/whatsappChannels/WhatsappChannelsTypes.ts).
// `providerConfig` é record livre — o EvolutionAdapter valida o shape quando
// for usar. Em canal Mock: `{ mock: true }`. Em canal real provisionado:
// `{ baseUrl, instanceName, apiKey, integration, webhookToken }`.
export type ProviderType = 'baileys' | 'meta_cloud'

export interface WhatsappChannel {
  id: string
  tenantId: string
  name: string
  providerType: ProviderType
  providerConfig: Record<string, unknown>
  phoneNumber: string | null
  active: boolean
  // Estado do socket reportado pelo provider (CONNECTION_UPDATE no Evolution).
  // null = nunca recebemos evento (recém-provisionado, mock, ou pré-feature).
  // String solta pra não restringir contrato; trate desconhecidos como 'unknown'.
  connectionState: 'open' | 'connecting' | 'closed' | 'unknown' | null
  connectionStateAt: string | null
  // Hex `#RRGGBB` ou null. UI usa pra diferenciar conversas do canal.
  color: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateChannelInput {
  name: string
  providerType: ProviderType
  providerConfig?: Record<string, unknown>
  phoneNumber?: string
  color?: string
}

export interface UpdateChannelInput {
  name?: string
  providerType?: ProviderType
  providerConfig?: Record<string, unknown>
  phoneNumber?: string | null
  color?: string | null
}

export interface FindChannelsQuery {
  page?: number
  pageSize?: number
  q?: string
  providerType?: ProviderType
  status?: 'active' | 'inactive' | 'all'
}

export interface PaginatedChannels {
  items: WhatsappChannel[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ChannelQrCode {
  base64: string | null
  pairingCode?: string
}

export type ConnectionStateName = 'open' | 'connecting' | 'closed' | 'unknown'

export interface ChannelConnectionState {
  state: ConnectionStateName
  raw: Record<string, unknown>
}

export async function fetchChannels(
  query: FindChannelsQuery = {},
): Promise<PaginatedChannels> {
  const res = await chatApi.get<PaginatedChannels>('/whatsapp/channels', {
    params: query,
  })
  return res.data
}

export async function fetchChannelById(id: string): Promise<WhatsappChannel> {
  const res = await chatApi.get<WhatsappChannel>(`/whatsapp/channels/${id}`)
  return res.data
}

export async function createChannel(
  input: CreateChannelInput,
): Promise<WhatsappChannel> {
  const res = await chatApi.post<WhatsappChannel>('/whatsapp/channels', input)
  return res.data
}

export async function updateChannel(
  id: string,
  input: UpdateChannelInput,
): Promise<WhatsappChannel> {
  const res = await chatApi.patch<WhatsappChannel>(
    `/whatsapp/channels/${id}`,
    input,
  )
  return res.data
}

export async function deleteChannel(id: string): Promise<void> {
  await chatApi.delete(`/whatsapp/channels/${id}`)
}

export interface PurgeChannelConversationsResult {
  conversations: number
  messages: number
  contacts: number
  whatsappMessages: number
}

// Hard delete de conversas, mensagens e contatos do canal. Irreversível.
export async function purgeChannelConversations(
  id: string,
): Promise<PurgeChannelConversationsResult> {
  const res = await chatApi.post<PurgeChannelConversationsResult>(
    `/whatsapp/channels/${id}/purge-conversations`,
  )
  return res.data
}

export async function activateChannel(id: string): Promise<WhatsappChannel> {
  const res = await chatApi.post<WhatsappChannel>(
    `/whatsapp/channels/${id}/activate`,
  )
  return res.data
}

export async function deactivateChannel(id: string): Promise<WhatsappChannel> {
  const res = await chatApi.post<WhatsappChannel>(
    `/whatsapp/channels/${id}/deactivate`,
  )
  return res.data
}

// Idempotente — chamadas repetidas retornam o mesmo canal sem reprovisionar.
// Falha 409 se canal é Mock (`provider_config.mock === true`).
export async function provisionChannel(id: string): Promise<WhatsappChannel> {
  const res = await chatApi.post<WhatsappChannel>(
    `/whatsapp/channels/${id}/provision`,
  )
  return res.data
}

// `base64=null` quando a instância já está conectada — UI deve consultar
// connection-state em paralelo pra confirmar.
export async function fetchChannelQrCode(id: string): Promise<ChannelQrCode> {
  const res = await chatApi.get<ChannelQrCode>(`/whatsapp/channels/${id}/qr`)
  return res.data
}

export async function fetchChannelConnectionState(
  id: string,
): Promise<ChannelConnectionState> {
  const res = await chatApi.get<ChannelConnectionState>(
    `/whatsapp/channels/${id}/connection-state`,
  )
  return res.data
}

// Helper UI: detecta se canal já foi provisionado (tem instância Evolution
// associada). Mock channels têm `mock: true`; provisionados têm `instanceName`.
export function isChannelProvisioned(channel: WhatsappChannel): boolean {
  const cfg = channel.providerConfig
  return (
    typeof cfg.instanceName === 'string' &&
    typeof cfg.apiKey === 'string'
  )
}

export function isChannelMock(channel: WhatsappChannel): boolean {
  return channel.providerConfig.mock === true
}
