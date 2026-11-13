import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  fetchContactProfilePictureUrl,
  fetchWhatsappContact,
  refreshContactProfilePicture,
  updateWhatsappContact,
  type ProfilePictureUrlResponse,
  type UpdateWhatsappContactInput,
  type WhatsappContact,
} from '@/api/whatsappContacts'
import { CONVERSATIONS_QUERY_KEY } from './useConversations'

export function whatsappContactKey(contactId: string) {
  return ['whatsappContact', contactId, 'detail'] as const
}

export function contactProfilePictureUrlKey(contactId: string) {
  return ['whatsappContact', contactId, 'profile-picture-url'] as const
}

// Carrega detalhe do contato (inclui opted_in_at). Usado pelo TemplateComposer
// pra detectar se a conversa precisa registrar opt-in antes de mandar
// template — caso contrário o backend rejeita com 403.
export function useWhatsappContact(contactId: string | null | undefined) {
  return useQuery<WhatsappContact, Error>({
    queryKey: whatsappContactKey(contactId ?? ''),
    queryFn: () => fetchWhatsappContact(contactId as string),
    enabled: Boolean(contactId),
    staleTime: 60 * 1000,
  })
}

export interface UpdateWhatsappContactArgs {
  id: string
  input: UpdateWhatsappContactInput
}

// Patch de contato. Caminho principal pra registrar opt-in manualmente
// (cliente assinou formulário, autorização verbal, etc.). Invalida o detalhe
// e a listagem de conversations (mostra opt-in indicators em algumas views).
export function useUpdateWhatsappContact() {
  const queryClient = useQueryClient()
  return useMutation<WhatsappContact, Error, UpdateWhatsappContactArgs>({
    mutationFn: ({ id, input }) => updateWhatsappContact(id, input),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: whatsappContactKey(data.id) })
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY })
    },
  })
}

// Lazy fetch da URL presigned pra foto de perfil. ContactAvatar renderiza
// fallback (inicial) quando o componente é montado, e troca pela imagem
// quando a query resolve. staleTime longo porque a foto raramente muda
// — refresh manual via useRefreshContactProfilePicture invalida.
export function useContactProfilePictureUrl(
  contactId: string | null | undefined,
) {
  return useQuery<ProfilePictureUrlResponse, Error>({
    queryKey: contactProfilePictureUrlKey(contactId ?? ''),
    queryFn: () => fetchContactProfilePictureUrl(contactId as string),
    enabled: Boolean(contactId),
    // 10min: foto não muda toda hora; cache curto desperdiça API.
    staleTime: 10 * 60 * 1000,
    retry: 1,
  })
}

// Botão "atualizar foto" no admin / settings de contato dispara isso.
// Invalida a presigned URL pra refresh ser imediato na UI.
export function useRefreshContactProfilePicture(contactId: string | null | undefined) {
  const queryClient = useQueryClient()
  return useMutation<WhatsappContact, Error, void>({
    mutationFn: () => {
      if (!contactId) throw new Error('contactId obrigatório')
      return refreshContactProfilePicture(contactId)
    },
    onSuccess: () => {
      if (contactId) {
        queryClient.invalidateQueries({
          queryKey: contactProfilePictureUrlKey(contactId),
        })
      }
      // Listagens de contato e conversation (que mostram avatar) atualizam.
      queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY })
    },
  })
}
