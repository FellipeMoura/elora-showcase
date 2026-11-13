import type { LeadCard as LeadCardData, LeadSubstage } from '@/api/leads'
import { cn } from '@/lib/utils'
import { LeadCard } from './LeadCard'
import {
  LEAD_SUBSTAGE_COLUMN_ACCENT,
  LEAD_SUBSTAGE_LABELS,
} from './leadSubstageLabels'

interface LeadColumnProps {
  substage: LeadSubstage
  items: LeadCardData[]
  total: number
  onOpenLead: (lead: LeadCardData) => void
  onOpenChat: (lead: LeadCardData) => void
}

// Coluna fixa do kanban. Composição custom — kanban é caso fora do catálogo
// padrão de listagem (PageContainer + Table), justificado pelo domínio leads
// requerer visão paralela por substage. Sem DnD (cascata automática) e sem
// renderizar colunas vazias (filtragem feita no caller).
//
// Paginação por coluna fica como follow-up — board hoje retorna 1ª página de
// cada substage; quando total excede o pageSize, mostramos indicador no
// rodapé. Ajuste o pageSize do board page se 20 ficar apertado.
export function LeadColumn({
  substage,
  items,
  total,
  onOpenLead,
  onOpenChat,
}: LeadColumnProps): React.ReactElement {
  const hasMore = items.length < total

  return (
    <div
      className={cn(
        'flex h-full w-72 shrink-0 flex-col rounded-md border border-t-[3px] border-border bg-surface',
        LEAD_SUBSTAGE_COLUMN_ACCENT[substage],
      )}
    >
      <header className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-medium">
          {LEAD_SUBSTAGE_LABELS[substage]}
        </span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          {total}
        </span>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        <ul className="flex flex-col gap-1.5">
          {items.map((lead) => (
            <li key={lead.id}>
              <LeadCard
                lead={lead}
                onOpen={onOpenLead}
                onOpenChat={onOpenChat}
              />
            </li>
          ))}
        </ul>

        {hasMore && (
          <div className="mt-2 text-center text-[11px] text-muted-foreground">
            mostrando {items.length} de {total}
          </div>
        )}
      </div>
    </div>
  )
}
