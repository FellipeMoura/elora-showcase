import { useNavigate } from 'react-router-dom'
import { AlertTriangle, CalendarClock, MessageSquare, Wallet } from 'lucide-react'
import type { DashboardOperational } from '@/api/dashboard'
import { openChatConversation } from '@/lib/chatBridge'
import {
  displayDateTime,
  displayIsoDate,
  displayMoney,
  displayRelativeTime,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { glassSurface } from './tokens'
import { useDashboardSummary } from './useDashboardSummary'

const CARD = cn('flex flex-col p-4', glassSurface)

const ROW =
  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent'

function ListCard({
  title,
  icon,
  count,
  empty,
  emptyLabel,
  children,
}: {
  title: string
  icon: React.ReactNode
  count: number
  empty: boolean
  emptyLabel: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className={CARD}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          {icon}
          {title}
        </h3>
        {count > 0 && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      {empty ? (
        <p className="px-2 py-3 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="-mx-1 max-h-56 space-y-0.5 overflow-y-auto pr-0.5">
          {children}
        </div>
      )}
    </div>
  )
}

// Bloco D — listas operacionais (semântica fixa, ignoram o filtro de período).
// Itens são clicáveis: D1 → caixa, D2 → agenda, D3 → conversa flutuante.
export function OperationalLists(): React.ReactElement {
  const navigate = useNavigate()
  const { data, isLoading } = useDashboardSummary()

  if (!data) {
    return (
      <div className="space-y-1.5" aria-busy={isLoading}>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className={cn(CARD, 'h-40', isLoading && 'animate-pulse')} />
        ))}
      </div>
    )
  }

  const op: DashboardOperational = data.operational

  return (
    <div className="space-y-1.5">
      {/* D1 — pagamentos vencendo / inadimplentes */}
      <ListCard
        title="Pagamentos a vencer"
        icon={<Wallet className="h-4 w-4 text-warning" />}
        count={op.upcomingPayments.length}
        empty={op.upcomingPayments.length === 0}
        emptyLabel="Nenhuma parcela vencendo ou vencida."
      >
        {op.upcomingPayments.map((p) => (
          <button
            key={p.id}
            type="button"
            className={ROW}
            onClick={() => navigate('/cashier')}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{p.clientName}</span>
              <span className="text-muted-foreground">
                Parcela {p.installment} · vence {displayIsoDate(p.dueDate)}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              {p.isOverdue && (
                <span className="inline-flex items-center gap-0.5 rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  vencida
                </span>
              )}
              <span className="font-medium tabular-nums">{displayMoney(p.amount)}</span>
            </span>
          </button>
        ))}
      </ListCard>

      {/* D2 — avaliações próximas (hoje/amanhã) */}
      <ListCard
        title="Avaliações próximas"
        icon={<CalendarClock className="h-4 w-4 text-info" />}
        count={op.upcomingEvaluations.length}
        empty={op.upcomingEvaluations.length === 0}
        emptyLabel="Nenhuma avaliação hoje ou amanhã."
      >
        {op.upcomingEvaluations.map((e) => (
          <button
            key={e.id}
            type="button"
            className={ROW}
            onClick={() => navigate('/agenda')}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{e.clientName}</span>
              <span className="text-muted-foreground">
                {displayDateTime(e.scheduledAt)}
                {e.professional ? ` · ${e.professional}` : ''}
              </span>
            </span>
          </button>
        ))}
      </ListCard>

      {/* D3 — conversas sem resposta há >2h */}
      <ListCard
        title="Conversas sem resposta"
        icon={<MessageSquare className="h-4 w-4 text-chat-accent" />}
        count={op.unansweredConversations.length}
        empty={op.unansweredConversations.length === 0}
        emptyLabel="Nenhuma conversa sem resposta."
      >
        {op.unansweredConversations.map((u) => (
          <button
            key={u.conversationId}
            type="button"
            className={ROW}
            onClick={() => openChatConversation(u.conversationId)}
          >
            <span className="min-w-0">
              <span className="block truncate font-medium">{u.clientName}</span>
              <span className="block truncate text-muted-foreground">
                {u.preview || '—'}
              </span>
            </span>
            <span className="shrink-0 text-muted-foreground">
              {displayRelativeTime(u.lastInboundAt)}
            </span>
          </button>
        ))}
      </ListCard>
    </div>
  )
}
