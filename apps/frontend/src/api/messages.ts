import { chatApi } from '@/api/client'

// Espelha o shape do backend (apps/chat/.../MessagesTypes.ts → messageResponseSchema).
//
// `mediaUrl` aqui é o objectKey do MinIO (caminho estável, NÃO URL de download).
// Pra exibir a mídia, chame GET /messages/:id/media-url e use a presigned URL
// retornada (TTL ~7d).
export interface Message {
  id: string
  tenantId: string
  conversationId: string
  journeyId: string | null
  direction: 'inbound' | 'outbound' | 'internal_note'
  kind: 'text' | 'media' | 'template' | 'system' | 'sticker' | 'call'
  body: string | null
  mediaUrl: string | null
  mediaType: 'image' | 'audio' | 'video' | 'document' | 'sticker' | null
  callPayload: CallPayload | null
  // Set quando staff editou (PATCH /messages/:id) ou quando cliente editou
  // pelo próprio app (webhook). UI exibe badge "editada".
  editedAt: string | null
  // Soft delete — staff revogou (`origin='staff'`) ou cliente apagou
  // (`origin='client'`). UI esconde body/mediaUrl e mostra notificação
  // com texto dependente do origin.
  deletedAt: string | null
  deletionOrigin: 'client' | 'staff' | 'system' | null
  templateId: string | null
  templateVariables: Record<string, string> | null
  whatsappMessageId: string | null
  // Id da msg citada (mesma conversa). Frontend resolve o snapshot a partir
  // do próprio cache da timeline — sem chamada extra. Null quando não é reply.
  replyToMessageId: string | null
  authorUserId: string | null
  // True quando a mensagem outbound foi disparada direto pelo celular
  // pareado em vez da UI do Elora. UI renderiza marcador visual diferente.
  authoredOnDevice: boolean
  // Estado de entrega (V2 do envio outbound — substitui o tempId optimistic).
  // 'pending' = INSERT feito mas worker ainda não confirmou; UI mostra spinner.
  // 'sent'    = adapter confirmou; checkmarks normais.
  // 'failed'  = adapter chamou e falhou; bolha laranja com botão "Tentar novamente".
  // 'rejected'= pre-flight bloqueou (sem opt-in, canal off etc); bolha laranja
  //             com botão "Corrigir <coisa>" — retry sem corrigir vai rejeitar de novo.
  deliveryStatus: 'pending' | 'sent' | 'failed' | 'rejected'
  failureReason: FailureReason | null
  failureDetail: Record<string, unknown> | null
  sentAt: string | null
  deliveredAt: string | null
  readAt: string | null
  createdAt: string
  updatedAt: string
}

// Lista fechada de motivos de falha — frontend mapeia pra label PT-BR + ação
// contextual. Categoria por reason:
//   rejected: no_opt_in, channel_disconnected, window_24h_expired,
//             invalid_template, rate_limited
//   failed:   provider_error, worker_timeout, unknown
export type FailureReason =
  | 'no_opt_in'
  | 'channel_disconnected'
  | 'window_24h_expired'
  | 'invalid_template'
  | 'rate_limited'
  | 'provider_error'
  | 'worker_timeout'
  | 'unknown'

export interface CallPayload {
  direction: 'inbound' | 'outbound'
  status: 'missed' | 'received' | 'declined'
  durationSec?: number
  startedAt: string
}

export interface FindMessagesQuery {
  page?: number
  pageSize?: number
  journeyId?: string
  visibility?: 'all' | 'public'
}

