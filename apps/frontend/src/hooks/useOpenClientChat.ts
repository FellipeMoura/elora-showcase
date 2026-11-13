import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchClientById } from '@/api/clients'
import { findOrCreateConversation } from '@/api/conversations'
import { openChatConversation } from '@/lib/chatBridge'
import { CLIENTS_QUERY_KEY, clientByIdKey } from './useClients'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// useOpenClientChat — abre o FloatingChatWindow na conversa de um cliente a
// partir do seu `clientId`. Encapsula o fluxo canônico (resolve conversa, cria
// lazy se necessário, abre via chatBridge) pra ser reusado fora da tela de
// clientes (ex: seção de contratos da venda). Espelha o `handleOpenChat` da
// ClientsPage, mas keyed por clientId — telas de contrato só têm o id, não o
// Client completo com `conversationId`/`whatsappChannelId`.
// =====================================================================

export function useOpenClientChat() {
  const queryClient = useQueryClient()
  // Cliente cujo chat está abrindo agora — pra spinner + bloquear duplo-clique.
  const [openingFor, setOpeningFor] = useState<string | null>(null)

  // `draftText` opcional pré-preenche o composer da conversa (ex: link de
  // contrato pronto pra enviar).
  const openClientChat = async (
    clientId: string,
    draftText?: string,
  ): Promise<void> => {
    setOpeningFor(clientId)
    try {
      // Busca o cliente (cache do react-query se já carregado) pra resolver
      // conversa/canal — o Contract só carrega {id, name, phoneE164}.
      const client = await queryClient.fetchQuery({
        queryKey: clientByIdKey(clientId),
        queryFn: () => fetchClientById(clientId),
      })

      if (client.conversationId) {
        openChatConversation(client.conversationId, draftText)
        return
      }
      // Conversa ainda não existe — cria lazy. Sem contato WhatsApp (cliente
      // cadastrado à mão), o backend escolhe o canal e o worker cria o
      // contato no primeiro envio (nasce sem opt-in → bolha no_opt_in).
      const conv = await findOrCreateConversation({
        clientId,
        whatsappChannelId: client.whatsappChannelId ?? undefined,
      })
      // Refresca pra próxima vez já vir com conversationId populado.
      queryClient.invalidateQueries({ queryKey: CLIENTS_QUERY_KEY })
      openChatConversation(conv.id, draftText)
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Não foi possível abrir a conversa.')
    } finally {
      setOpeningFor(null)
    }
  }

  return { openClientChat, openingFor }
}
