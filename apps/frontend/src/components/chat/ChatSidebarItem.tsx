import { Link } from 'react-router-dom'
import { ContactAvatar } from '@/components/chat/ContactAvatar'
import type { Conversation } from '@/api/conversations'
import { displayRelativeTime } from '@/lib/format'
import { derivePreview, previewPrefixFromDirection } from '@/lib/messagePreview'
import { cn } from '@/lib/utils'
import {
  STAGE_BADGE_CLASS,
  STAGE_LABELS_SHORT,
} from '@/pages/journeys/journeyLabels'
import {
  LEAD_SUBSTAGE_BADGE_CLASS,
  LEAD_SUBSTAGE_LABELS_SHORT,
} from '@/pages/leads/leadSubstageLabels'

interface ChatSidebarItemProps {
  conv: Conversation
  active: boolean
  onClick: () => void
}

// Item da CHAT sidebar — visual estilo WhatsApp Web:
//   - avatar com foto/inicial
//   - linha 1: nome + timestamp da última msg
//   - linha 2: preview da última msg (ícone + texto se for mídia) + badge unread
//   - barra lateral chat-accent indica conversa ativa na flutuante
export function ChatSidebarItem({
  conv,
  active,
  onClick,
}: ChatSidebarItemProps): React.ReactElement {
  const hasUnread = conv.unreadCount > 0

  const previewPrefix = previewPrefixFromDirection(conv.lastMessageDirection)

  const preview = derivePreview(conv)

  return (
    // div + role="button" pra acomodar <Link> aninhado no nome (HTML não
    // permite <a> dentro de <button>). Keyboard handling explícito porque
    // role=button precisa do mapeamento manual de Enter/Space.
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={cn(
        'relative flex w-full cursor-pointer items-start gap-3 border-b border-border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-accent' : 'hover:bg-accent/60',
      )}
      aria-current={active ? 'true' : undefined}
    >
      {active && (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1 bg-chat-accent"
        />
      )}

      {/* Avatar: tenta foto do WhatsApp via presigned URL; fallback pra
          inicial colorida (cor estável por clientId). */}
      <ContactAvatar
        contactId={conv.whatsappContactId}
        name={conv.client.name}
        colorSeed={conv.client.id}
        size={40}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <Link
            to={`/clients/${conv.client.id}`}
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'truncate text-sm hover:underline',
              hasUnread ? 'font-semibold' : 'font-medium',
            )}
            title={`Abrir cadastro de ${conv.client.name}`}
          >
            {conv.client.name}
            {conv.client.isVip && (
              <span className="ml-1.5 rounded bg-warning/15 px-1 py-0.5 text-[10px] font-medium text-warning">
                VIP
              </span>
            )}
          </Link>
          <span
            className={cn(
              'shrink-0 text-xs',
              hasUnread ? 'font-medium text-chat-accent' : 'text-muted-foreground',
            )}
          >
            {displayRelativeTime(conv.lastMessageAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <div
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 text-xs',
              hasUnread
                ? 'font-medium text-foreground'
                : 'text-muted-foreground',
            )}
          >
            {previewPrefix && (
              <span className="shrink-0">{previewPrefix}</span>
            )}
            {preview.icon}
            <span className="truncate">{preview.text}</span>
          </div>
          {hasUnread && (
            <span className="shrink-0 rounded-full bg-chat-accent px-1.5 py-0.5 text-[10px] font-medium leading-none text-chat-accent-foreground">
              {conv.unreadCount > 99 ? '99+' : conv.unreadCount}
            </span>
          )}
        </div>

        {/* Linha 3 — chip do funil. Quando journey está em 'lead' e há
            substage, mostra o substage (mais informativo que "Lead"
            genérico). Nos demais stages, mostra o stage. Sem journey
            ativa, a linha não renderiza. */}
        {conv.currentJourneyStage && (
          <div className="mt-1">
            {conv.currentJourneyStage === 'lead' &&
            conv.currentLeadSubstage ? (
              <span
                className={cn(
                  'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium',
                  LEAD_SUBSTAGE_BADGE_CLASS[conv.currentLeadSubstage],
                )}
              >
                {LEAD_SUBSTAGE_LABELS_SHORT[conv.currentLeadSubstage]}
              </span>
            ) : (
              <span
                className={cn(
                  'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium',
                  STAGE_BADGE_CLASS[conv.currentJourneyStage],
                )}
              >
                {STAGE_LABELS_SHORT[conv.currentJourneyStage]}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
