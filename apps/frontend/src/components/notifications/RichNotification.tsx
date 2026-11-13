import {
  ClipboardList,
  MessageCircle,
  Recycle,
  Sheet as SheetIcon,
  Sparkles,
  Tag,
  X,
} from 'lucide-react'
import type { JourneyStage } from '@/api/journeys'
import type { LeadSubstage } from '@/api/leads'
import { ContactAvatar } from '@/components/chat/ContactAvatar'
import { Button } from '@/components/ui/button'
import { displayRelativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  STAGE_BADGE_CLASS,
  STAGE_LABELS_SHORT,
} from '@/pages/journeys/journeyLabels'
import {
  LEAD_SUBSTAGE_BADGE_CLASS,
  LEAD_SUBSTAGE_LABELS_SHORT,
} from '@/pages/leads/leadSubstageLabels'

// =====================================================================
// RichNotification — layout próprio das notificações de chat/lead, exibidas
// no canto inferior direito via Sonner (`toast.custom`). 3 variants:
//
//   - `message`: msg WhatsApp em conversa já existente.
//                avatar + nome + preview + tempo + "Responder".
//   - `lead-whatsapp`: nascimento de lead via WhatsApp (msg inbound criou
//                a journey ativa). Mescla msg + lead — "Novo lead" no header,
//                origem WhatsApp explícita, foto + preview da msg que criou
//                o lead + tempo + "Abrir conversa".
//   - `lead`: lead via canal não-WhatsApp (form/sheets/recycling/other).
//                ícone da origem + "Novo lead" + nome + label da origem +
//                tempo + "Abrir leads".
//
// Posição: top-right é do Toaster default (mutations); estas vão no
// bottom-right via Toaster dedicado em App.tsx.
// =====================================================================

interface ActionHandler {
  label: string
  onClick: () => void
}

interface MessageVariantProps {
  variant: 'message'
  contactId: string | null
  clientId: string
  clientName: string
  preview: string
  isoTime: string
  // Stage/substage da journey ativa do cliente. Usado pra renderizar o
  // mesmo chip de funil do ChatSidebarItem. Null quando cliente não tem
  // journey ativa (raro pra inbound) — chip não renderiza.
  journeyStage: JourneyStage | null
  leadSubstage: LeadSubstage | null
  action: ActionHandler
  onDismiss: () => void
}

interface LeadWhatsappVariantProps {
  variant: 'lead-whatsapp'
  contactId: string | null
  clientId: string
  clientName: string
  preview: string
  isoTime: string
  journeyStage: JourneyStage | null
  leadSubstage: LeadSubstage | null
  action: ActionHandler
  onDismiss: () => void
}

type LeadSource =
  | 'form'
  | 'sheets'
  | 'manual'
  | 'recycling'
  | 'imported'
  | 'other'

interface LeadVariantProps {
  variant: 'lead'
  source: LeadSource
  clientId: string
  clientName: string
  isoTime: string
  // Lead non-WhatsApp criado via createExternalLead nasce sempre stage='lead'
  // substage='new'. Mantido tipado pra consistência entre variants.
  journeyStage: JourneyStage | null
  leadSubstage: LeadSubstage | null
  action: ActionHandler
  onDismiss: () => void
}

type RichNotificationProps =
  | MessageVariantProps
  | LeadWhatsappVariantProps
  | LeadVariantProps

const SOURCE_LABEL: Record<LeadSource, string> = {
  form: 'Formulário',
  sheets: 'Planilha',
  manual: 'Cadastro manual',
  recycling: 'Reciclagem',
  imported: 'Importação',
  other: 'Outra origem',
}

function SourceIcon({
  source,
  className,
}: {
  source: LeadSource
  className?: string
}): React.ReactElement {
  switch (source) {
    case 'form':
      return <ClipboardList className={className} />
    case 'sheets':
      return <SheetIcon className={className} />
    case 'recycling':
      return <Recycle className={className} />
    case 'imported':
    case 'other':
      return <Tag className={className} />
    case 'manual':
      return <Sparkles className={className} />
  }
}

export function RichNotification(props: RichNotificationProps): React.ReactElement {
  return (
    <div
      className={cn(
        'pointer-events-auto flex w-[360px] max-w-[calc(100vw-2rem)] items-start gap-3',
        'rounded-lg border border-border bg-card p-3 shadow-xl',
      )}
      role="status"
      aria-live="polite"
    >
      {/* Slot esquerdo: avatar (variants com foto) ou ícone de origem (lead). */}
      <div className="shrink-0">
        {props.variant === 'lead' ? (
          <div className="flex size-10 items-center justify-center rounded-full bg-info/15 text-info">
            <SourceIcon source={props.source} className="size-5" />
          </div>
        ) : (
          <ContactAvatar
            contactId={props.contactId}
            name={props.clientName}
            colorSeed={props.clientId}
            size={40}
          />
        )}
      </div>

      {/* Corpo */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className="min-w-0 flex items-center gap-1.5">
            {props.variant === 'lead-whatsapp' && (
              <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                Novo lead
              </span>
            )}
            {props.variant === 'lead' && (
              <span className="shrink-0 rounded bg-success/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                Novo lead
              </span>
            )}
            <span className="truncate text-sm font-semibold text-foreground">
              {props.clientName}
            </span>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {displayRelativeTime(props.isoTime)}
          </span>
        </div>

        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          {props.variant === 'lead-whatsapp' && (
            <>
              <MessageCircle className="size-3 shrink-0 text-success" />
              <span className="shrink-0">via WhatsApp</span>
              <span className="shrink-0">·</span>
            </>
          )}
          {props.variant === 'lead' && (
            <>
              <SourceIcon source={props.source} className="size-3 shrink-0" />
              <span className="truncate">via {SOURCE_LABEL[props.source]}</span>
            </>
          )}
          {(props.variant === 'message' || props.variant === 'lead-whatsapp') && (
            <span className="truncate">{props.preview}</span>
          )}
        </div>

        {/* Chip do funil — mesmo pattern do ChatSidebarItem. Quando journey
            está em 'lead' e há substage, mostra o substage (mais informativo
            que "Lead" genérico). Nos demais stages, mostra o stage. */}
        {props.journeyStage && (
          <div className="mt-1">
            {props.journeyStage === 'lead' && props.leadSubstage ? (
              <span
                className={cn(
                  'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium',
                  LEAD_SUBSTAGE_BADGE_CLASS[props.leadSubstage],
                )}
              >
                {LEAD_SUBSTAGE_LABELS_SHORT[props.leadSubstage]}
              </span>
            ) : (
              <span
                className={cn(
                  'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium',
                  STAGE_BADGE_CLASS[props.journeyStage],
                )}
              >
                {STAGE_LABELS_SHORT[props.journeyStage]}
              </span>
            )}
          </div>
        )}

        <div className="mt-2 flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              props.action.onClick()
              props.onDismiss()
            }}
          >
            {props.action.label}
          </Button>
        </div>
      </div>

      {/* Fechar */}
      <button
        type="button"
        onClick={props.onDismiss}
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label="Fechar notificação"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
