import * as React from 'react'
import { MoreHorizontal, Search } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useElementWidth } from '@/hooks/useElementWidth'
import { cn } from '@/lib/utils'

// =====================================================================
// PageToolbar — barra de ferramentas universal das páginas. Hospeda
// busca, filtros e ações de página numa única faixa de altura fixa que
// se mantém sticky no topo do conteúdo.
//
// Estratégia de colapso (auto-medição, degradação em 3 steps):
//   - Mede a própria largura via ResizeObserver.
//   - Cada Filter/Action declara `minWidth` (orçamento) e `priority`.
//   - Enquanto não cabe, degrada na ordem (menos → mais agressivo):
//       1. Actions perdem label (icon-only) — trailing primeiro, depois
//          leading. Menor priority perde primeiro.
//       2. Filters colapsam pro popover "Mais opções" (menor priority
//          primeiro; default 0 = saem antes).
//       3. Actions colapsam pro popover (menor priority primeiro;
//          default 100 = saem depois dos filters).
//     Para no mínimo necessário — só colapsa quem precisa colapsar.
//   - Search sempre visível, ocupa o espaço residual (flex-1 min-w-0).
//   - Leading actions e actions com popover próprio nunca vão pro
//     popover (leading = âncora de navegação; popover próprio evita
//     menu-dentro-de-menu). Ambas ainda podem virar icon-only.
//   - Se sobrou só 1 item pra colapsar, mantém inline: 1 no popover
//     custa quase o mesmo que caber apertado, e degrada UX à toa.
//
// API:
//   <PageToolbar>
//     <PageToolbar.Search value={s} onChange={setS} placeholder="…" />
//     <PageToolbar.Filter label="Status" minWidth={220} priority={10}>
//       <ButtonGroup …/>
//     </PageToolbar.Filter>
//     <PageToolbar.Action icon={<Plus />} label="Novo" onClick={…} />
//   </PageToolbar>
// =====================================================================

const GAP = 8 // gap-2 em px — bate com `gap-2` do flex container
const SEARCH_MIN = 220
const OVERFLOW_BUTTON_WIDTH = 44 // botão ícone (h-10 w-10) + nada de label
const FILTER_DEFAULT_MIN = 180
const ACTION_DEFAULT_MIN_WITH_LABEL = 140
const ACTION_DEFAULT_MIN_ICON_ONLY = 44

// ─── Subcomponent props ──────────────────────────────────────────────

interface SearchProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  'aria-label'?: string
  id?: string
}

interface FilterProps {
  /** Texto mostrado como label do filtro quando colapsado no popover. */
  label: string
  /** Orçamento de largura inline em pixels. Default 180. */
  minWidth?: number
  /** Maior = some por último. Sem priority, o último JSX some primeiro. */
  priority?: number
  children: React.ReactNode
}

interface ActionProps {
  label?: string
  icon?: React.ReactNode
  onClick?: () => void
  variant?: ButtonProps['variant']
  disabled?: boolean
  /** Override do orçamento de largura. Por padrão estima com base em ter label. */
  minWidth?: number
  /** `leading` posiciona antes da busca (útil pra "voltar"). Default `trailing`. */
  placement?: 'leading' | 'trailing'
  /**
   * Maior = colapsa por último. Default 100 (actions saem depois dos
   * filters, que têm default 0). Leading actions nunca colapsam,
   * independente do valor aqui.
   */
  priority?: number
  'aria-label'?: string
}

// Subcomponents são marker components — não renderizam diretamente.
// O root <PageToolbar> inspeciona os filhos via `child.type` e decide
// onde cada um aparece (inline, popover, fixo à direita).

function PageToolbarSearch(_props: SearchProps): React.ReactElement | null {
  return null
}
PageToolbarSearch.displayName = 'PageToolbar.Search'

function PageToolbarFilter(_props: FilterProps): React.ReactElement | null {
  return null
}
PageToolbarFilter.displayName = 'PageToolbar.Filter'

function PageToolbarAction(_props: ActionProps): React.ReactElement | null {
  return null
}
PageToolbarAction.displayName = 'PageToolbar.Action'

