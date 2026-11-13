import { createElement, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useMe } from '@/hooks/useMe'
import { useEffectivePreferences } from '@/hooks/useMyPreferences'
import { fetchConversationById } from '@/api/conversations'
import { RichNotification } from '@/components/notifications/RichNotification'
import {
  connectSocket,
  disconnectSocket,
  getSocket,
} from '@/lib/socket'
import { playLeadSound, playMessageSound } from '@/lib/notificationSound'
import { useChatStore } from '@/stores/chatStore'

// =====================================================================
// Hook que liga o socket.io ao chatStore. **Montar uma única vez** no
// ChatRealtimeBoot — múltiplas instâncias duplicariam events.
//
// Notificações ricas:
//   - Mensagens WhatsApp em conversa existente → variant 'message'
//   - Inbound WhatsApp que NASCE com journey ativa nova (`isNewLead=true`)
//     → variant 'lead-whatsapp' (mescla msg + lead, evita dupla notificação)
//   - Lead via canal não-WhatsApp (form/sheets/recycling/other) → variant 'lead'
//
// Posição visual: bottom-right (Toaster dedicado em App.tsx). Som via
// Web Audio API gerada — sem dep de asset estático. Tudo silenciado quando
// `chatNotificationLevel='quiet'`.
// =====================================================================

interface WhatsappMessageReceivedEvent {
  tenantId: string
  channelId: string
  conversationId: string
  messageId: string
  clientId: string
  receivedAt: string
  // Espelha o contrato em packages/events-contracts. True quando este
  // inbound nasceu junto com a journey ativa do cliente (criação ou reabertura
  // de 'lost'). Determina variant da notificação ('message' vs 'lead-whatsapp').
  isNewLead: boolean
}

interface WhatsappMessageSentEvent {
  tenantId: string
  channelId: string
  conversationId: string
  messageId: string
  clientId: string
  // Null quando `authoredOnDevice=true` (staff respondeu pelo celular).
  authorUserId: string | null
  authoredOnDevice: boolean
  sentAt: string
}

interface WhatsappChannelConnectionChangedEvent {
  tenantId: string
  channelId: string
  state: string
  changedAt: string
}

// Mensagem revogada (apagada). Mesmo payload pra staff e cliente — UI
// distingue pelo `origin`. Atualiza a UI da bolha sem refetch da página
// inteira; basta invalidar a lista de mensagens da conv afetada.
interface WhatsappMessageRevokedEvent {
  tenantId: string
  channelId: string
  conversationId: string
  messageId: string
  origin: 'staff' | 'client' | 'system'
  deletedAt: string
}

// Tiques de entregue/lido (delivered/read) vindos do provider. Só chega
// quando a mensagem tem bolha domain — o payload traz a conversa.
interface WhatsappStatusUpdatedEvent {
  tenantId: string
  channelId: string
  conversationId: string
  whatsappMessageId: string
  externalId: string
  status: string
  updatedAt: string
}

// Bolha pending inserida no backend antes do envio real (outbound da UI).
// Pra OUTRAS abas/devices do mesmo staff: invalida cache pra ver a bolha
// aparecer com spinner. A aba que disparou o POST já recebeu a row no
// onSuccess do useSendMessage — invalidate aqui é idempotente nela.
interface MessageCreatedEvent {
  tenantId: string
  channelId: string
  conversationId: string
  messageId: string
  clientId: string
  authorUserId: string | null
  createdAt: string
}

// Transição de delivery_status (pending → sent/failed/rejected). Worker
// publica quando o resultado do envio é conhecido. UI atualiza badge da
// bolha (spinner some, vira check ou alerta laranja). `failureReason` só
// preenchido em failed/rejected — frontend mapeia pra label PT-BR.
interface WhatsappMessageStatusChangedEvent {
  tenantId: string
  channelId: string
  conversationId: string
  messageId: string
  deliveryStatus: 'pending' | 'sent' | 'failed' | 'rejected'
  failureReason: string | null
  updatedAt: string
}

