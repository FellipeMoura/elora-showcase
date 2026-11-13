import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import LucideIcon from '@/components/layout/LucideIcon'
import type { MenuNode } from '@/api/menus'
import { cn } from '@/lib/utils'

interface SidebarItemProps {
  node: MenuNode
  depth?: number
  onNavigate?: () => void
  // Lookup `path → count`. Folhas com path bate em entry da tabela
  // renderizam pill numérico ao lado do label. Pra evitar Rules-of-Hooks
  // (dependendo do path o hook chamado mudaria), a coleção é montada uma
  // vez no caller (`MenuPanel` em Sidebar.tsx) e passada aqui já resolvida.
  badges?: Record<string, number | undefined>
}

// Renderiza um nó do menu + seus filhos. Folhas viram NavLink (com active
// state via useMatch interno do NavLink). Grupos com filhos expandem/colapsam.
//
// Decisão: parent com `path` é tratado como link clicável; sem path é só
// um agrupador (clique apenas alterna o expand).
export function SidebarItem({
  node,
  depth = 0,
  onNavigate,
  badges,
}: SidebarItemProps): React.ReactElement {
  // Lookup do badge — count > 0 vira pill visível, undefined/0 some.
  // Normaliza o path removendo barras à esquerda (seed às vezes salva
  // com `/`, às vezes sem).
  const normalizedPath = node.path?.replace(/^\/+/, '')
  const badgeCount = normalizedPath ? badges?.[normalizedPath] : undefined
  const showBadge = typeof badgeCount === 'number' && badgeCount > 0
  const hasChildren = node.children.length > 0
  const [open, setOpen] = useState(true)

  // Cor customizada do ícone (config no catálogo de menus). Sem color =
  // undefined pra herdar cor via `currentColor` do estado do link/hover.
  const iconColor = node.color ?? undefined

  const indent = depth === 0 ? 'pl-3' : depth === 1 ? 'pl-9' : 'pl-14'

  if (hasChildren) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-md py-2 pr-2 text-sm font-medium text-foreground/80',
            'hover:bg-accent hover:text-accent-foreground',
            indent,
          )}
        >
          <span className="flex items-center gap-2">
            {node.icon && (
              <LucideIcon
                icon={node.icon}
                className="size-4 shrink-0"
                color={iconColor}
                aria-hidden
              />
            )}
            <span className="truncate">{node.label}</span>
          </span>
          <ChevronRight
            className={cn(
              'size-4 shrink-0 transition-transform',
              open && 'rotate-90',
            )}
            aria-hidden
          />
        </button>
        {open && (
          <div className="mt-0.5 flex flex-col gap-0.5">
            {node.children.map((child) => (
              <SidebarItem
                key={child.id}
                node={child}
                depth={depth + 1}
                onNavigate={onNavigate}
                badges={badges}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  // Folha: NavLink. Se não tem path, vira um item desabilitado (raro — seria
  // um menu mal configurado).
  if (!node.path) {
    return (
      <div
        className={cn(
          'flex items-center gap-2 rounded-md py-2 pr-2 text-sm text-muted-foreground',
          indent,
        )}
      >
        {node.icon && (
          <LucideIcon
            icon={node.icon}
            className="size-4 shrink-0"
            color={iconColor}
            aria-hidden
          />
        )}
        <span className="truncate">{node.label}</span>
      </div>
    )
  }

  return (
    <NavLink
      to={node.path}
      onClick={onNavigate}
      end
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md py-2 pr-2 text-sm font-medium',
          'hover:bg-accent hover:text-accent-foreground',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-foreground/80',
          indent,
        )
      }
    >
      {node.icon && (
        <LucideIcon
          icon={node.icon}
          className="size-4 shrink-0"
          color={iconColor}
          aria-hidden
        />
      )}
      <span className="flex-1 truncate">{node.label}</span>
      {showBadge && (
        <span
          className="ml-1 inline-flex min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-medium leading-none text-primary-foreground"
          aria-label={`${badgeCount} ${badgeCount === 1 ? 'item' : 'itens'}`}
        >
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </NavLink>
  )
}