// ─── Root ────────────────────────────────────────────────────────────

interface PageToolbarRootProps {
  children: React.ReactNode
  className?: string
}

function PageToolbarRoot({
  children,
  className,
}: PageToolbarRootProps): React.ReactElement {
  const containerRef = React.useRef<HTMLDivElement>(null)
  const width = useElementWidth(containerRef)

  // Particiona os filhos por tipo. Order do JSX é preservada dentro de cada
  // partição — só `priority` controla quem sai pro overflow primeiro.
  //
  // Tipagem explícita do retorno + cast via `unknown` é defensivo: em
  // @types/react v19+, `child.props` é `unknown`, então sem o duplo cast
  // alguns tsservers reclamam de spread `unknown` adiante.
  type ActionEntry = { key: React.Key; props: ActionProps }
  type ToolbarPartitions = {
    searchProps: SearchProps | null
    filters: Array<{ key: React.Key; props: FilterProps }>
    leadingActions: ActionEntry[]
    actions: ActionEntry[]
  }

  const { searchProps, filters, leadingActions, actions } = React.useMemo<ToolbarPartitions>(() => {
    let searchProps: SearchProps | null = null
    const filters: ToolbarPartitions['filters'] = []
    const leadingActions: ToolbarPartitions['leadingActions'] = []
    const actions: ToolbarPartitions['actions'] = []

    // Walk recursivo achata fragments: consumidor pode agrupar actions
    // condicionais com `<>…</>` (ex: `{isDraft && <><Action /><Action /></>}`)
    // sem perda silenciosa. Sem isso, `React.Children.forEach` enxerga o
    // fragment como filho e dropa as actions dentro porque `child.type`
    // não bate com nenhum marker component.
    let counter = 0
    const walk = (nodes: React.ReactNode): void => {
      React.Children.forEach(nodes, (child) => {
        if (!React.isValidElement(child)) return
        if (child.type === React.Fragment) {
          walk((child.props as { children?: React.ReactNode }).children)
          return
        }
        const key = child.key ?? counter++
        const props = child.props as unknown
        if (child.type === PageToolbarSearch) {
          searchProps = props as SearchProps
        } else if (child.type === PageToolbarFilter) {
          filters.push({ key, props: props as FilterProps })
        } else if (child.type === PageToolbarAction) {
          const actionProps = props as ActionProps
          if (actionProps.placement === 'leading') {
            leadingActions.push({ key, props: actionProps })
          } else {
            actions.push({ key, props: actionProps })
          }
        }
      })
    }
    walk(children)

    return { searchProps, filters, leadingActions, actions }
  }, [children])

  // Degradação em steps (ver comentário no header):
  //   1. delabel trailing → 2. delabel leading → 3. overflow filters →
  //   4. overflow trailing actions. Cada step remove só o necessário.
  const {
    inlineFilters,
    overflowFilters,
    inlineLeadingActions,
    inlineActions,
    overflowActions,
  } = React.useMemo(() => {
    if (width == null) {
      return {
        inlineFilters: filters,
        overflowFilters: [] as typeof filters,
        inlineLeadingActions: leadingActions.map((a) => ({ ...a, iconOnly: false })),
        inlineActions: actions.map((a, i) => ({ ...a, iconOnly: false, originalIdx: i })),
        overflowActions: [] as typeof actions,
      }
    }

    const filterBudget = (f: { props: FilterProps }) =>
      (f.props.minWidth ?? FILTER_DEFAULT_MIN) + GAP
    const actionBudget = (a: { props: ActionProps }, iconOnly: boolean) => {
      const hasLabelInline = !!a.props.label && !iconOnly
      const min =
        a.props.minWidth ??
        (hasLabelInline ? ACTION_DEFAULT_MIN_WITH_LABEL : ACTION_DEFAULT_MIN_ICON_ONLY)
      return min + GAP
    }

    const leadingIconOnly = new Set<number>()
    const trailingIconOnly = new Set<number>()
    const overflowFilterIdx = new Set<number>()
    const overflowActionIdx = new Set<number>()

    const compute = (): number => {
      const leadingSum = leadingActions.reduce(
        (sum, a, i) => sum + actionBudget(a, leadingIconOnly.has(i)),
        0,
      )
      const inlineFiltersSum = filters.reduce((sum, f, i) => {
        if (overflowFilterIdx.has(i)) return sum
        return sum + filterBudget(f)
      }, 0)
      const inlineActionsSum = actions.reduce((sum, a, i) => {
        if (overflowActionIdx.has(i)) return sum
        return sum + actionBudget(a, trailingIconOnly.has(i))
      }, 0)
      const overflowCount = overflowFilterIdx.size + overflowActionIdx.size
      const overflowButton = overflowCount > 0 ? OVERFLOW_BUTTON_WIDTH + GAP : 0
      return (
        leadingSum + SEARCH_MIN + GAP + inlineFiltersSum + inlineActionsSum + overflowButton
      )
    }

    // Ordena índices por priority asc; empate: JSX posterior primeiro.
    const orderByPriority = (
      entries: Array<{ props: { priority?: number } }>,
      defaultPriority: number,
    ): number[] =>
      entries
        .map((e, i) => ({ i, priority: e.props.priority ?? defaultPriority }))
        .sort((a, b) => {
          if (a.priority !== b.priority) return a.priority - b.priority
          return b.i - a.i
        })
        .map((x) => x.i)

    if (compute() > width) {
      // Step 1: delabel trailing actions (só as que têm label).
      for (const i of orderByPriority(actions, 100)) {
        if (!actions[i].props.label) continue
        trailingIconOnly.add(i)
        if (compute() <= width) break
      }
    }

    if (compute() > width) {
      // Step 2: delabel leading actions.
      for (const i of orderByPriority(leadingActions, 100)) {
        if (!leadingActions[i].props.label) continue
        leadingIconOnly.add(i)
        if (compute() <= width) break
      }
    }

    if (compute() > width) {
      // Step 3: colapsar filtros pro popover.
      for (const i of orderByPriority(filters, 0)) {
        overflowFilterIdx.add(i)
        if (compute() <= width) break
      }
    }

    if (compute() > width) {
      // Step 4: colapsar trailing actions pro popover.
      for (const i of orderByPriority(actions, 100)) {
        overflowActionIdx.add(i)
        if (compute() <= width) break
      }
    }

    // Se sobrou 1 item no popover, mantém inline — 1 no popover custa
    // quase o mesmo que caber apertado e degrada a UX à toa.
    if (overflowFilterIdx.size + overflowActionIdx.size === 1) {
      overflowFilterIdx.clear()
      overflowActionIdx.clear()
    }

    return {
      inlineFilters: filters.filter((_, i) => !overflowFilterIdx.has(i)),
      overflowFilters: filters.filter((_, i) => overflowFilterIdx.has(i)),
      inlineLeadingActions: leadingActions.map((a, i) => ({
        ...a,
        iconOnly: leadingIconOnly.has(i),
      })),
      inlineActions: actions
        .map((a, i) => ({ ...a, iconOnly: trailingIconOnly.has(i), originalIdx: i }))
        .filter((a) => !overflowActionIdx.has(a.originalIdx)),
      overflowActions: actions.filter((_, i) => overflowActionIdx.has(i)),
    }
  }, [width, filters, actions, leadingActions])

  const overflowCount = overflowFilters.length + overflowActions.length

  return (
    <div
      ref={containerRef}
      className={cn(
        // Ilha sólida sobre o bg-page do PageContainer. Sem sticky/blur —
        // o scroll agora é interno na tabela, toolbar fica fixa por flex.
        'flex h-14 shrink-0 items-center gap-2',
        'rounded-md border border-border bg-background',
        'px-1.5',
        className,
      )}
    >
      {inlineLeadingActions.map(({ key, props, iconOnly }) => (
        <ActionButton key={key} {...props} iconOnly={iconOnly} />
      ))}

      {searchProps && <SearchInline {...searchProps} />}

      {inlineFilters.map((f) => (
        <div
          key={f.key}
          className="shrink-0"
          style={{ minWidth: f.props.minWidth ?? FILTER_DEFAULT_MIN }}
        >
          {f.props.children}
        </div>
      ))}

      {inlineActions.map(({ key, props, iconOnly }) => (
        <ActionButton key={key} {...props} iconOnly={iconOnly} />
      ))}

      {overflowCount > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="relative"
              aria-label={`Mais opções (${overflowCount})`}
            >
              <MoreHorizontal />
              <span
                className={cn(
                  'absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center',
                  'rounded-full bg-primary px-1 text-[10px] font-medium leading-none',
                  'text-primary-foreground',
                )}
                aria-hidden
              >
                {overflowCount}
              </span>
            </Button>
          </PopoverTrigger>
          {/* Popover dimensionado pelo conteúdo real (`width:max-content`),
              com piso = maior `minWidth` declarado entre os filtros
              colapsados (`+24` cobre o `p-3` lateral) e teto = viewport.
              Usar piso fixo gera barra de scroll quando o conteúdo
              renderizado é alguns pixels maior que a estimativa — deixar
              o popover crescer evita isso e a barra só aparece de fato
              quando o teto do viewport limita. */}
          <PopoverContent
            align="end"
            className="p-1 max-w-[calc(100vw-1rem)]"
            style={{
              width: 'max-content',
              minWidth: Math.max(
                240,
                ...overflowFilters.map(
                  (f) => (f.props.minWidth ?? FILTER_DEFAULT_MIN) + 24,
                ),
              ),
            }}
          >
            {overflowActions.map(({ key, props }) => (
              <OverflowActionItem key={key} {...props} />
            ))}
            {overflowActions.length > 0 && overflowFilters.length > 0 && (
              <div className="my-1 h-px bg-border" />
            )}
            {overflowFilters.length > 0 && (
              <div className="space-y-3 p-2">
                {overflowFilters.map((f) => (
                  <div key={f.key} className="space-y-1.5">
                    <div className="text-xs font-medium text-muted-foreground">
                      {f.props.label}
                    </div>
                    <div className="overflow-x-auto">{f.props.children}</div>
                  </div>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

// ─── Internal renderers ──────────────────────────────────────────────

function SearchInline({
  value,
  onChange,
  placeholder,
  id,
  'aria-label': ariaLabel,
}: SearchProps): React.ReactElement {
  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel ?? 'Buscar'}
        className="pl-9"
      />
    </div>
  )
}

function ActionButton({
  label,
  icon,
  onClick,
  variant = 'default',
  disabled,
  iconOnly,
  'aria-label': ariaLabel,
}: ActionProps & { iconOnly?: boolean }): React.ReactElement {
  const showLabel = !!label && !iconOnly
  return (
    <Button
      variant={variant}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
    >
      {icon}
      {showLabel && <span className="min-w-0 truncate">{label}</span>}
    </Button>
  )
}

// Item de menu do popover de overflow — usado quando uma action colapsa.
// Markup próprio (não Button) porque a semântica é "linha de menu" e o
// visual deve seguir o padrão de dropdowns do shadcn (padding baixo,
// alinhado à esquerda, hover em accent).
function OverflowActionItem({
  label,
  icon,
  onClick,
  variant,
  disabled,
  'aria-label': ariaLabel,
}: ActionProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      className={cn(
        'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
        'hover:bg-accent hover:text-accent-foreground',
        'focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none',
        'disabled:pointer-events-none disabled:opacity-50',
        '[&_svg]:size-4 [&_svg]:shrink-0',
        (variant === 'destructive' || variant === 'error') && 'text-error',
      )}
    >
      {icon}
      {label && <span className="truncate">{label}</span>}
    </button>
  )
}

// ─── Public compound API ─────────────────────────────────────────────

export const PageToolbar = Object.assign(PageToolbarRoot, {
  Search: PageToolbarSearch,
  Filter: PageToolbarFilter,
  Action: PageToolbarAction,
})

export type {
  SearchProps as PageToolbarSearchProps,
  FilterProps as PageToolbarFilterProps,
  ActionProps as PageToolbarActionProps,
}
