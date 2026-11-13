import {
  AlertTriangle,
  Ban,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Image as ImageIcon,
  Loader2,
  Mic,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  RotateCw,
  ShieldCheck,
  Smartphone,
  Video,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import type { CallPayload, FailureReason, Message } from '@/api/messages'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { useRetryMessage } from '@/hooks/useConversationMessages'
import { useConversation } from '@/hooks/useConversations'
import {
  useUpdateWhatsappContact,
  useWhatsappContact,
} from '@/hooks/useWhatsappContacts'
import { cn } from '@/lib/utils'
import { MediaPreview } from './MediaPreview'
import { MessageActions } from './MessageActions'
import { MessageEditInline } from './MessageEditInline'
import { bubbleDomId, scrollToMessage } from '@/lib/chatMessageDom'
import { apiErrorText } from '@/lib/apiError'

interface MessageBubbleProps {
  message: Message
  // Quando presente, a bolha pode mostrar ações (editar/apagar) pra msgs
  // outbound não-deletadas. Quando ausente (ex: histórico só-leitura),
  // ações ficam escondidas.
  conversationId?: string
  // Resolve uma mensagem da mesma conversa pelo id — usado pelo QuotedSnippet
  // pra renderizar o stub do reply sem rede. Quando ausente (uso em viewport
  // simples), reply mostra fallback "mensagem indisponível".
  lookupMessage?: (id: string) => Message | undefined
}

// Renderiza um item da timeline. Casos:
// - internal_note: amber, centralizado (nota interna, não saiu)
// - call: notificação centralizada com ícone phone + status + duração
// - sticker: imagem solta (sem bolha) alinhada como inbound/outbound
// - deleted (deletedAt): bolha neutra com texto "esta msg foi apagada"
// - media (image/audio/video/document): MediaPreview dentro da bolha
// - text: bolha clássica
//
// `editedAt` adiciona badge "(editada)" no rodapé.
// Ícones de status (✓ enviado, ✓✓ entregue, ✓✓ azul lido) só em outbound.
export function MessageBubble({
  message,
  conversationId,
  lookupMessage,
}: MessageBubbleProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false)

  // Modo edit substitui completamente a bolha — caller fica com layout
  // preservado mas conteúdo mutável. Só ativa pra outbound text não-deletada
  // (MessageActions filtra antes de chamar onStartEdit).
  if (isEditing && conversationId) {
    return (
      <MessageEditInline
        message={message}
        conversationId={conversationId}
        onClose={() => setIsEditing(false)}
      />
    )
  }

  // Internal note: tem tratamento próprio, fora da paleta do chat.
  if (message.direction === 'internal_note') {
    return (
      <div className="my-2 flex justify-center">
        <div className="max-w-[80%] rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-center text-xs text-amber-900 dark:text-amber-100">
          📝 {message.body ?? '(nota sem texto)'}
        </div>
      </div>
    )
  }

  // Call: notificação centralizada, sem bolha clicável. Cor por status.
  if (message.kind === 'call') {
    return <CallNotification payload={message.callPayload} time={message.sentAt ?? message.createdAt} />
  }

  // Sticker: fora de bolha. Mantém alinhamento (esquerda/direita) pra UI
  // distinguir quem mandou, mas sem fundo nem padding.
  if (message.kind === 'sticker' && !message.deletedAt) {
    const isOutbound = message.direction === 'outbound'
    return (
      <div
        className={cn(
          'flex w-full',
          isOutbound ? 'justify-end' : 'justify-start',
        )}
      >
        <div className="flex flex-col items-end gap-0.5">
          <MediaPreview message={message} variant="standalone" />
          <span className="text-[10px] leading-none text-muted-foreground">
            {formatTime(message.sentAt ?? message.createdAt)}
          </span>
        </div>
      </div>
    )
  }

  const isOutbound = message.direction === 'outbound'
  // Outbound disparada direto pelo celular pareado (não pela UI do Elora).
  // Visual: mesma cor/lado (continua sendo "nossa" mensagem), mas com ícone
  // de smartphone na linha do timestamp pra deixar o canal explícito.
  const isOnDevice = isOutbound && message.authoredOnDevice
  const isDeleted = Boolean(message.deletedAt)
  // Bolha em estado terminal de não-envio. Diferencia visualmente:
  //   - `rejected` (pre-flight bloqueou) → amarelo soft → "atenção, precisa
  //      corrigir algo no setup antes que o retry funcione"
  //   - `failed` (adapter chamou e falhou) → vermelho soft → "falha externa,
  //      retry direto pode resolver"
  // Inbound/internal_note nunca caem aqui (status='sent' por construção).
  const isRejected = isOutbound && message.deliveryStatus === 'rejected'
  const isFailed = isOutbound && message.deliveryStatus === 'failed'
  const isStopped = isRejected || isFailed
  const time = formatTime(message.sentAt ?? message.createdAt)
  // Ações: aparece pra qualquer msg não-deletada com conversationId. O
  // próprio MessageActions decide o que mostrar dentro (Responder pra
  // qualquer com whatsappMessageId; Editar/Apagar só pra outbound). Bolha em
  // falha (rejected/failed) tampouco mostra menu — o que ela precisa é
  // correção/retry, ações que vivem na própria área de erro.
  const showActions = !isDeleted && !isStopped && Boolean(conversationId)

  // Resolve a alvo do reply pra renderizar o stub. Quando o id aponta pra
  // msg fora da página atual (paginação reversa ainda não trouxe), lookup
  // devolve undefined — exibimos placeholder de "msg indisponível".
  const quoted = message.replyToMessageId
    ? lookupMessage?.(message.replyToMessageId)
    : undefined

  return (
    <div
      id={bubbleDomId(message.id)}
      className={cn(
        'flex w-full scroll-mt-12 transition-shadow duration-700',
        // Flash temporário quando o QuotedSnippet seleciona essa bolha como
        // alvo de scroll. Classe `chat-bubble-flash` é adicionada
        // imperativamente em scrollToMessage e removida após ~1.2s.
        '[&.chat-bubble-flash>div]:ring-2 [&.chat-bubble-flash>div]:ring-info',
        isOutbound ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={cn(
          'group relative max-w-[78%] rounded-lg px-3 py-1.5 shadow-sm',
          isDeleted
            ? 'border border-border bg-muted/50 italic text-muted-foreground'
            : isRejected
              ? 'border border-warning/50 bg-warning-soft text-warning-soft-foreground rounded-br-sm'
              : isFailed
                ? 'border border-error/50 bg-error-soft text-error-soft-foreground rounded-br-sm'
                : isOutbound
                  ? isOnDevice
                    ? 'bg-chat-bubble/80 text-chat-bubble-foreground rounded-br-sm border border-chat-bubble-foreground/20'
                    : 'bg-chat-bubble text-chat-bubble-foreground rounded-br-sm'
                  : 'bg-card text-foreground rounded-bl-sm',
        )}
      >
        {showActions && conversationId && (
          <MessageActions
            message={message}
            conversationId={conversationId}
            // Edit é prerrogativa do outbound — quando inbound, omitimos pra
            // o menu não mostrar a entrada "Editar".
            onStartEdit={isOutbound ? () => setIsEditing(true) : undefined}
          />
        )}

        {/* Stub do reply — clicável pra scroll até a msg original. Aparece
            antes do conteúdo (média/texto) pra espelhar o WhatsApp. */}
        {message.replyToMessageId && !isDeleted && (
          <QuotedSnippet
            quoted={quoted ?? null}
            replyDirection={message.direction}
          />
        )}

        {isDeleted ? (
          <DeletedContent message={message} isOutbound={isOutbound} />
        ) : (
          <BubbleContent message={message} />
        )}

        {isStopped && (
          <FailureNotice
            messageId={message.id}
            conversationId={conversationId}
            deliveryStatus={message.deliveryStatus}
            failureReason={message.failureReason}
          />
        )}

        <div
          className={cn(
            'mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none',
            isDeleted
              ? 'text-muted-foreground'
              : isRejected
                ? 'text-warning-soft-foreground/80'
                : isFailed
                  ? 'text-error-soft-foreground/80'
                  : isOutbound
                    ? 'text-chat-bubble-foreground/70'
                    : 'text-muted-foreground',
          )}
        >
          {message.editedAt && !isDeleted && (
            <span className="italic">editada</span>
          )}
          {isOnDevice && !isDeleted && (
            <Smartphone
              className="size-3"
              aria-label="Enviada pelo celular pareado"
            />
          )}
          <span>{time}</span>
          {isOutbound && !isDeleted && <StatusIcon message={message} />}
        </div>
      </div>
    </div>
  )
}

// Stub clicável da mensagem citada, renderizado no topo da bolha. Cor da
// barra lateral reflete a origem do quoted (outbound = chat-bubble; inbound
// = info), igual ao padrão WhatsApp. Se `quoted` for null (alvo fora do
// histórico atual carregado), mostra placeholder não-clicável.
function QuotedSnippet({
  quoted,
  replyDirection,
}: {
  quoted: Message | null
  replyDirection: Message['direction']
}): React.ReactElement {
  const handleClick = (): void => {
    if (!quoted) return
    scrollToMessage(quoted.id)
  }

  // Caso a alvo esteja fora da lista atual (paginação reversa não trouxe a
  // página dela ainda), placeholder neutro. Sem click handler.
  if (!quoted) {
    return (
      <div
        className={cn(
          'mb-1 flex items-stretch gap-2 overflow-hidden rounded',
          'border-l-2 border-muted-foreground/40 bg-black/5 px-2 py-1 text-xs italic text-muted-foreground',
          'dark:bg-white/5',
        )}
      >
        Mensagem indisponível
      </div>
    )
  }

  const isQuotedOutbound = quoted.direction === 'outbound'
  const authorLabel =
    quoted.direction === 'internal_note'
      ? 'Nota interna'
      : isQuotedOutbound
        ? 'Você'
        : 'Cliente'
  const isSelfReply = isQuotedOutbound === (replyDirection === 'outbound')

  return (
    <button
      type="button"
      onClick={handleClick}
      title="Ir para a mensagem original"
      className={cn(
        'mb-1 flex w-full items-stretch gap-2 overflow-hidden rounded text-left',
        'border-l-2 px-2 py-1 transition-colors',
        // Borda + bg combinam com origem do quoted independente da bolha
        // atual — visualmente, o stub se parece com a bolha original em
        // miniatura, mesmo embutido numa bolha de cor diferente.
        isQuotedOutbound
          ? 'border-info bg-info/10 hover:bg-info/20'
          : 'border-success bg-success/10 hover:bg-success/20',
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="text-[11px] font-medium leading-tight">
          {authorLabel}
          {isSelfReply && (
            <span className="ml-1 text-[10px] font-normal italic opacity-70">
              (citado)
            </span>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-1 text-xs leading-tight">
          {quoted.kind === 'media' && (
            <QuotedMediaIcon mediaType={quoted.mediaType} />
          )}
          <span className="min-w-0 truncate">
            {quotedPreviewText(quoted)}
          </span>
        </div>
      </div>
    </button>
  )
}

function QuotedMediaIcon({
  mediaType,
}: {
  mediaType: Message['mediaType']
}): React.ReactElement {
  if (mediaType === 'image' || mediaType === 'sticker')
    return <ImageIcon className="size-3 shrink-0" />
  if (mediaType === 'audio') return <Mic className="size-3 shrink-0" />
  if (mediaType === 'video') return <Video className="size-3 shrink-0" />
  return <FileText className="size-3 shrink-0" />
}

function quotedPreviewText(m: Message): string {
  if (m.deletedAt) return 'Mensagem apagada'
  if (m.body && m.body.trim()) return m.body
  if (m.kind === 'media') {
    switch (m.mediaType) {
      case 'image':
        return 'Imagem'
      case 'audio':
        return 'Áudio'
      case 'video':
        return 'Vídeo'
      case 'document':
        return 'Documento'
      case 'sticker':
        return 'Figurinha'
      default:
        return 'Mídia'
    }
  }
  if (m.kind === 'call') return 'Chamada'
  if (m.kind === 'sticker') return 'Figurinha'
  return 'Mensagem'
}

// Conteúdo "ativo" da bolha: texto e/ou mídia. Mídia vem antes do body
// porque imagem grande + caption fica natural no padrão WhatsApp.
function BubbleContent({
  message,
}: {
  message: Message
}): React.ReactElement {
  const hasMedia = message.kind === 'media' && message.mediaUrl

  return (
    <>
      {hasMedia && <MediaPreview message={message} variant="bubble" />}
      {message.body ? (
        <div
          className={cn(
            'whitespace-pre-wrap break-words text-sm',
            // Caption embaixo de mídia ganha respiro pequeno — sem isso, texto
            // gruda no preview. Texto puro não precisa (sem mídia acima).
            hasMedia && 'mt-1',
          )}
        >
          {message.body}
        </div>
      ) : !hasMedia ? (
        // Fallback pra kinds que não vieram com body nem mídia.
        <div className="text-sm italic text-muted-foreground">
          {fallbackBody(message)}
        </div>
      ) : null}
    </>
  )
}

// Mensagem apagada (soft delete). Texto depende do origin: staff (nós
// apagamos) vs cliente (do outro lado). Preserva posição/spacing.
function DeletedContent({
  message,
  isOutbound,
}: {
  message: Message
  isOutbound: boolean
}): React.ReactElement {
  const text =
    message.deletionOrigin === 'staff'
      ? isOutbound
        ? 'Você apagou esta mensagem'
        : 'Mensagem apagada pelo atendente'
      : message.deletionOrigin === 'client'
        ? 'Esta mensagem foi apagada'
        : 'Mensagem indisponível'

  return (
    <div className="flex items-center gap-1.5 text-sm">
      <Ban className="size-3.5 shrink-0" />
      <span>{text}</span>
    </div>
  )
}

function fallbackBody(message: Message): string {
  if (message.kind === 'media') {
    return mediaFallbackLabel(message.mediaType)
  }
  if (message.kind === 'template') return '[Mensagem de template]'
  if (message.kind === 'system') return '[Mensagem do sistema]'
  return ''
}

function mediaFallbackLabel(
  type: Message['mediaType'],
): string {
  switch (type) {
    case 'image':
      return '[Imagem]'
    case 'audio':
      return '[Áudio]'
    case 'video':
      return '[Vídeo]'
    case 'document':
      return '[Documento]'
    case 'sticker':
      return '[Figurinha]'
    default:
      return '[Mídia]'
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

function StatusIcon({ message }: { message: Message }): React.ReactElement {
  // Backend agora carrega `deliveryStatus` na própria row — o id real é o id
  // real desde o INSERT (sem tempId optimistic). Spinner = worker ainda não
  // confirmou; alerta = pre-flight ou adapter falhou; checks = sent/delivered/read.
  if (message.deliveryStatus === 'pending') {
    return <Loader2 className="size-3 animate-spin" aria-label="enviando" />
  }
  if (
    message.deliveryStatus === 'failed' ||
    message.deliveryStatus === 'rejected'
  ) {
    return <AlertTriangle className="size-3" aria-label="falha no envio" />
  }
  // status='sent' → cascata padrão por timestamps pós-envio.
  if (message.readAt) {
    // Tick duplo "lido" — visualmente azul em WhatsApp; aqui mantém cor do
    // grupo pra não brigar com o tema, mas o ícone duplo já diferencia.
    return <CheckCheck className="size-3" aria-label="lido" />
  }
  if (message.deliveredAt) {
    return <CheckCheck className="size-3" aria-label="entregue" />
  }
  if (message.sentAt) {
    return <Check className="size-3" aria-label="enviado" />
  }
  // Fallback defensivo: sent sem sentAt não deveria existir.
  return <Clock className="size-3" aria-label="pendente" />
}

// Linha de aviso dentro da bolha em estado terminal de falha. Texto PT-BR
// derivado do `failureReason`, com ícone de alerta + ações contextuais.
//
// Ações por reason:
//   - no_opt_in              → "Registrar opt-in" + "Tentar novamente"
//   - window_24h_expired     → só label (retry vai falhar igual; usa template)
//   - resto (failed/rejected) → "Tentar novamente"
//
// Cores herdadas do container (bolha amarelo soft pra rejected, vermelho
// soft pra failed) via `currentColor` — `border-current/30` desenha um
// separador sutil do mesmo matiz, sem precisar conhecer o estado aqui dentro.
function FailureNotice({
  messageId,
  conversationId,
  deliveryStatus,
  failureReason,
}: {
  messageId: string
  // Quando o pai roda em modo read-only (sem conversationId), botões somem.
  conversationId: string | undefined
  deliveryStatus: Message['deliveryStatus']
  failureReason: FailureReason | null
}): React.ReactElement {
  const label = failureReasonLabel(failureReason, deliveryStatus)
  const retryMutation = useRetryMessage(conversationId)

  const handleRetry = (): void => {
    retryMutation.mutate(messageId, {
      onError: (err) => {
        const status = (err as { response?: { status?: number } })?.response
          ?.status
        const message = apiErrorText(err)
        if (status === 409) {
          toast.error(message ?? 'Mensagem não está em estado de falha')
        } else if (status === 404) {
          toast.error('Mensagem não encontrada')
        } else {
          toast.error('Erro ao tentar reenviar. Tente novamente.')
        }
      },
    })
  }

  // window_24h_expired: retry direto vai falhar de novo (texto fora da janela
  // é proibido). Operador precisa usar o composer de template — esse vira o
  // automático na próxima abertura via ConversationView quando providerType
  // for meta_cloud. Não oferecemos botão pra não dar falsa esperança.
  const allowRetry = failureReason !== 'window_24h_expired' && Boolean(conversationId)
  const showOptIn = failureReason === 'no_opt_in' && Boolean(conversationId)

  return (
    <div className="mt-1 flex flex-col gap-1.5 border-t border-current/30 pt-1 text-[11px]">
      <div className="flex items-start gap-1">
        <AlertTriangle className="mt-px size-3 shrink-0" />
        <span>{label}</span>
      </div>
      {(allowRetry || showOptIn) && (
        <div className="flex flex-wrap items-center gap-1">
          {showOptIn && conversationId && (
            <OptInButton conversationId={conversationId} />
          )}
          {allowRetry && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={handleRetry}
              disabled={retryMutation.isPending}
              className="h-7 gap-1 px-2 text-[11px]"
            >
              {retryMutation.isPending ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RotateCw className="size-3" />
              )}
              Tentar novamente
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

// Botão "Registrar opt-in" dentro da FailureNotice. Carrega lazy o
// whatsappContactId via conversation. Mesmo padrão do TemplateComposer
// (confirm dialog → updateWhatsappContact com source='manual') —
// duplicação aceitável pra manter a ação acoplada ao próprio motivo da falha,
// em vez de exigir que o staff abra o sheet do contato.
function OptInButton({
  conversationId,
}: {
  conversationId: string
}): React.ReactElement | null {
  const { data: conv } = useConversation(conversationId)
  const { data: contact } = useWhatsappContact(conv?.whatsappContactId ?? null)
  const updateContact = useUpdateWhatsappContact()
  const confirm = useConfirm()

  // Sem contato resolvido → não mostra botão (operador veria erro ao clicar).
  if (!contact) return null
  // Contato já tem opt-in registrado — caso raro porque a bolha caiu como
  // no_opt_in, mas se entre a falha e o load o contato ganhou opt-in (outra
  // aba registrou), esconde o botão pra não confundir.
  if (contact.optedInAt) return null

  const handleClick = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Registrar opt-in manual?',
      description:
        'Confirme apenas se o cliente autorizou o contato por WhatsApp ' +
        '(formulário, autorização verbal, etc.). Origem fica como "manual" ' +
        'pra auditoria. Depois clique em "Tentar novamente".',
      confirmLabel: 'Registrar opt-in',
    })
    if (!ok) return
    try {
      await updateContact.mutateAsync({
        id: contact.id,
        input: {
          optedInAt: new Date().toISOString(),
          optInSource: 'manual',
        },
      })
      toast.success('Opt-in registrado — clique em "Tentar novamente"')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao registrar opt-in')
    }
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      onClick={() => void handleClick()}
      disabled={updateContact.isPending}
      className="h-7 gap-1 px-2 text-[11px]"
    >
      {updateContact.isPending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <ShieldCheck className="size-3" />
      )}
      Registrar opt-in
    </Button>
  )
}

// Mapa de reason → texto curto pra exibir embaixo da bolha. Mantido inline
// (caso de uso único). Quando UI ganhar action map (botão "Pedir opt-in",
// "Reconectar canal" etc), virar table-driven [label, ctaLabel, ctaTarget].
function failureReasonLabel(
  reason: FailureReason | null,
  deliveryStatus: Message['deliveryStatus'],
): string {
  switch (reason) {
    case 'no_opt_in':
      return 'Cliente sem opt-in registrado'
    case 'channel_disconnected':
      return 'Canal WhatsApp desconectado'
    case 'window_24h_expired':
      return 'Fora da janela de 24h — use um template aprovado'
    case 'invalid_template':
      return 'Template inválido ou desativado'
    case 'rate_limited':
      return 'Limite de envios atingido — aguarde alguns instantes'
    case 'provider_error':
      return 'O WhatsApp recusou o envio'
    case 'worker_timeout':
      return 'Envio não confirmado pelo servidor — tente novamente'
    case 'unknown':
    case null:
    default:
      return deliveryStatus === 'rejected'
        ? 'Envio bloqueado (motivo não identificado)'
        : 'Falha no envio (motivo não identificado)'
  }
}

// =====================================================================
// Call: notificação centralizada (style internal_note). Cor + ícone por
// status. Não tem hover/ação — é registro de evento, não conteúdo.
// =====================================================================
function CallNotification({
  payload,
  time,
}: {
  payload: CallPayload | null
  time: string
}): React.ReactElement {
  const { Icon, label, tone } = describeCall(payload)
  const formatted = formatTime(time)

  return (
    <div className="my-2 flex justify-center">
      <div
        className={cn(
          'flex max-w-[80%] items-center gap-2 rounded-md border px-3 py-1.5 text-center text-xs',
          tone === 'missed' &&
            'border-warning/40 bg-warning-soft text-warning-soft-foreground',
          tone === 'received' &&
            'border-success/40 bg-success/10 text-success',
          tone === 'declined' &&
            'border-error/40 bg-error-soft text-error-soft-foreground',
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span>{label}</span>
        <span className="text-muted-foreground">· {formatted}</span>
      </div>
    </div>
  )
}

function describeCall(payload: CallPayload | null): {
  Icon: typeof Phone
  label: string
  tone: 'missed' | 'received' | 'declined'
} {
  if (!payload) {
    return { Icon: Phone, label: 'Chamada', tone: 'missed' }
  }
  if (payload.status === 'received') {
    const dur =
      typeof payload.durationSec === 'number' && payload.durationSec > 0
        ? ` (${formatDuration(payload.durationSec)})`
        : ''
    return {
      Icon: PhoneIncoming,
      label: `Chamada atendida${dur}`,
      tone: 'received',
    }
  }
  if (payload.status === 'declined') {
    return {
      Icon: PhoneOff,
      label: 'Chamada recusada',
      tone: 'declined',
    }
  }
  // missed (default)
  return {
    Icon: PhoneMissed,
    label: 'Chamada perdida',
    tone: 'missed',
  }
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
