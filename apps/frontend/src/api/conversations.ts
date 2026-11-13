import { chatApi } from '@/api/client'
import type { JourneyStage } from '@/api/journeys'
import type { LeadSubstage } from '@/api/leads'

// Espelha ConversationWithClient do backend
// (apps/chat/src/modules/conversations/ConversationsTypes.ts).
// Agregados (unreadCount/lastMessagePreview/lastMessageDirection) vêm
// computados no SQL — ver ConversationsQuery.findPaginated.
export interface Conversation {
  id: string
  tenantId: string
  clientId: string
  // Canal específico — cada conv é por par (cliente, canal). Mesma pessoa
  // que falou com 2 números da clínica vira 2 conversations distintas.
  whatsappChannelId: string
  lastMessageAt: string | null
  lastStaffSeenAt: string | null
  createdAt: string
  updatedAt: string
  client: {
    id: string
    name: string
    phoneE164: string
    isVip: boolean
  }
  channel: {
    id: string
    name: string
    // Hex `#RRGGBB` ou null. Frontend usa pra colorir cards.
    color: string | null
    // Track do provider — frontend usa pra decidir composer (Cloud=swap
    // pra templates fora da janela 24h; Baileys=composer livre sempre).
    providerType: 'baileys' | 'meta_cloud' | 'mock' | string
  }
  // ID do whatsapp_contact (par client×channel). Frontend usa pra resolver
  // foto de perfil via GET /whatsapp/contacts/:id/profile-picture-url.
  // Null em casos extremos (conv criada sem inbound prévio).
  whatsappContactId: string | null
  unreadCount: number
  lastMessagePreview: string | null
  lastMessageDirection: 'inbound' | 'outbound' | 'internal_note' | null
  // Kind da última mensagem. Frontend usa pra montar preview adequado
  // quando `lastMessagePreview` é null (mídia sem caption, sticker, call).
  lastMessageKind:
    | 'text'
    | 'media'
    | 'template'
    | 'system'
    | 'sticker'
    | 'call'
    | null
  // Tipo da mídia (só relevante quando kind='media').
  lastMessageMediaType:
    | 'image'
    | 'audio'
    | 'video'
    | 'document'
    | 'sticker'
    | null
  // Último inbound do WhatsApp (whatsapp_conversations.last_inbound_at).
  // Frontend usa pra calcular a janela de 24h. Quando o delta excede 24h
  // (ou é null), o composer troca de texto livre pra seletor de templates.
  lastInboundAt: string | null
  // Stage da journey ativa do cliente. Null quando não tem journey ativa.
  // UI usa pra exibir chip de estado do funil na sidebar de conversas.
  currentJourneyStage: JourneyStage | null
  // Substage da journey ativa quando stage='lead'. Null nos demais stages
  // ou sem journey. UI prefere o chip de substage ao chip genérico "Lead".
  currentLeadSubstage: LeadSubstage | null
}

export interface FindConversationsQuery {
  page?: number
  pageSize?: number
  q?: string
  hasMessages?: boolean
}

export interface PaginatedConversations {
  items: Conversation[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function fetchConversations(
  query: FindConversationsQuery = {},
): Promise<PaginatedConversations> {
  const res = await chatApi.get<PaginatedConversations>('/conversations', {
    params: query,
  })
  return res.data
}

export async function fetchConversationById(id: string): Promise<Conversation> {
  const res = await chatApi.get<Conversation>(`/conversations/${id}`)
  return res.data
}

// Marca a conversa como lida (zera unreadCount). V1: semântica global —
// qualquer staff abrir zera pra todos os usuários do tenant.
export async function markConversationSeen(id: string): Promise<void> {
  await chatApi.post(`/conversations/${id}/mark-seen`)
}

// Find-or-create: retorna a conversation existente do par (cliente, canal)
// ou cria uma nova. Usado pra "abrir chat com cliente" antes de qualquer
// inbound — ex.: clica no ícone do cliente na lista, ele tem contact mas
// nunca conversou. Resposta base (sem campos enriquecidos da listagem).
export interface FindOrCreateConversationInput {
  clientId: string
  // Opcional: sem ele o backend escolhe (canal do contato do cliente, canal
  // onde já conversa, ou o canal ativo mais antigo).
  whatsappChannelId?: string
}

export interface ConversationBase {
  id: string
  tenantId: string
  clientId: string
  whatsappChannelId: string
  lastMessageAt: string | null
  lastStaffSeenAt: string | null
  createdAt: string
  updatedAt: string
}

export async function findOrCreateConversation(
  input: FindOrCreateConversationInput,
): Promise<ConversationBase> {
  const res = await chatApi.post<ConversationBase>('/conversations', input)
  return res.data
}
