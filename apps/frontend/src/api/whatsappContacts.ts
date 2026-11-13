import { chatApi } from '@/api/client'

// Espelha whatsappContactResponseSchema do backend
// (apps/chat/src/modules/whatsappContacts/WhatsappContactsTypes.ts).
export interface WhatsappContact {
  id: string
  tenantId: string
  whatsappChannelId: string
  clientId: string | null
  phoneE164: string
  whatsappE164: string | null
  profileName: string | null
  // ObjectKey do MinIO. Pra renderizar, use
  // GET /whatsapp/contacts/:id/profile-picture-url (presigned URL).
  profilePictureUrl: string | null
  optedInAt: string | null
  optInSource: string | null
  createdAt: string
  updatedAt: string
}

export interface ProfilePictureUrlResponse {
  // Null quando contato não tem foto persistida.
  url: string | null
  expiresInSec: number
}

export async function fetchWhatsappContact(id: string): Promise<WhatsappContact> {
  const res = await chatApi.get<WhatsappContact>(`/whatsapp/contacts/${id}`)
  return res.data
}

// Espelha updateContactSchema. Usado pra correções de admin: registrar
// opt-in manualmente (cliente assinou formulário, autorização verbal,
// etc.), linkar com cliente, atualizar nome.
export interface UpdateWhatsappContactInput {
  clientId?: string | null
  profileName?: string | null
  // ISO datetime. `null` limpa o opt-in (raríssimo).
  optedInAt?: string | null
  optInSource?: string | null
}

export async function updateWhatsappContact(
  id: string,
  input: UpdateWhatsappContactInput,
): Promise<WhatsappContact> {
  const res = await chatApi.patch<WhatsappContact>(
    `/whatsapp/contacts/${id}`,
    input,
  )
  return res.data
}

export async function fetchContactProfilePictureUrl(
  contactId: string,
): Promise<ProfilePictureUrlResponse> {
  const res = await chatApi.get<ProfilePictureUrlResponse>(
    `/whatsapp/contacts/${contactId}/profile-picture-url`,
  )
  return res.data
}

// Re-fetch da foto: dispara `getProfilePicture` no provider, baixa, salva
// no MinIO. Sobrescreve a anterior. Quando contato sem foto, devolve
// profilePictureUrl=null no contact.
export async function refreshContactProfilePicture(
  contactId: string,
): Promise<WhatsappContact> {
  const res = await chatApi.post<WhatsappContact>(
    `/whatsapp/contacts/${contactId}/refresh-profile-picture`,
  )
  return res.data
}

// Verifica se número responde no WhatsApp via canal default do tenant.
// Usado pelo cadastro pra feedback em tempo real. `reason='no_channel'`
// significa que o tenant ainda não cadastrou canal — frontend trata como
// warning (cliente é criado sem contact).
//
// `whatsappE164` é o número que o WhatsApp efetivamente reconhece — pode
// diferir do consultado por causa da quirk BR (celular cadastrado sem o
// nono dígito). Frontend propaga pro create lead pra evitar novo probe no
// backend.
export interface CheckNumberResponse {
  onWhatsApp: boolean
  whatsappE164: string | null
  checkedAt: string
  reason?: 'no_channel' | 'provider_error'
}

export async function checkWhatsappNumber(
  phoneE164: string,
): Promise<CheckNumberResponse> {
  const res = await chatApi.get<CheckNumberResponse>(
    '/whatsapp/numbers/check',
    { params: { phoneE164 } },
  )
  return res.data
}
