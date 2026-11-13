import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Search, SlidersHorizontal } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useConversations } from '@/hooks/useConversations'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useWhatsappChannels } from '@/hooks/useWhatsappChannels'
import type { Conversation, FindConversationsQuery } from '@/api/conversations'
import { JOURNEY_STAGES, type JourneyStage } from '@/api/journeys'
import { LEAD_SUBSTAGES, type LeadSubstage } from '@/api/leads'
import {
  STAGE_BADGE_CLASS,
  STAGE_LABELS_SHORT,
} from '@/pages/journeys/journeyLabels'
import {
  LEAD_SUBSTAGE_BADGE_CLASS,
  LEAD_SUBSTAGE_LABELS_SHORT,
} from '@/pages/leads/leadSubstageLabels'
import { cn } from '@/lib/utils'
import { useChatStore } from '@/stores/chatStore'
import { ChatSidebarItem } from './ChatSidebarItem'

const PAGE_SIZE = 50
// Estimativa inicial — items são medidos depois via `measureElement`. O valor
// de bootstrap importa pra cálculo de overscan/scroll antes da 1ª medição.
// Variação real: ~68px sem chip de funil, ~88px com chip (linha 3 dedicada).
const ITEM_HEIGHT_ESTIMATE = 84

interface ChatSidebarPanelProps {
  // Fechar o drawer mobile ao clicar numa conversa — caller controla
  // (no desktop a sidebar é fixa, então fica undefined).
  onSelect?: () => void
}

// Direção: filtro principal do dia-a-dia. `received` (default) = última msg
// foi do cliente — fila de "preciso responder". `sent` = última nossa, em
// "aguardando retorno". `all` = sem filtro.
type DirectionFilter = 'received' | 'sent' | 'all'
type ReadFilter = 'all' | 'unread'

const DIRECTION_OPTIONS: ReadonlyArray<{ value: DirectionFilter; label: string }> = [
  { value: 'received', label: 'Recebidas' },
  { value: 'sent', label: 'Enviadas' },
  { value: 'all', label: 'Todas' },
]