export interface PaginatedMessages {
  items: Message[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function fetchMessages(
  conversationId: string,
  query: FindMessagesQuery = {},
): Promise<PaginatedMessages> {
  const res = await chatApi.get<PaginatedMessages>(
    `/conversations/${conversationId}/messages`,
    { params: query },
  )
  return res.data
}

// Discriminated union de envio (POST /conversations/:id/messages). Espelha
// o `sendMessageSchema` do backend. UI só usa text/media V1; template é
// disparado por automação no backend, sem UI dedicada ainda.
export interface SendTextInput {
  kind: 'text'
  body: string
  journeyId?: string
  whatsappContactId?: string
  // Reply/quote — id de uma msg da mesma conversa. Backend valida que a alvo
  // tem whatsapp_message_id (sem isso, adapter não monta o quoted).
  replyToMessageId?: string
}

export interface SendMediaInput {
  kind: 'media'
  // ObjectKey retornado por POST /conversations/:id/upload-media.
  // NÃO é URL externa — todo arquivo passa pelo MinIO primeiro.
  mediaObjectKey: string
  mediaType: 'image' | 'audio' | 'video' | 'document'
  caption?: string
  journeyId?: string
  whatsappContactId?: string
  replyToMessageId?: string
}

// Envia template aprovado. Único caminho permitido pra iniciar conversa
// fora da janela de 24h (arquitetura.md §7.3). Variáveis `{{nome}}` no body
// do template viram os valores passados em `templateVariables`.
export interface SendTemplateInput {
  kind: 'template'
  templateId: string
  templateVariables?: Record<string, string>
  journeyId?: string
  whatsappContactId?: string
  replyToMessageId?: string
}

export type SendMessageInput =
  | SendTextInput
  | SendMediaInput
  | SendTemplateInput

export async function sendMessage(
  conversationId: string,
  input: SendMessageInput,
): Promise<Message> {
  const res = await chatApi.post<Message>(
    `/conversations/${conversationId}/messages`,
    input,
  )
  return res.data
}

// =====================================================================
// Upload de mídia (multipart) — etapa preliminar ao envio.
// Frontend faz upload primeiro pra receber objectKey + presigned URL
// (preview), depois confirma o envio com POST /messages passando o
// mediaObjectKey. Limite de 20MB por arquivo (backend).
// =====================================================================

export interface UploadMediaResponse {
  objectKey: string
  presignedUrl: string
  size: number
  mimeType: string
}

export async function uploadMedia(
  conversationId: string,
  file: File,
  options: { onProgress?: (loaded: number, total: number) => void } = {},
): Promise<UploadMediaResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await chatApi.post<UploadMediaResponse>(
    `/conversations/${conversationId}/upload-media`,
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: options.onProgress
        ? (evt) => {
            if (evt.total) options.onProgress!(evt.loaded, evt.total)
          }
        : undefined,
    },
  )
  return res.data
}

// =====================================================================
// Presigned download URL pra mídia já gravada.
// Backend devolve URL temporária do MinIO; cacheamos no client (staleTime
// alto no hook) porque TTL é de dias. Falha 400 quando msg não tem mídia.
// =====================================================================

export interface MediaUrlResponse {
  url: string
  expiresInSec: number
}

export async function fetchMessageMediaUrl(
  messageId: string,
): Promise<MediaUrlResponse> {
  const res = await chatApi.get<MediaUrlResponse>(
    `/messages/${messageId}/media-url`,
  )
  return res.data
}

// =====================================================================
// Edit / revoke
// =====================================================================

export async function editMessage(
  messageId: string,
  body: string,
): Promise<Message> {
  const res = await chatApi.patch<Message>(`/messages/${messageId}`, { body })
  return res.data
}

export async function revokeMessage(messageId: string): Promise<Message> {
  const res = await chatApi.delete<Message>(`/messages/${messageId}`)
  return res.data
}

// =====================================================================
// Retry — re-enfileira mensagem em estado `failed` ou `rejected`. Backend
// reseta deliveryStatus pra 'pending' e re-roda pre-flight. Se a causa do
// rejection não foi corrigida (ex: opt-in continua faltando), volta a
// `rejected`. UI deve mostrar isso ao operador via socket message_status.
// =====================================================================

export async function retryMessage(messageId: string): Promise<Message> {
  const res = await chatApi.post<Message>(`/messages/${messageId}/retry`)
  return res.data
}