// Lead criado via canal NÃO-WhatsApp. WhatsApp não emite — pipeline inbound
// já dispara wa.message.received com `isNewLead=true`, que renderiza a
// notificação mesclada (variant 'lead-whatsapp').
interface LeadCreatedEvent {
  tenantId: string
  journeyId: string
  clientId: string
  clientName: string
  source: 'form' | 'sheets' | 'manual' | 'recycling' | 'imported' | 'other'
  createdAt: string
}

// Status do ciclo de assinatura mudou (viewed/signed/declined/expired) —
// espelha ContractStatusChangedEvent em @elora/events-contracts. Snapshot
// de clientName + contractTitle vem no payload pra UI montar toast sem
// fetch extra. `viewed` e `expired` chegam pra atualizar a lista mas não
// disparam toast (baixo valor; viewed flooda; expired é raro e silencioso
// faz mais sentido — operadora vê no refetch).
interface ContractStatusChangedEvent {
  tenantId: string
  contractId: string
  clientId: string
  clientName: string
  contractTitle: string
  status: 'viewed' | 'signed' | 'declined' | 'expired'
  changedAt: string
}

// Cliente assinou presença num link público — cobre N sessões do mesmo dia.
interface ProcedureSessionAttendanceRecordedEvent {
  tenantId: string
  attendanceId: string
  clientId: string
  attendanceDate: string
  signedSessionIds: string[]
  signedAt: string
}

// Aplicadora encerrou a evolução clínica de uma sessão (`signed → done`).
interface ProcedureSessionEvolvedEvent {
  tenantId: string
  sessionId: string
  clientId: string
  evolvedAt: string
  evolvedByUserId: string
  treatmentCompleted: boolean
}

// Sources que disparam notificação rica quando lead novo aparece. `manual`
// fica de fora porque quem cadastra já vê o toast da própria mutation
// (success); `imported` fica de fora porque sync em massa geraria spam —
// invalidação do badge roda pros dois, só a notificação é gated.
const NOTIFY_SOURCES: ReadonlySet<LeadCreatedEvent['source']> = new Set([
  'form',
  'sheets',
  'recycling',
  'other',
])

