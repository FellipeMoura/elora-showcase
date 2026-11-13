import {
  CalendarCheck,
  FileText,
  MessageCircle,
  Recycle,
  Sheet as SheetIcon,
  SquareArrowOutUpRight,
  User,
} from 'lucide-react'
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { ContactAvatar } from '@/components/chat/ContactAvatar'
import type { LeadCard as LeadCardData } from '@/api/leads'
import { displayPhone, displayRelativeTime } from '@/lib/format'
import {
  derivePreview,
  previewPrefixFromDirection,
} from '@/lib/messagePreview'
import { cn } from '@/lib/utils'
import type { JourneySource } from '@/api/journeys'
import { SOURCE_LABELS } from '@/pages/journeys/journeyLabels'

interface LeadCardProps {
  lead: LeadCardData
  onOpen: (lead: LeadCardData) => void
  onOpenChat: (lead: LeadCardData) => void
}

function SourceIcon({ source }: { source: JourneySource }): React.ReactElement {
  const map: Record<JourneySource, React.ReactNode> = {
    whatsapp: <MessageCircle className="size-3.5" />,
    form: <FileText className="size-3.5" />,
    sheets: <SheetIcon className="size-3.5" />,
    manual: <User className="size-3.5" />,
    recycling: <Recycle className="size-3.5" />,
    imported: <FileText className="size-3.5" />,
    other: <FileText className="size-3.5" />,
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-muted-foreground">{map[source]}</span>
      </TooltipTrigger>
      <TooltipContent>{SOURCE_LABELS[source]}</TooltipContent>
    </Tooltip>
  )
}

// Formata `nextEvaluationAt` como "23/05 14h32" pra exibir compactamente no
// card de scheduled/rescheduled. Sem dependência de Intl pra manter leveza.
function formatEvaluationAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm} ${hh}h${mi}`
}

export function LeadCard({
  lead,
  onOpen,
  onOpenChat,
}: LeadCardProps): React.ReactElement {
  const hasConversation = Boolean(lead.conversationId)
  // "Sem resposta" — última mensagem da conversa veio do cliente, a clínica
  // está devendo retorno. Backend já sobe esses cards pro topo da coluna;
  // o destaque visual (borda warning + leve overlay) reforça a urgência.
  const waitingReply = lead.lastMessageDirection === 'inbound'
  const previewPrefix = previewPrefixFromDirection(lead.lastMessageDirection)
  const preview = derivePreview(lead)

  return (
    <div
      className={cn(
        'group relative rounded-md border border-border bg-card p-2.5',
        'transition-shadow hover:shadow-sm',
        waitingReply && 'border-l-3 border-l-warning ',
      )}
    >
      {/* Linha 1 — avatar + nome/telefone + ícone source */}
      <div className="flex items-start gap-2">
        <ContactAvatar
          contactId={lead.whatsappContactId}
          name={lead.clientName}
          colorSeed={lead.clientId}
          size={36}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium">
              {lead.clientName}
            </span>
            <SourceIcon source={lead.source} />
          </div>
          {lead.clientPhone && (
            <span className="truncate text-xs text-muted-foreground">
              {displayPhone(lead.clientPhone)}
            </span>
          )}
        </div>
      </div>

      {/* Linha 2 — preview da última mensagem (estilo CHAT sidebar) */}
      <div
        className={cn(
          'mt-1.5 flex items-center gap-1 text-xs',
          waitingReply
            ? 'font-medium text-foreground'
            : 'text-muted-foreground',
        )}
      >
        {previewPrefix && <span className="shrink-0">{previewPrefix}</span>}
        {preview.icon}
        <span className="truncate">{preview.text}</span>
      </div>

      {/* Linha 3 — próxima avaliação (quando houver) */}
      {lead.nextEvaluationAt && (
        <div className="mt-1.5 inline-flex items-center gap-1 rounded bg-info/15 px-1.5 py-0.5 text-xs font-medium text-info">
          <CalendarCheck className="size-3" />
          {formatEvaluationAt(lead.nextEvaluationAt)}
        </div>
      )}

      {/* Linha 4 — última atividade + ações */}
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {displayRelativeTime(lead.lastActivityAt)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpen(lead)}
            className="h-7 px-2 text-xs"
          >
            <SquareArrowOutUpRight className="text-primary" />
            Detalhe
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChat(lead)}
            disabled={!hasConversation}
            className="h-7 px-2 text-xs"
          >
            <WhatsAppIcon />
            Chat
          </Button>
        </div>
      </div>
    </div>
  )
}
