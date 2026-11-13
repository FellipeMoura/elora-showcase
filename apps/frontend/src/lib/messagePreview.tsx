import {
  FileText,
  Image as ImageIcon,
  Mic,
  Phone,
  Sticker,
  Video,
} from 'lucide-react'

// Deriva a prévia textual + ícone da última mensagem de uma conversa.
//
// Regra:
//   - Se há body (texto puro OU caption de mídia) → usa direto, sem ícone.
//   - Senão, cai no `kind` + `mediaType` pra montar label tipada com ícone.
//
// Tipos batem com o discriminated union de Message (chat-domain). Usado em
// ChatSidebarItem (CHAT sidebar) e LeadCard (kanban de leads) — fonte única.

export interface MessagePreviewSource {
  lastMessagePreview: string | null
  lastMessageKind:
    | 'text'
    | 'media'
    | 'template'
    | 'system'
    | 'sticker'
    | 'call'
    | null
  lastMessageMediaType:
    | 'image'
    | 'audio'
    | 'video'
    | 'document'
    | 'sticker'
    | null
}

export interface MessagePreview {
  icon: React.ReactNode | null
  text: string
}

export function derivePreview(
  source: MessagePreviewSource,
  iconClassName = 'size-3 shrink-0',
): MessagePreview {
  if (source.lastMessagePreview) {
    return { icon: null, text: source.lastMessagePreview }
  }

  if (source.lastMessageKind === 'media') {
    switch (source.lastMessageMediaType) {
      case 'image':
        return { icon: <ImageIcon className={iconClassName} />, text: 'Imagem' }
      case 'audio':
        return { icon: <Mic className={iconClassName} />, text: 'Mensagem de voz' }
      case 'video':
        return { icon: <Video className={iconClassName} />, text: 'Vídeo' }
      case 'document':
        return { icon: <FileText className={iconClassName} />, text: 'Documento' }
      default:
        return { icon: null, text: 'Mídia' }
    }
  }

  if (source.lastMessageKind === 'sticker') {
    return { icon: <Sticker className={iconClassName} />, text: 'Figurinha' }
  }

  if (source.lastMessageKind === 'call') {
    return { icon: <Phone className={iconClassName} />, text: 'Chamada' }
  }

  if (source.lastMessageKind === 'template') {
    return { icon: null, text: 'Template enviado' }
  }

  if (source.lastMessageKind === 'system') {
    return { icon: null, text: 'Mensagem do sistema' }
  }

  return { icon: null, text: 'Sem mensagens' }
}

// Prefixo "Você:" / "Nota:" conforme direction da última mensagem.
export function previewPrefixFromDirection(
  direction: 'inbound' | 'outbound' | 'internal_note' | null,
): string {
  if (direction === 'outbound') return 'Você: '
  if (direction === 'internal_note') return 'Nota: '
  return ''
}
