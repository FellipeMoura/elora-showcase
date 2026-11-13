import {
  FileText,
  Image as ImageIcon,
  Mic,
  Plus,
  Reply,
  Send,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Message } from '@/api/messages'
import { Button } from '@/components/ui/button'
import {
  useConversationMessages,
  useSendMessage,
  useUploadMedia,
} from '@/hooks/useConversationMessages'
import { useChatStore } from '@/stores/chatStore'
import { cn } from '@/lib/utils'
import { AudioPlayer } from './AudioPlayer'
import { AudioRecorder } from './AudioRecorder'
import { EmojiPickerPopover } from './EmojiPickerPopover'
import { scrollToMessage } from '@/lib/chatMessageDom'
import { apiErrorText } from '@/lib/apiError'

interface MessageComposerProps {
  conversationId: string
  // Texto inicial — usado por features futuras (rascunhos, citações).
  // Por ora sempre vazio.
  initialText?: string
}

// Limite alinhado com o backend (multer 20MB em messagesRoutes.ts).
// Validar antes evita upload longo que vai ser rejeitado no servidor.
const MAX_FILE_BYTES = 20 * 1024 * 1024

// Composer estilo WhatsApp: textarea cresce até N linhas, Enter envia,
// Shift+Enter quebra linha. Suporta texto, emoji e anexo de mídia
// (image/audio/video/document — sticker outbound NÃO é V1).
//
// Fluxo de anexo:
//   1. Click no Paperclip abre o file picker nativo
//   2. Seleção popula `pendingFile` + preview acima do textarea
//   3. Textarea vira caption opcional do anexo
//   4. Send: upload (com onProgress) → send com kind='media'
//   5. Sucesso/erro: limpa preview, mantém textarea pra próxima
export function MessageComposer({
  conversationId,
  initialText = '',
}: MessageComposerProps): React.ReactElement {
  const [text, setText] = useState(initialText)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  // Áudio gravado aguardando revisão+envio. Separado de `pendingFile` pra
  // ter UX distinta: substitui o composer por uma barra de revisão com
  // player embutido (cancelar / tocar / enviar), em vez de cair como anexo
  // genérico tipo documento.
  const [pendingAudio, setPendingAudio] = useState<File | null>(null)
  const [uploadPercent, setUploadPercent] = useState<number | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sendMutation = useSendMessage(conversationId)
  const uploadMutation = useUploadMedia(conversationId)

  // Rascunho injetado de fora do chat (ex: "enviar link de contrato") — seta o
  // texto e consome (clearDraft) quando bate o conversationId. A flutuante é
  // única e não remonta ao trocar de conversa, então o effect cobre tanto abrir
  // já com a conversa quanto trocar pra ela com um draft pendente.
  const pendingDraft = useChatStore((s) => s.pendingDraft)
  const clearDraft = useChatStore((s) => s.clearDraft)

  // Reply target — quando o staff clica "Responder" numa bolha, o store guarda
  // o id da msg-alvo. Composer renderiza preview no topo + envia
  // `replyToMessageId` pro backend. Resolvido via cache da timeline pra exibir
  // o stub sem rede; se mudar de página rápido, mostra placeholder.
  const replyTarget = useChatStore((s) => s.replyTarget)
  const setReplyTarget = useChatStore((s) => s.setReplyTarget)
  const activeReplyId =
    replyTarget && replyTarget.conversationId === conversationId
      ? replyTarget.messageId
      : null
  const { data: messagesData } = useConversationMessages(
    activeReplyId ? conversationId : null,
  )
  const replyMessage: Message | null = activeReplyId
    ? (messagesData?.items.find((m) => m.id === activeReplyId) ?? null)
    : null
  // Rascunho vindo de fora (openChatConversation com draftText) entra no
  // texto durante o render (padrão "estado derivado de prop"); limpar o
  // store e focar ficam no efeito.
  const [appliedDraft, setAppliedDraft] = useState<typeof pendingDraft>(null)
  if (
    pendingDraft &&
    pendingDraft !== appliedDraft &&
    pendingDraft.conversationId === conversationId
  ) {
    setAppliedDraft(pendingDraft)
    setText(pendingDraft.text)
  }
  useEffect(() => {
    if (!appliedDraft) return
    clearDraft()
    // Foca + leva o cursor pro fim pra operador só revisar e enviar.
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.setSelectionRange(ta.value.length, ta.value.length)
    })
  }, [appliedDraft, clearDraft])

  // ObjectURL pro player de revisão — criado a partir do File local.
  // Cleanup no unmount/troca via useEffect abaixo (revogar evita leak).
  const audioUrl = useMemo(() => {
    if (!pendingAudio) return null
    return URL.createObjectURL(pendingAudio)
  }, [pendingAudio])

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl)
    }
  }, [audioUrl])

  const trimmed = text.trim()
  // "Em vôo" só pra fluxo de mídia — upload em andamento OU send confirmando
  // mídia (anexo OU áudio gravado). Texto puro é optimistic (libera input
  // imediato), então não conta como busy pro textarea/canSend.
  const hasPendingMedia = pendingFile !== null || pendingAudio !== null
  const isMediaInFlight =
    uploadMutation.isPending ||
    (sendMutation.isPending && hasPendingMedia)
  // Botões de mídia (anexar/microfone) ficam bloqueados também quando já há
  // um arquivo pendente — não dá pra anexar 2 ao mesmo tempo nem trocar
  // anexo por gravação no meio do caminho.
  const mediaButtonsDisabled = isMediaInFlight || hasPendingMedia
  // Tem algo pra enviar (texto OU arquivo). Define o slot direito:
  // hasContent → Send, !hasContent → Mic (mimético ao WhatsApp Web).
  const hasContent = pendingFile !== null || trimmed.length > 0
  // Bloqueia despacho enquanto mídia em vôo — texto puro nunca bloqueia
  // (mesmo com sendMutation.isPending true por alguns ms, novo send
  // dispara nova mutation paralela e cada uma tem seu próprio tempId).
  const canSend = hasContent && !isMediaInFlight

  // Limpa preview + gravação ao trocar de conversation (UX: arquivo/áudio
  // selecionado em uma conversa não vaza pra outra ao trocar via sidebar).
  // Cleanup do MediaRecorder fica no próprio AudioRecorder (unmount libera
  // o mic via stream.getTracks().stop()). Ajuste durante o render, sem
  // efeito. Não limpa o text — rascunho por conversa fica pra V2.
  const [prevConversationId, setPrevConversationId] = useState(conversationId)
  if (prevConversationId !== conversationId) {
    setPrevConversationId(conversationId)
    setPendingFile(null)
    setPendingAudio(null)
    setUploadPercent(null)
    setIsRecording(false)
  }

  // Auto-resize: cresce conforme linhas são adicionadas, sem scrollbar.
  // Reset → measure → set evita acumular altura entre digitações. Roda
  // em layout effect pra evitar flash de altura antiga entre paints.
  useLayoutEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${ta.scrollHeight}px`
  }, [text])

  // Tratamento de erro compartilhado por ambos fluxos (texto optimistic e
  // mídia await). Mapeia status HTTP comuns pra toasts em PT-BR. Categorias:
  //   - sem `response` (network/timeout) → falha de conexão
  //   - 401 → sessão expirou (interceptor de auth pode até redirecionar antes)
  //   - 4xx específicos → mensagem do backend quando disponível
  //   - 5xx → genérico de servidor (toast curto, sem detalhar 502/503/504)
  const handleSendError = (err: unknown): void => {
    const response = (err as { response?: { status?: number; data?: { message?: string } } })
      ?.response
    const status = response?.status
    const message = apiErrorText(err)
    if (!response) {
      // axios sem `response` ⇒ pedido nunca chegou (offline, DNS, CORS).
      toast.error('Sem conexão com o servidor. Verifique sua internet.')
    } else if (status === 401) {
      toast.error('Sessão expirada. Faça login novamente.')
    } else if (status === 403) {
      toast.error(message ?? 'Sem permissão ou fora da janela de 24h')
    } else if (status === 409) {
      toast.error(message ?? 'Estado da conversa não permite envio')
    } else if (status === 413) {
      toast.error('Arquivo grande demais (máx 20MB)')
    } else if (status === 429) {
      // OutboundGuard (rate limit/dedupe) — defesa contra ban em canais
      // não-Cloud. Backend manda message+retryAfterSec no body.
      toast.error(message ?? 'Limite de envios atingido. Aguarde um instante.')
    } else if (status && status >= 500) {
      toast.error('Servidor indisponível. Tente novamente em instantes.')
    } else {
      toast.error(message ?? 'Erro ao enviar mensagem. Tente novamente.')
    }
  }

  // Pipeline compartilhado de envio de mídia (anexo ou áudio gravado).
  // Upload → send com kind='media' → cleanup. Erros logam toast. Snapshot do
  // replyToMessageId no início pra sobreviver se o store for limpo durante o
  // upload (ex: troca de conversa concorrente).
  const submitMedia = async (
    file: File,
    mediaType: 'image' | 'audio' | 'video' | 'document',
    caption: string | undefined,
    onCleanup: () => void,
  ): Promise<void> => {
    const replyToMessageId = activeReplyId ?? undefined
    try {
      const uploaded = await uploadMutation.mutateAsync({
        file,
        onProgress: (loaded, total) => {
          setUploadPercent(Math.round((loaded / total) * 100))
        },
      })
      await sendMutation.mutateAsync({
        kind: 'media',
        mediaObjectKey: uploaded.objectKey,
        mediaType,
        caption,
        replyToMessageId,
      })
      setText('')
      onCleanup()
      setUploadPercent(null)
      setReplyTarget(null)
      textareaRef.current?.focus()
    } catch (err) {
      setUploadPercent(null)
      handleSendError(err)
    }
  }

  const handleSubmit = async (e?: React.FormEvent): Promise<void> => {
    e?.preventDefault()
    if (!canSend) return

    // ─── Fluxo ÁUDIO GRAVADO ───────────────────────────────────────────
    // Áudio recém-gravado pelo MediaRecorder — sempre vai sem caption
    // (composer escondido durante revisão). mediaType fixo='audio'.
    if (pendingAudio) {
      await submitMedia(pendingAudio, 'audio', undefined, () =>
        setPendingAudio(null),
      )
      return
    }

    // ─── Fluxo ANEXO (image/video/document) ────────────────────────────
    // Upload → send confirmação. Caption opcional do textarea.
    if (pendingFile) {
      await submitMedia(
        pendingFile,
        mediaTypeFromFile(pendingFile),
        trimmed || undefined,
        () => setPendingFile(null),
      )
      return
    }

    // ─── Fluxo TEXTO (optimistic) ──────────────────────────────────────
    // Dispara mutation sem await: a bolha pending já vai aparecer no cache
    // via onSuccess (V2 backend retorna a row pending no próprio POST). Input
    // limpa + refoca no mesmo frame — sem delay perceptível. Em erro, além
    // do toast, restauramos o body + reply target no textarea/store pra que
    // o staff possa editar e re-enviar sem reescrever do zero. Restaura
    // texto só se o user ainda não digitou nada novo no intervalo.
    const body = trimmed
    const replyToMessageId = activeReplyId ?? undefined
    sendMutation.mutate(
      { kind: 'text', body, replyToMessageId },
      {
        onError: (err) => {
          handleSendError(err)
          setText((current) => (current.trim() === '' ? body : current))
          if (replyToMessageId) {
            setReplyTarget({ conversationId, messageId: replyToMessageId })
          }
          textareaRef.current?.focus()
        },
      },
    )
    setText('')
    setReplyTarget(null)
    textareaRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    // Enter envia, Shift+Enter quebra linha. Mesmo padrão do WhatsApp Web.
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault()
      void handleSubmit()
    }
  }

  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    // Reset value pra permitir selecionar o mesmo arquivo de novo após
    // cancelar/enviar — input file não dispara onChange se value não muda.
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      toast.error(
        `Arquivo grande demais (${formatBytes(file.size)}). Limite: 20MB.`,
      )
      return
    }
    setPendingFile(file)
    textareaRef.current?.focus()
  }

  const insertEmoji = (emoji: string): void => {
    const ta = textareaRef.current
    if (!ta) {
      setText((prev) => prev + emoji)
      return
    }
    const start = ta.selectionStart
    const end = ta.selectionEnd
    setText((prev) => prev.slice(0, start) + emoji + prev.slice(end))
    // Reposiciona cursor depois que React renderiza o novo valor.
    requestAnimationFrame(() => {
      ta.focus()
      const pos = start + emoji.length
      ta.setSelectionRange(pos, pos)
    })
  }

  return (
    <div className="flex flex-col p-2">
      {activeReplyId && (
        <ReplyPreview
          message={replyMessage}
          onCancel={() => setReplyTarget(null)}
        />
      )}
      {pendingFile && (
        <AttachmentPreview
          file={pendingFile}
          uploadPercent={uploadPercent}
          onRemove={() => {
            setPendingFile(null)
            setUploadPercent(null)
          }}
        />
      )}

      {pendingAudio && audioUrl ? (
        // Áudio gravado aguardando revisão. Substitui o composer inteiro
        // por uma barra com lixeira (descartar) + player (toca pra revisar)
        // + send. Sem caption — WhatsApp Web também não permite caption
        // em áudio gravado.
        <AudioReviewBar
          url={audioUrl}
          uploadPercent={uploadPercent}
          disabled={isMediaInFlight}
          onDiscard={() => {
            setPendingAudio(null)
            setUploadPercent(null)
          }}
          onSend={() => void handleSubmit()}
        />
      ) : isRecording ? (
        // Durante a gravação, o AudioRecorder substitui toda a toolbar. Ao
        // concluir, o áudio cai em `pendingAudio` (não pendingFile) — a
        // próxima render mostra o AudioReviewBar pra revisar antes de enviar.
        <div className="flex items-center gap-1">
          <AudioRecorder
            onComplete={(file) => {
              setPendingAudio(file)
              setIsRecording(false)
            }}
            onCancel={() => setIsRecording(false)}
          />
        </div>
      ) : (
        <form
          onSubmit={handleSubmit}
          // Pill único estilo WhatsApp Web — botões absorvidos no mesmo
          // container do textarea. Fundo semi-transparente sobre o chat-bg
          // pattern. items-end faz os botões ficarem grudados na base
          // quando o textarea cresce em altura (auto-resize).
          // focus-within faz o ring aparecer quando o textarea recebe foco.
          className={cn(
            'flex items-end gap-0.5 rounded-3xl border border-input bg-card/70 px-1.5 py-1 backdrop-blur-sm',
            'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1',
          )}
        >
          <Button
            type="button"
            size="icon"
            variant="ghost"
            disabled={mediaButtonsDisabled}
            aria-label="Anexar arquivo"
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 rounded-full"
          >
            <Plus className="size-5 text-foreground" />
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            // Aceita tipos comuns de mídia. WhatsApp aceita praticamente
            // qualquer tipo via documentMessage, mas filtro reduz acidentes.
            accept="image/*,audio/*,video/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.zip,.txt,.csv"
            onChange={handleFileSelected}
          />

          <EmojiPickerPopover
            onSelect={insertEmoji}
            disabled={isMediaInFlight}
          />

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={pendingFile ? 'Adicionar legenda…' : 'Digite uma mensagem'}
            rows={1}
            disabled={isMediaInFlight}
            className={cn(
              'min-h-9 flex-1 resize-none overflow-hidden bg-transparent px-2 py-1.5 text-sm',
              // Placeholder single-line — sem isso o textarea quebra
              // "Digite uma mensagem" em duas linhas em larguras estreitas.
              'placeholder:overflow-hidden placeholder:text-ellipsis placeholder:whitespace-nowrap placeholder:text-muted-foreground',
              // Foco visual fica no pill (focus-within do form) — textarea
              // não desenha ring próprio pra evitar borda dupla.
              'focus:outline-none',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          />

          {/* Slot direito: Send quando há conteúdo (mesmo que disabled por
              upload em andamento), Mic quando vazio. Mimético ao WhatsApp
              Web — o ícone muda conforme a intenção do usuário. */}
          {hasContent ? (
            <Button
              type="submit"
              size="icon"
              disabled={!canSend}
              aria-label="Enviar mensagem"
              className="shrink-0 rounded-full"
            >
              <Send className="size-4" />
            </Button>
          ) : (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              disabled={isMediaInFlight}
              aria-label="Gravar áudio"
              onClick={() => setIsRecording(true)}
              className="shrink-0 rounded-full"
            >
              <Mic className="size-5 text-foreground" />
            </Button>
          )}
        </form>
      )}
    </div>
  )
}

// =====================================================================
// AudioReviewBar — substitui o composer quando há áudio gravado aguardando
// envio. Permite revisar (tocar o player), descartar (lixeira) ou enviar.
// Sem caption — WhatsApp Web também não permite caption em áudio gravado.
// =====================================================================
interface AudioReviewBarProps {
  url: string
  uploadPercent: number | null
  disabled: boolean
  onDiscard: () => void
  onSend: () => void
}

function AudioReviewBar({
  url,
  uploadPercent,
  disabled,
  onDiscard,
  onSend,
}: AudioReviewBarProps): React.ReactElement {
  return (
    <div className="flex items-center gap-1.5 rounded-3xl border border-input bg-card/70 px-1.5 py-1 backdrop-blur-sm">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        disabled={disabled}
        aria-label="Descartar áudio"
        onClick={onDiscard}
        className="shrink-0 rounded-full text-error hover:bg-error/10 hover:text-error"
      >
        <Trash2 className="size-4" />
      </Button>
      <div className="min-w-0 flex-1">
        <AudioPlayer url={url} />
        {uploadPercent !== null && (
          <div className="mt-1 px-2 text-[10px] text-info">
            Enviando… {uploadPercent}%
          </div>
        )}
      </div>
      <Button
        type="button"
        size="icon"
        disabled={disabled}
        aria-label="Enviar áudio"
        onClick={onSend}
        className="shrink-0 rounded-full"
      >
        <Send className="size-4" />
      </Button>
    </div>
  )
}

// =====================================================================
// Preview do reply ativo. Renderizado acima do form quando há replyTarget no
// store. Click na área de conteúdo leva pra bolha original (scroll + flash).
// Ícone X cancela o reply.
// =====================================================================
interface ReplyPreviewProps {
  // null quando o id-alvo não está na página carregada (cliente cancelou ou
  // paginação reversa não cobre).
  message: Message | null
  onCancel: () => void
}

function ReplyPreview({
  message,
  onCancel,
}: ReplyPreviewProps): React.ReactElement {
  const isOutbound = message?.direction === 'outbound'
  const authorLabel =
    !message
      ? 'Mensagem indisponível'
      : message.direction === 'internal_note'
        ? 'Nota interna'
        : isOutbound
          ? 'Você'
          : 'Cliente'

  const handleClick = (): void => {
    if (!message) return
    scrollToMessage(message.id)
  }

  return (
    <div
      className={cn(
        'mb-1 flex items-stretch gap-2 overflow-hidden rounded',
        'border-l-2 bg-muted/30',
        message && isOutbound ? 'border-info' : 'border-success',
      )}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={!message}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left',
          message && 'hover:bg-muted/60',
        )}
        title={message ? 'Ir para a mensagem original' : undefined}
      >
        <Reply className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="text-[11px] font-medium leading-tight">
            Respondendo a {authorLabel}
          </div>
          <div className="flex min-w-0 items-center gap-1 text-xs leading-tight text-muted-foreground">
            {message?.kind === 'media' && (
              <ReplyMediaIcon mediaType={message.mediaType} />
            )}
            <span className="min-w-0 truncate">
              {message ? quotedPreview(message) : '—'}
            </span>
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancelar resposta"
        title="Cancelar resposta"
        className="shrink-0 px-2 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

function ReplyMediaIcon({
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

function quotedPreview(m: Message): string {
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

// =====================================================================
// Preview de arquivo selecionado, exibido acima do form. Pra imagem mostra
// thumbnail (objectURL local); pra outros tipos, ícone genérico + nome.
// Barra de progresso aparece durante upload.
// =====================================================================
interface AttachmentPreviewProps {
  file: File
  uploadPercent: number | null
  onRemove: () => void
}

function AttachmentPreview({
  file,
  uploadPercent,
  onRemove,
}: AttachmentPreviewProps): React.ReactElement {
  const isImage = file.type.startsWith('image/')
  const [thumb, setThumb] = useState<string | null>(null)

  // Data URL via FileReader: o setState acontece no callback assíncrono
  // (não síncrono no efeito) e não há object URL pra revogar — que, com o
  // efeito duplo do StrictMode, seria revogada ainda em uso.
  useEffect(() => {
    if (!isImage) return
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') setThumb(reader.result)
    }
    reader.readAsDataURL(file)
    return () => reader.abort()
  }, [file, isImage])

  return (
    <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
      {isImage && thumb ? (
        <img
          src={thumb}
          alt=""
          className="size-10 shrink-0 rounded object-cover"
        />
      ) : (
        <div className="flex size-10 shrink-0 items-center justify-center rounded bg-card text-info">
          <FileText className="size-5" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium">{file.name}</div>
        <div className="text-[10px] text-muted-foreground">
          {formatBytes(file.size)}
          {uploadPercent !== null && (
            <span className="ml-2 text-info">
              Enviando… {uploadPercent}%
            </span>
          )}
        </div>
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={onRemove}
        disabled={uploadPercent !== null}
        aria-label="Remover anexo"
        className="size-7 shrink-0"
      >
        <X className="size-3.5" />
      </Button>
    </div>
  )
}

function mediaTypeFromFile(file: File): 'image' | 'audio' | 'video' | 'document' {
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('audio/')) return 'audio'
  if (file.type.startsWith('video/')) return 'video'
  return 'document'
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
