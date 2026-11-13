import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Download, FileText, ImageOff, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { useMessageMediaUrl } from '@/hooks/useConversationMessages'
import type { Message } from '@/api/messages'
import { cn } from '@/lib/utils'
import { AudioPlayer } from './AudioPlayer'

interface MediaPreviewProps {
  message: Message
  // Variante de renderização. 'bubble' = dentro de balão (msg de mídia
  // normal). 'standalone' = fora de balão (sticker — bolha não cabe
  // estética WhatsApp).
  variant?: 'bubble' | 'standalone'
}

// Renderiza mídia da message conforme `mediaType`. Lazy fetch da presigned
// URL via useMessageMediaUrl — só dispara quando o componente é montado.
// Estados:
//   - loading: spinner
//   - error: ícone de mídia quebrada
//   - sucesso: tag apropriada (img/audio/video/document card)
//
// Limites visuais (max-width 280px) refletem o padrão WhatsApp Web —
// previews enormes desformatam timeline de conversa.
export function MediaPreview({
  message,
  variant = 'bubble',
}: MediaPreviewProps): React.ReactElement | null {
  const { data, isLoading, isError } = useMessageMediaUrl(
    message.mediaUrl ? message.id : null,
  )

  if (!message.mediaUrl) return null

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span>Carregando mídia…</span>
      </div>
    )
  }

  if (isError || !data?.url) {
    return (
      <div className="flex items-center gap-2 py-2 text-xs text-error">
        <ImageOff className="size-4" />
        <span>Não foi possível carregar a mídia</span>
      </div>
    )
  }

  const url = data.url
  const mediaType = message.mediaType

  if (mediaType === 'image') {
    return <ImagePreview url={url} caption={message.body} />
  }

  if (mediaType === 'sticker') {
    return <StickerPreview url={url} variant={variant} />
  }

  if (mediaType === 'audio') {
    return <AudioPreview url={url} />
  }

  if (mediaType === 'video') {
    return (
      <video
        controls
        preload="metadata"
        src={url}
        className="my-1 max-h-[320px] max-w-[280px] rounded"
      />
    )
  }

  if (mediaType === 'document') {
    return <DocumentPreview url={url} />
  }

  // Tipo inesperado: cai pra link de download genérico (não corrompe a UI).
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="my-1 inline-flex items-center gap-1.5 text-xs text-info underline"
    >
      <Download className="size-3.5" />
      Baixar anexo
    </a>
  )
}

// Audio dentro da bolha — wrapper apenas pra limitar largura. Player real
// é compartilhado em `AudioPlayer`.
function AudioPreview({ url }: { url: string }): React.ReactElement {
  return (
    <div className="my-1 max-w-[240px]">
      <AudioPlayer url={url} />
    </div>
  )
}

// ----------------------------------------------------------------------
// Image: thumbnail clicável → abre lightbox fullscreen (Radix Dialog).
// ----------------------------------------------------------------------
function ImagePreview({
  url,
  caption,
}: {
  url: string
  caption: string | null
}): React.ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block max-w-[280px] cursor-zoom-in overflow-hidden rounded"
        aria-label="Abrir imagem"
      >
        <img
          src={url}
          alt={caption ?? ''}
          className="block max-h-[320px] w-auto"
          loading="lazy"
        />
      </button>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          />
          <DialogPrimitive.Content
            className="fixed inset-0 z-50 flex items-center justify-center p-4 outline-none"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">
              Visualizar imagem
            </DialogPrimitive.Title>
            <img
              src={url}
              alt={caption ?? ''}
              className="max-h-full max-w-full rounded object-contain"
              onClick={() => setOpen(false)}
            />
            <DialogPrimitive.Close
              className={cn(
                'absolute right-4 top-4 rounded-full bg-black/40 p-2 text-white',
                'transition-colors hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
              )}
              aria-label="Fechar"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}

// ----------------------------------------------------------------------
// Sticker: imagem transparente, sem bolha. WhatsApp Web mostra ~160px;
// usamos 144px (mais compacto pra timeline da clínica). Standalone variant
// remove padding extra que a bolha aplicaria.
// ----------------------------------------------------------------------
function StickerPreview({
  url,
  variant,
}: {
  url: string
  variant: 'bubble' | 'standalone'
}): React.ReactElement {
  return (
    <img
      src={url}
      alt=""
      className={cn(
        'h-auto max-w-[144px]',
        variant === 'standalone' && 'rounded-none',
      )}
      loading="lazy"
    />
  )
}

// ----------------------------------------------------------------------
// Document: card minimal — ícone + label genérico + botão baixar.
// V1 não exibe nome do arquivo nem tamanho (não temos esses campos na
// Message). Quando expandirmos `messages` pra carregar metadata de mídia
// (ou virmos via whatsapp_messages.payload), enriquecer aqui.
// ----------------------------------------------------------------------
function DocumentPreview({ url }: { url: string }): React.ReactElement {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'my-1 inline-flex max-w-[280px] items-center gap-2 rounded border border-border bg-background/60 px-3 py-2',
        'text-xs hover:bg-background',
      )}
      download
    >
      <FileText className="size-5 shrink-0 text-info" />
      <span className="flex-1 truncate font-medium">Documento</span>
      <Download className="size-4 shrink-0 text-muted-foreground" />
    </a>
  )
}