// Painel CHAT da sidebar — busca + filtros (popover) + segmented por
// direção + lista virtualizada. Click numa conversa abre a flutuante; o
// painel não renderiza o pane direito (não é mais "modo chat" tela cheia).
//
// Virtualização via @tanstack/react-virtual: renderiza só os itens
// visíveis no viewport. Pra 50 conversas o ganho é modesto, mas o setup
// trivial protege contra dor quando bibliotecas de tenant grandes
// (1000+) entrarem.
//
// Todos os filtros (direção, estado, estágio, substágio, canal) são
// aplicados cliente-side sobre a página atual. Backend filter dedicado
// entra quando virar dor real (e o `q` da busca continua server-side).
export function ChatSidebarPanel({
  onSelect,
}: ChatSidebarPanelProps): React.ReactElement {
  const [searchInput, setSearchInput] = useState('')
  const [direction, setDirection] = useState<DirectionFilter>('received')
  const [readState, setReadState] = useState<ReadFilter>('all')
  const [selectedStages, setSelectedStages] = useState<JourneyStage[]>([])
  const [selectedSubstages, setSelectedSubstages] = useState<LeadSubstage[]>([])
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([])

  const debouncedSearch = useDebouncedValue(searchInput.trim(), 250)

  const query: FindConversationsQuery = useMemo(
    () => ({
      page: 1,
      pageSize: PAGE_SIZE,
      q: debouncedSearch || undefined,
    }),
    [debouncedSearch],
  )

  const { data, isLoading, isError } = useConversations(query)
  // Canais pra montar o filtro. Tenant geralmente tem 1-3 canais — pageSize
  // generoso evita paginar. Se um dia houver dezenas, vira UI com busca.
  const { data: channelsData } = useWhatsappChannels({ pageSize: 50 })

  // Memoiza o array pra evitar nova ref em cada render — sem isso o
  // useMemo abaixo invalida toda hora.
  const allItems = useMemo(() => data?.items ?? [], [data?.items])
  const channels = channelsData?.items ?? []

  const items = useMemo(() => {
    let list = allItems
    if (direction === 'received') {
      list = list.filter((c) => c.lastMessageDirection === 'inbound')
    } else if (direction === 'sent') {
      list = list.filter((c) => c.lastMessageDirection === 'outbound')
    }
    if (readState === 'unread') {
      list = list.filter((c) => c.unreadCount > 0)
    }
    if (selectedStages.length > 0 || selectedSubstages.length > 0) {
      list = list.filter((c) => {
        const stageMatch =
          c.currentJourneyStage !== null &&
          selectedStages.includes(c.currentJourneyStage)
        const substageMatch =
          c.currentLeadSubstage !== null &&
          selectedSubstages.includes(c.currentLeadSubstage)
        return stageMatch || substageMatch
      })
    }
    if (selectedChannelIds.length > 0) {
      list = list.filter((c) => selectedChannelIds.includes(c.channel.id))
    }
    return list
  }, [
    allItems,
    direction,
    readState,
    selectedStages,
    selectedSubstages,
    selectedChannelIds,
  ])

  // Contagem só dos filtros do popover (direção fica de fora — está
  // sempre visível na linha do segmented e tem default não-neutro).
  const popoverFiltersCount =
    (readState !== 'all' ? 1 : 0) +
    selectedStages.length +
    selectedSubstages.length +
    selectedChannelIds.length

  const clearPopoverFilters = (): void => {
    setReadState('all')
    setSelectedStages([])
    setSelectedSubstages([])
    setSelectedChannelIds([])
  }

  const toggleStage = (s: JourneyStage): void => {
    setSelectedStages((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    )
  }
  const toggleSubstage = (s: LeadSubstage): void => {
    setSelectedSubstages((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    )
  }
  const toggleChannel = (id: string): void => {
    setSelectedChannelIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const activeConversationId = useChatStore((s) => s.floating.conversationId)
  const openConversation = useChatStore((s) => s.openConversation)

  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ITEM_HEIGHT_ESTIMATE,
    overscan: 6,
    getItemKey: (index) => items[index]?.id ?? index,
    // Mede altura real de cada item após render — items com chip de funil
    // (linha 3) são ~20px mais altos que items sem. Sem isso, o virtualizer
    // posiciona items adjacentes a `estimateSize` de distância e o conteúdo
    // sobrepõe o item seguinte.
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  const handleClick = (conv: Conversation): void => {
    openConversation(conv.id)
    onSelect?.()
  }

  const emptyMessage = debouncedSearch
    ? 'Nenhuma conversa pra esta busca.'
    : popoverFiltersCount > 0
      ? 'Nenhuma conversa pros filtros atuais.'
      : direction === 'received'
        ? 'Sem mensagens recebidas.'
        : direction === 'sent'
          ? 'Sem mensagens enviadas.'
          : 'Sem conversas ainda.'

  return (
    <div className="chat-scope flex h-full w-full flex-col bg-background">
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar nome ou telefone"
              className="h-9 pl-8"
            />
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="relative h-9 shrink-0 px-2.5"
                aria-label="Filtros"
              >
                <SlidersHorizontal className="size-4" />
                {popoverFiltersCount > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-chat-accent px-1 text-[10px] font-medium leading-none text-chat-accent-foreground">
                    {popoverFiltersCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-3">
              <div className="space-y-3">
                <FilterSection title="Estado">
                  <div className="flex gap-1">
                    {(['all', 'unread'] as const).map((v) => (
                      <SegmentChip
                        key={v}
                        active={readState === v}
                        onClick={() => setReadState(v)}
                      >
                        {v === 'all' ? 'Todas' : 'Não-lidas'}
                      </SegmentChip>
                    ))}
                  </div>
                </FilterSection>

                <FilterSection title="Estágio">
                  <div className="flex flex-wrap gap-1">
                    {JOURNEY_STAGES.map((stage) => {
                      const active = selectedStages.includes(stage)
                      return (
                        <button
                          key={stage}
                          type="button"
                          onClick={() => toggleStage(stage)}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[11px] font-medium transition-all',
                            active
                              ? cn(
                                  STAGE_BADGE_CLASS[stage],
                                  'ring-1 ring-current',
                                )
                              : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                          )}
                          aria-pressed={active}
                        >
                          {STAGE_LABELS_SHORT[stage]}
                        </button>
                      )
                    })}
                  </div>
                </FilterSection>

                <FilterSection title="Substágio de lead">
                  <div className="flex flex-wrap gap-1">
                    {LEAD_SUBSTAGES.map((sub) => {
                      const active = selectedSubstages.includes(sub)
                      return (
                        <button
                          key={sub}
                          type="button"
                          onClick={() => toggleSubstage(sub)}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-[11px] font-medium transition-all',
                            active
                              ? cn(
                                  LEAD_SUBSTAGE_BADGE_CLASS[sub],
                                  'ring-1 ring-current',
                                )
                              : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                          )}
                          aria-pressed={active}
                        >
                          {LEAD_SUBSTAGE_LABELS_SHORT[sub]}
                        </button>
                      )
                    })}
                  </div>
                </FilterSection>

                {channels.length > 0 && (
                  <FilterSection title="Canal">
                    <div className="flex flex-wrap gap-1">
                      {channels.map((ch) => {
                        const active = selectedChannelIds.includes(ch.id)
                        return (
                          <button
                            key={ch.id}
                            type="button"
                            onClick={() => toggleChannel(ch.id)}
                            className={cn(
                              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors',
                              active
                                ? 'bg-accent text-accent-foreground ring-1 ring-current'
                                : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                            )}
                            aria-pressed={active}
                          >
                            {ch.color && (
                              <span
                                aria-hidden
                                className="size-2 rounded-full"
                                style={{ backgroundColor: ch.color }}
                              />
                            )}
                            {ch.name}
                          </button>
                        )
                      })}
                    </div>
                  </FilterSection>
                )}

                {popoverFiltersCount > 0 && (
                  <button
                    type="button"
                    onClick={clearPopoverFilters}
                    className="w-full rounded py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Segmented control de direção: Recebidas (default) / Enviadas / Todas.
            Substitui o antigo Todas/Não-lidas — esse virou um filtro do
            popover, já que direção é o critério mais usado no dia-a-dia. */}
        <div className="flex gap-1 rounded-md border border-input bg-background p-1">
          {DIRECTION_OPTIONS.map((opt) => {
            const isActive = direction === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDirection(opt.value)}
                className={cn(
                  'flex-1 rounded px-2 py-1 text-xs font-medium transition-colors',
                  isActive
                    ? 'bg-chat-accent text-chat-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
                aria-pressed={isActive}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      <div ref={parentRef} className="flex-1 overflow-y-auto">
        {isLoading && allItems.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            Carregando…
          </div>
        ) : isError ? (
          <div className="p-6 text-center text-sm text-error">
            Erro ao carregar conversas.
          </div>
        ) : items.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        ) : (
          // O wrapper "fantasma" tem altura total — o virtualizer posiciona
          // os items via transform absoluto. Sem isso, o scrollbar não
          // reflete o tamanho real da lista.
          <div
            style={{
              height: virtualizer.getTotalSize(),
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualizer.getVirtualItems().map((vi) => {
              const conv = items[vi.index]
              if (!conv) return null
              return (
                <div
                  key={vi.key}
                  ref={virtualizer.measureElement}
                  data-index={vi.index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vi.start}px)`,
                  }}
                >
                  <ChatSidebarItem
                    conv={conv}
                    active={conv.id === activeConversationId}
                    onClick={() => handleClick(conv)}
                  />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function FilterSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  )
}

function SegmentChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded px-2 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-chat-accent text-chat-accent-foreground'
          : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
      )}
      aria-pressed={active}
    >
      {children}
    </button>
  )
}
