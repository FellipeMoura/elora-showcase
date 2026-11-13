import { useState } from 'react'
import { Link } from 'react-router-dom'
import { EllipsisVertical, UserRound, type LucideIcon } from 'lucide-react'
import type { Conversation } from '@/api/conversations'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface ConversationActionsProps {
  conv: Conversation
  // Chamado antes de levar o usuário pra outra página (detalhe do cliente).
  // Janela expandida/sheet mobile cobrem a página — quem renderiza decide se
  // recolhe/fecha.
  onNavigate?: () => void
  triggerClassName?: string
}

// Ações da conversa num popover ("⋮") — a janela flutuante é estreita, então
// nada de botões soltos no header. Mesmo componente do Frostie; por
// enquanto só "Detalhe do cliente" (as ações de clínica — agendar, funil —
// entram aqui quando forem definidas).
export function ConversationActions({
  conv,
  onNavigate,
  triggerClassName,
}: ConversationActionsProps): React.ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)

  const leave = (): void => {
    setMenuOpen(false)
    onNavigate?.()
  }

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          // Header da janela flutuante é drag handle — o clique no botão não
          // pode iniciar arrasto.
          onMouseDown={(e) => e.stopPropagation()}
          className={cn(
            'inline-flex size-9 items-center justify-center rounded',
            triggerClassName,
          )}
          aria-label="Ações da conversa"
          title="Ações da conversa"
        >
          <EllipsisVertical className="size-5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-60 flex-col">
        <MenuLink
          icon={UserRound}
          label="Detalhe do cliente"
          hint={conv.client.name}
          to={`/clients/${conv.client.id}`}
          onClick={leave}
        />
      </PopoverContent>
    </Popover>
  )
}

const ITEM_CLASS =
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground'

function MenuLink({
  icon: Icon,
  label,
  hint,
  to,
  onClick,
}: {
  icon: LucideIcon
  label: string
  hint?: string
  to: string
  onClick: () => void
}): React.ReactElement {
  return (
    <Link to={to} onClick={onClick} className={ITEM_CLASS}>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-col">
        <span>{label}</span>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
    </Link>
  )
}
