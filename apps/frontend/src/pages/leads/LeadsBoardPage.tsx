import { useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { ButtonGroup } from '@/components/ui/button-group'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useDragScroll } from '@/hooks/useDragScroll'
import { openChatConversation } from '@/lib/chatBridge'
import { cn } from '@/lib/utils'
import {
  LEAD_SUBSTAGES,
  type FindLeadsQuery,
  type LeadCard as LeadCardData,
  type LeadSubstage,
} from '@/api/leads'
import type { JourneySource } from '@/api/journeys'
import { useLeadsBoard } from '@/hooks/useLeads'
import { SOURCE_LABELS } from '@/pages/journeys/journeyLabels'
import { LeadColumn } from './LeadColumn'
import { LeadDetailSheet } from './LeadDetailSheet'
import { ClientFormSheet } from '@/pages/clients/ClientFormSheet'
import { LEAD_SUBSTAGE_LABELS_SHORT } from './leadSubstageLabels'

const PAGE_SIZE = 20

// "Idade" do lead = dias desde createdAt. Mapeia pra ageMin/ageMaxDays do
// backend. "Frias" (>7d) = ageMin=7 sem teto; demais usam ageMax = N.
type AgeFilter = 'all' | 'le3' | 'le7' | 'gt7'

const AGE_OPTIONS: ReadonlyArray<{ value: AgeFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'le3', label: '≤ 3d' },
  { value: 'le7', label: '≤ 7d' },
  { value: 'gt7', label: 'Frias' },
]

type SourceFilter = JourneySource | 'all'

const SOURCE_OPTIONS: ReadonlyArray<{ value: SourceFilter; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'whatsapp', label: SOURCE_LABELS.whatsapp },
  { value: 'manual', label: SOURCE_LABELS.manual },
  { value: 'form', label: SOURCE_LABELS.form },
  { value: 'recycling', label: SOURCE_LABELS.recycling },
]

function ageToQuery(age: AgeFilter): Pick<FindLeadsQuery, 'ageMinDays' | 'ageMaxDays'> {
  switch (age) {
    case 'le3':
      return { ageMaxDays: 3 }
    case 'le7':
      return { ageMaxDays: 7 }
    case 'gt7':
      return { ageMinDays: 7 }
    case 'all':
    default:
      return {}
  }
}

// Página do board de leads (kanban).
//
// Composição custom (fora do catálogo PageContainer + Table) — kanban é o
// caso justificado: operação por substage com visão paralela. Sem DnD
// porque substage é derivado por cascata automática; sem colunas vazias
// (não há pra onde arrastar e o sumário no toolbar mantém visibilidade
// dos zerados).
export function LeadsBoardPage(): React.ReactElement {
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [source, setSource] = useState<SourceFilter>('all')
  const [age, setAge] = useState<AgeFilter>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)

  const query: FindLeadsQuery = useMemo(
    () => ({
      page: 1,
      pageSize: PAGE_SIZE,
      search: debouncedSearch || undefined,
      source: source === 'all' ? undefined : source,
      ...ageToQuery(age),
    }),
    [debouncedSearch, source, age],
  )

  const { data, isLoading, isError, refetch, isFetching } = useLeadsBoard(query)

  const visibleColumns = useMemo(() => {
    if (!data) return []
    return LEAD_SUBSTAGES.filter((s) => (data.columns[s]?.total ?? 0) > 0)
  }, [data])

  const handleOpenChat = (lead: LeadCardData) => {
    if (lead.conversationId) {
      openChatConversation(lead.conversationId)
    }
  }

  const boardScrollRef = useRef<HTMLDivElement>(null)
  useDragScroll(boardScrollRef)

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Search
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Buscar por nome ou telefone"
        />
        <PageToolbar.Filter label="Idade" minWidth={260}>
          <ButtonGroup
            value={age}
            onChange={setAge}
            options={AGE_OPTIONS}
            aria-label="Filtrar por idade do lead"
          />
        </PageToolbar.Filter>
        <PageToolbar.Filter label="Origem" minWidth={420} priority={-1}>
          <ButtonGroup
            value={source}
            onChange={setSource}
            options={SOURCE_OPTIONS}
            aria-label="Filtrar por origem"
          />
        </PageToolbar.Filter>
        <PageToolbar.Action
          icon={<Plus />}
          label="Novo lead"
          onClick={() => setCreateOpen(true)}
        />
      </PageToolbar>

      {/* Sumário: contagens por substage incluindo zeros — visibilidade
          do funil mesmo quando coluna não é renderizada. */}
      {data && <SubstageSummary totals={data.totals} />}

      <div
        ref={boardScrollRef}
        className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden"
      >
        {isLoading ? (
          <BoardState text="Carregando leads…" />
        ) : isError ? (
          <BoardState
            text="Erro ao carregar leads."
            action={{ label: 'Tentar novamente', onClick: () => refetch() }}
          />
        ) : visibleColumns.length === 0 ? (
          <BoardState
            text={
              debouncedSearch || source !== 'all' || age !== 'all'
                ? 'Nenhum lead encontrado pros filtros atuais.'
                : 'Nenhum lead ativo. Inbound do WhatsApp ou criação manual gera leads.'
            }
          />
        ) : (
          <div
            className={cn(
              'flex h-full gap-2',
              isFetching && 'opacity-70 transition-opacity',
            )}
          >
            {visibleColumns.map((substage) => {
              const col = data!.columns[substage]
              return (
                <LeadColumn
                  key={substage}
                  substage={substage}
                  items={col.items}
                  total={col.total}
                  onOpenLead={(l) => setDetailId(l.id)}
                  onOpenChat={handleOpenChat}
                />
              )
            })}
          </div>
        )}
      </div>

      <LeadDetailSheet
        open={detailId !== null}
        leadId={detailId}
        onOpenChange={(o) => {
          if (!o) setDetailId(null)
        }}
      />

      <ClientFormSheet
        open={createOpen}
        client={null}
        onOpenChange={setCreateOpen}
      />
    </PageContainer>
  )
}

function SubstageSummary({
  totals,
}: {
  totals: Record<LeadSubstage | 'unset', number>
}): React.ReactElement {
  const entries: Array<{ key: LeadSubstage; label: string; total: number }> =
    LEAD_SUBSTAGES.map((s) => ({
      key: s,
      label: LEAD_SUBSTAGE_LABELS_SHORT[s],
      total: totals[s] ?? 0,
    }))

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-2 text-xs text-muted-foreground">
      {entries.map((e) => (
        <span key={e.key} className={e.total === 0 ? 'opacity-50' : undefined}>
          {e.label}{' '}
          <span className="font-medium text-foreground">{e.total}</span>
        </span>
      ))}
      {totals.unset > 0 && (
        <span className="text-warning" title="Leads sem substage definido — usar 'Recalcular substage' no detalhe">
          Sem etapa{' '}
          <span className="font-medium">{totals.unset}</span>
        </span>
      )}
    </div>
  )
}

function BoardState({
  text,
  action,
}: {
  text: string
  action?: { label: string; onClick: () => void }
}): React.ReactElement {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
        <span>{text}</span>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="rounded-md border border-border px-3 py-1.5 hover:bg-accent/30"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  )
}
