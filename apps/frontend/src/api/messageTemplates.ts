import { chatApi } from '@/api/client'
import type { JourneyStage } from '@/api/journeys'

// Espelha apps/chat/src/modules/messageTemplates/MessageTemplatesTypes.ts.
//
// `surfaceInStage` é uma lista de stages do journey onde o template é
// sugerido. UI do composer pode usar pra ranquear templates relevantes pro
// stage atual da conversa — V1 ignora e lista todos.
export interface MessageTemplate {
  id: string
  tenantId: string
  name: string
  body: string
  kind: 'text' | 'media'
  surfaceInStage: JourneyStage[] | null
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateMessageTemplateInput {
  name: string
  body: string
  kind?: 'text' | 'media'
  surfaceInStage?: JourneyStage[]
}

export interface UpdateMessageTemplateInput {
  name?: string
  body?: string
  kind?: 'text' | 'media'
  surfaceInStage?: JourneyStage[]
}

export interface FindMessageTemplatesQuery {
  page?: number
  pageSize?: number
  q?: string
  kind?: 'text' | 'media'
  stage?: string
  // 'active' (default), 'inactive' ou 'all'.
  status?: 'active' | 'inactive' | 'all'
}

export interface PaginatedMessageTemplates {
  items: MessageTemplate[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function fetchMessageTemplates(
  query: FindMessageTemplatesQuery = {},
): Promise<PaginatedMessageTemplates> {
  const res = await chatApi.get<PaginatedMessageTemplates>('/message-templates', {
    params: query,
  })
  return res.data
}

export async function fetchMessageTemplateById(
  id: string,
): Promise<MessageTemplate> {
  const res = await chatApi.get<MessageTemplate>(`/message-templates/${id}`)
  return res.data
}

export async function createMessageTemplate(
  input: CreateMessageTemplateInput,
): Promise<MessageTemplate> {
  const res = await chatApi.post<MessageTemplate>('/message-templates', input)
  return res.data
}

export async function updateMessageTemplate(
  id: string,
  input: UpdateMessageTemplateInput,
): Promise<MessageTemplate> {
  const res = await chatApi.patch<MessageTemplate>(
    `/message-templates/${id}`,
    input,
  )
  return res.data
}

export async function deactivateMessageTemplate(
  id: string,
): Promise<MessageTemplate> {
  const res = await chatApi.post<MessageTemplate>(
    `/message-templates/${id}/deactivate`,
  )
  return res.data
}

export async function activateMessageTemplate(
  id: string,
): Promise<MessageTemplate> {
  const res = await chatApi.post<MessageTemplate>(
    `/message-templates/${id}/activate`,
  )
  return res.data
}

export async function deleteMessageTemplate(id: string): Promise<void> {
  await chatApi.delete(`/message-templates/${id}`)
}

// Helper: extrai variáveis `{{nome}}` do body do template. Usado pelo
// composer pra renderizar inputs dinâmicos antes do envio. Ordem preservada,
// duplicatas removidas (uma var pode aparecer N vezes no body).
export function extractTemplateVariables(body: string): string[] {
  const regex = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g
  const seen = new Set<string>()
  const result: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(body)) !== null) {
    const name = match[1]
    if (name && !seen.has(name)) {
      seen.add(name)
      result.push(name)
    }
  }
  return result
}

// Renderiza o body do template substituindo as variáveis pelos valores.
// Variáveis ausentes em `values` ficam como `{{nome}}` (mesmo comportamento
// do backend em renderTemplate). Usado pra preview antes do envio.
export function renderTemplateBody(
  body: string,
  values: Record<string, string>,
): string {
  return body.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (full, name) => {
    const val = values[name]
    return val !== undefined && val !== '' ? val : full
  })
}
