import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useVisibleReports } from '@/hooks/useReports'
import type { Report } from '@/api/reports'
import { cn } from '@/lib/utils'
import {
  REPORT_CATEGORY_OPTIONS,
  type ReportCategory,
} from './categoryLabels'

const DEFAULT_CATEGORY: ReportCategory = 'comercial'

export function ReportsPage(): React.ReactElement {
  const navigate = useNavigate()
  const { data, isLoading, isError, refetch } = useVisibleReports()
  const reports = useMemo(() => data ?? [], [data])

  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim().toLowerCase(), 200)
  const [category, setCategory] = useState<ReportCategory>(DEFAULT_CATEGORY)

  const openRun = (report: Report): void => {
    navigate(`/reports/${report.slug}`)
  }

  // Filtra pela categoria selecionada e (opcionalmente) por busca textual.
  // Não há agrupamento — uma categoria por vez, lista flat.
  const filtered = useMemo(() => {
    return reports.filter((r) => {
      if (r.category !== category) return false
      if (debouncedSearch) {
        const haystack = `${r.name} ${r.description ?? ''}`.toLowerCase()
        if (!haystack.includes(debouncedSearch)) return false
      }
      return true
    })
  }, [reports, category, debouncedSearch])

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Search
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Buscar relatório"
        />
      </PageToolbar>

      {/* ButtonGroup full-width abaixo da toolbar. `[&>button]:flex-1` força
          distribuição igual dos botões internos (default é `inline-flex` com
          largura por conteúdo). */}
      <ButtonGroup<ReportCategory>
        value={category}
        onChange={setCategory}
        options={REPORT_CATEGORY_OPTIONS}
        aria-label="Filtrar por categoria"
        className="flex w-full shrink-0 [&>button]:flex-1"
      />

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {isLoading && <LoadingState />}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {!isLoading && !isError && filtered.length === 0 && (
          <EmptyState hasSearch={Boolean(debouncedSearch)} />
        )}

        {!isLoading &&
          !isError &&
          filtered.map((r) => (
            <ReportCard key={r.id} report={r} onClick={() => openRun(r)} />
          ))}
      </div>
    </PageContainer>
  )
}

interface ReportCardProps {
  report: Report
  onClick: () => void
}

// Card inteiro clicável (sem botão "Executar"). Usa <button> nativo pra
// ter Enter/Space + foco visível sem reimplementar a11y manual.
function ReportCard({ report, onClick }: ReportCardProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full flex-col gap-1 rounded-md border bg-card p-4 text-left',
        'transition-colors hover:border-primary/60 hover:bg-accent/30',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
      )}
    >
      <span className="font-medium">{report.name}</span>
      {report.description && (
        <p className="text-sm text-muted-foreground">{report.description}</p>
      )}
    </button>
  )
}

function LoadingState(): React.ReactElement {
  return (
    <div className="flex items-center justify-center gap-2 rounded-md border bg-card p-8 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      Carregando relatórios…
    </div>
  )
}

function ErrorState({ onRetry }: { onRetry: () => void }): React.ReactElement {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-error/40 bg-error-soft p-8 text-sm text-error-soft-foreground">
      <div className="flex items-center gap-2">
        <AlertCircle className="size-4" />
        Erro ao carregar relatórios.
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  )
}

function EmptyState({
  hasSearch,
}: {
  hasSearch: boolean
}): React.ReactElement {
  return (
    <div className="rounded-md border bg-card p-8 text-center text-sm text-muted-foreground">
      {hasSearch
        ? 'Nenhum relatório encontrado pros filtros atuais.'
        : 'Nenhum relatório disponível nesta categoria.'}
    </div>
  )
}