export function useChatRealtime(): void {
  const { data: me } = useMe()
  const user = me?.user
  const prefs = useEffectivePreferences()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  // Refs pra valores que mudam mas o listener precisa ler "atual" no
  // disparo. Sem isso, fechamento captura valor antigo.
  const prefsRef = useRef(prefs)
  const navigateRef = useRef(navigate)
  useEffect(() => {
    prefsRef.current = prefs
    navigateRef.current = navigate
  }, [prefs, navigate])
  const storeRef = useRef(useChatStore)

  useEffect(() => {
    // Sem usuário autenticado, nada acontece. Logout limpa tudo.
    if (!user) {
      disconnectSocket()
      storeRef.current.getState().reset()
      return
    }

    const socket = connectSocket()

    async function onMessageReceived(
      payload: WhatsappMessageReceivedEvent,
    ): Promise<void> {
      // Tipagem permissiva por causa de socket.io — `unknown` no contrato
      // do server. Defensiva mínima: precisamos do conversationId.
      if (!payload || typeof payload.conversationId !== 'string') return

      const store = storeRef.current.getState()

      // Invalida caches. Se a flutuante ativa é dessa conversa, o hook
      // de mensagens vai refetch — mensagem aparece automaticamente.
      // A invalidação de 'conversations' também faz a CHAT sidebar e o
      // total unread (alimentado pelo ChatRealtimeBoot) atualizarem.
      // `leads` invalidado porque inbound pode mudar o substage da journey
      // (template → contact, ou nascimento de novo lead via WhatsApp).
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({
        queryKey: ['conversation', payload.conversationId, 'messages'],
      })
      queryClient.invalidateQueries({ queryKey: ['leads'] })

      const isActive =
        store.floating.open &&
        store.floating.conversationId === payload.conversationId

      // Conversa ativa: invalidate já faz a UI mostrar a mensagem,
      // mark-seen mantém unread=0. Sem notificação, sem som, sem badge.
      if (isActive) return

      // Incrementa contador local pro badge ficar reativo antes da
      // refetch da lista chegar. O ChatRealtimeBoot vai reconciliar com
      // a soma real assim que o refetch resolver.
      store.setTotalUnread(store.totalUnread + 1)

      const level = prefsRef.current.chatNotificationLevel
      if (level === 'quiet') return

      // Aggressive: abre a conversa direto — sem notificação visual nem som
      // (a abertura é o feedback). Mantém comportamento histórico.
      if (level === 'aggressive') {
        try {
          const conv = await fetchConversationById(payload.conversationId)
          store.openConversation(conv.id)
        } catch {
          // Conversa pode ter sido deletada / sem permissão. Ignore.
        }
        return
      }

      // Medium: notificação rica + som. Fetch enriquecido pra ter foto,
      // nome e preview. Silenciosamente ignora falha — badge já incrementou.
      try {
        const conv = await fetchConversationById(payload.conversationId)
        const preview =
          conv.lastMessagePreview ?? previewFallback(conv.lastMessageKind)

        if (payload.isNewLead) {
          playLeadSound()
          toast.custom(
            (id) =>
              createElement(RichNotification, {
                variant: 'lead-whatsapp',
                contactId: conv.whatsappContactId,
                clientId: conv.client.id,
                clientName: conv.client.name,
                preview,
                isoTime: payload.receivedAt,
                journeyStage: conv.currentJourneyStage,
                leadSubstage: conv.currentLeadSubstage,
                action: {
                  label: 'Abrir conversa',
                  onClick: () =>
                    storeRef.current.getState().openConversation(conv.id),
                },
                onDismiss: () => toast.dismiss(id),
              }),
            { duration: 10_000, position: 'bottom-right' },
          )
        } else {
          playMessageSound()
          toast.custom(
            (id) =>
              createElement(RichNotification, {
                variant: 'message',
                contactId: conv.whatsappContactId,
                clientId: conv.client.id,
                clientName: conv.client.name,
                preview,
                isoTime: payload.receivedAt,
                journeyStage: conv.currentJourneyStage,
                leadSubstage: conv.currentLeadSubstage,
                action: {
                  label: 'Responder',
                  onClick: () =>
                    storeRef.current.getState().openConversation(conv.id),
                },
                onDismiss: () => toast.dismiss(id),
              }),
            { duration: 7_000, position: 'bottom-right' },
          )
        }
      } catch {
        // Conversa pode ter sido deletada / sem permissão. Ignore.
      }
    }

    async function onMessageSent(
      payload: WhatsappMessageSentEvent,
    ): Promise<void> {
      // Mensagem outbound (UI desta sessão, outra aba/device, OU staff
      // respondendo pelo celular pareado). Sem badge/notif — é a equipe
      // que mandou, não tem novidade pra notificar.
      if (!payload || typeof payload.conversationId !== 'string') return
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({
        queryKey: ['conversation', payload.conversationId, 'messages'],
      })
      // Outbound também muda substage (template enviado pode mudar lead pra
      // 'template'; resposta após inbound pode levar de 'contact' a outras
      // etapas conforme cascata).
      queryClient.invalidateQueries({ queryKey: ['leads'] })
    }

    function onChannelConnectionChanged(
      payload: WhatsappChannelConnectionChangedEvent,
    ): void {
      // Estado do socket WhatsApp do canal mudou. Invalida o cache da lista
      // de canais — UI atualiza badge de conexão sem polling. Backend já
      // garante dedup (UPDATE só dispara quando state realmente muda).
      if (!payload || typeof payload.channelId !== 'string') return
      queryClient.invalidateQueries({ queryKey: ['whatsappChannels'] })
    }

    function onMessageRevoked(payload: WhatsappMessageRevokedEvent): void {
      // Mensagem foi apagada (cliente OU staff de outra aba/device). UI
      // atualiza a bolha pra estado "apagada" via refetch. Sem notif aqui:
      // a notificação visual é a própria bolha mudando.
      if (!payload || typeof payload.conversationId !== 'string') return
      queryClient.invalidateQueries({
        queryKey: ['conversation', payload.conversationId, 'messages'],
      })
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
    }

    function onStatusUpdated(payload: WhatsappStatusUpdatedEvent): void {
      // Entregue/lido: refetch só das mensagens da conversa (tiques).
      if (!payload || typeof payload.conversationId !== 'string') return
      queryClient.invalidateQueries({
        queryKey: ['conversation', payload.conversationId, 'messages'],
      })
    }

    function onLeadCreated(payload: LeadCreatedEvent): void {
      // Lead via canal NÃO-WhatsApp (helper backend `createExternalLead`).
      // Sempre invalida pra badge do menu + board atualizarem em todas as
      // abas/devices. Notif só pras sources interessantes — manual cobre
      // via mutation success local, imported viraria spam em sync massa.
      if (!payload || typeof payload.journeyId !== 'string') return
      queryClient.invalidateQueries({ queryKey: ['leads'] })

      if (!NOTIFY_SOURCES.has(payload.source)) return
      const level = prefsRef.current.chatNotificationLevel
      if (level === 'quiet') return

      playLeadSound()
      toast.custom(
        (id) =>
          createElement(RichNotification, {
            variant: 'lead',
            source: payload.source,
            clientId: payload.clientId,
            clientName: payload.clientName,
            isoTime: payload.createdAt,
            // Lead non-WhatsApp via createExternalLead nasce sempre stage='lead'
            // substage='new'. Hardcoded — não há fetch da journey aqui.
            journeyStage: 'lead',
            leadSubstage: 'new',
            action: {
              label: 'Abrir leads',
              onClick: () => navigateRef.current('/leads'),
            },
            onDismiss: () => toast.dismiss(id),
          }),
        { duration: 10_000, position: 'bottom-right' },
      )
    }

    function onMessageCreated(payload: MessageCreatedEvent): void {
      // Bolha pending recém-inserida pelo backend. Invalida cache da conv
      // pra UI mostrar a bolha com spinner. Sem badge/notif — é uma sessão
      // do mesmo tenant que mandou (se for a própria, já viu via onSuccess).
      if (!payload || typeof payload.conversationId !== 'string') return
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({
        queryKey: ['conversation', payload.conversationId, 'messages'],
      })
    }

    function onContractStatusChanged(payload: ContractStatusChangedEvent): void {
      // Contrato mudou de status no provider de assinatura. Sempre invalida
      // — ContractsPage / ClientContractsSection refletem em tempo real
      // sem polling. Toast só em transições de alto valor (signed/declined);
      // viewed e expired são silenciosos (viewed flooda; expired é raro e o
      // refetch já mostra). `quiet` silencia tudo.
      if (!payload || typeof payload.contractId !== 'string') return
      queryClient.invalidateQueries({ queryKey: ['contracts'] })

      const level = prefsRef.current.chatNotificationLevel
      if (level === 'quiet') return
      if (payload.status !== 'signed' && payload.status !== 'declined') return

      if (payload.status === 'signed') {
        toast.success(
          `${payload.clientName} assinou o contrato "${payload.contractTitle}"`,
          {
            duration: 8000,
            position: 'bottom-right',
            action: {
              label: 'Ver contratos',
              onClick: () => navigateRef.current('/contracts'),
            },
          },
        )
      } else {
        toast.error(
          `${payload.clientName} recusou o contrato "${payload.contractTitle}"`,
          {
            duration: 8000,
            position: 'bottom-right',
            action: {
              label: 'Ver contratos',
              onClick: () => navigateRef.current('/contracts'),
            },
          },
        )
      }
    }

    function onMessageStatusChanged(payload: WhatsappMessageStatusChangedEvent): void {
      // Bolha mudou de estado (pending → sent/failed/rejected). Invalida pra
      // refetch trazer deliveryStatus/failureReason atualizados. Sem notif
      // mesmo em falha — o motivo já fica visível na própria bolha laranja.
      if (!payload || typeof payload.conversationId !== 'string') return
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({
        queryKey: ['conversation', payload.conversationId, 'messages'],
      })
      // Lead substage pode mudar em sucesso de envio (outbound conta como
      // ação de staff — cascata de stage). Mesma invalidação que onMessageSent.
      if (payload.deliveryStatus === 'sent') {
        queryClient.invalidateQueries({ queryKey: ['leads'] })
      }
    }

    socket.on('wa.message.received', onMessageReceived)
    socket.on('wa.message.sent', onMessageSent)
    socket.on('wa.message.revoked', onMessageRevoked)
    socket.on('wa.status.updated', onStatusUpdated)
    socket.on('wa.channel.connection_changed', onChannelConnectionChanged)
    socket.on('lead.created', onLeadCreated)
    socket.on('message.created', onMessageCreated)
    socket.on('wa.message.status_changed', onMessageStatusChanged)
    socket.on('contract.status_changed', onContractStatusChanged)
    socket.on('procedure_session_attendance.recorded', onAttendanceRecorded)
    socket.on('procedure_session.evolved', onSessionEvolved)

    function onAttendanceRecorded(
      payload: ProcedureSessionAttendanceRecordedEvent,
    ): void {
      if (!payload || typeof payload.attendanceId !== 'string') return
      // Invalida caches que mostram status dessas sessões/appointments.
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['procedureSessions'] })
      queryClient.invalidateQueries({ queryKey: ['treatments'] })

      const level = prefsRef.current.chatNotificationLevel
      if (level === 'quiet') return

      const count = payload.signedSessionIds.length
      toast.success(
        count === 1
          ? 'Presença confirmada por assinatura'
          : `Presença confirmada (${count} sessões)`,
        { duration: 5000, position: 'bottom-right' },
      )
    }

    function onSessionEvolved(payload: ProcedureSessionEvolvedEvent): void {
      if (!payload || typeof payload.sessionId !== 'string') return
      // Invalida caches que mostram a sessão/treatment/journey/appointment.
      // Tudo precisa repintar — a sessão pode ter sido a última do
      // treatment e estar movendo a journey pra `result`.
      queryClient.invalidateQueries({ queryKey: ['procedureSessions'] })
      queryClient.invalidateQueries({ queryKey: ['treatments'] })
      queryClient.invalidateQueries({ queryKey: ['journeys'] })
      queryClient.invalidateQueries({ queryKey: ['appointments'] })

      const level = prefsRef.current.chatNotificationLevel
      if (level === 'quiet') return
      // Toast só quando o treatment fechou — evolução individual é ruído pra
      // operadores de fora da clínica/sessão. Quem evoluiu já viu o toast
      // local da própria mutation.
      if (payload.treatmentCompleted) {
        toast.success('Tratamento concluído', {
          duration: 5000,
          position: 'bottom-right',
        })
      }
    }

    return () => {
      socket.off('wa.message.received', onMessageReceived)
      socket.off('wa.message.sent', onMessageSent)
      socket.off('wa.message.revoked', onMessageRevoked)
      socket.off('wa.status.updated', onStatusUpdated)
      socket.off('wa.channel.connection_changed', onChannelConnectionChanged)
      socket.off('lead.created', onLeadCreated)
      socket.off('message.created', onMessageCreated)
      socket.off('wa.message.status_changed', onMessageStatusChanged)
      socket.off('contract.status_changed', onContractStatusChanged)
      socket.off('procedure_session_attendance.recorded', onAttendanceRecorded)
      socket.off('procedure_session.evolved', onSessionEvolved)
    }
  }, [user, queryClient])
}

// Preview fallback quando o body da última msg é null (mídia sem caption,
// sticker, call, etc.). Texto curto suficiente pra notificação — preview
// completa com ícone fica reservada à sidebar.
function previewFallback(
  kind:
    | 'text'
    | 'media'
    | 'template'
    | 'system'
    | 'sticker'
    | 'call'
    | null,
): string {
  switch (kind) {
    case 'media':
      return 'Mídia'
    case 'sticker':
      return 'Figurinha'
    case 'call':
      return 'Chamada'
    case 'template':
      return 'Template enviado'
    case 'system':
      return 'Mensagem do sistema'
    default:
      return 'Nova mensagem'
  }
}

// Helper exposto pra outros pontos do código (ex: AppShell pode chamar
// quando desmonta global): desconecta socket + zera store. Não usado pelo
// próprio useChatRealtime (que faz isso via efeito), mas útil pra logout
// explícito.
export function teardownChatRealtime(): void {
  disconnectSocket()
  useChatStore.getState().reset()
}

// Wrapper de debug — útil pra console durante desenvolvimento.
export function debugChatSocket(): { connected: boolean; id?: string } {
  const s = getSocket()
  return { connected: Boolean(s?.connected), id: s?.id }
}
