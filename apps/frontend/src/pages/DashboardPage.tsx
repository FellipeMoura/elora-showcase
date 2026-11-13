import { PageContainer } from '@/components/layout/PageContainer'
import { ConversionFunnel } from './dashboard/ConversionFunnel'
import { DashboardHeader } from './dashboard/DashboardHeader'
import { DistributionGrid } from './dashboard/DistributionGrid'
import { EvolutionChart } from './dashboard/EvolutionChart'
import { KpiCardsRow } from './dashboard/KpiCardsRow'
import { OperationalLists } from './dashboard/OperationalLists'
import { useDashboardSummary } from './dashboard/useDashboardSummary'

// Home analítica (`/`). Monta o grid com filtro global de período e os blocos
// A (KPIs) → E (evolução) → B+D (funil + operacional) → C (distribuição).
// Cada bloco consome o mesmo summary via useDashboardSummary. Ver
// docs/dashboard-domain.md e docs/dashboard-implementation.md.
export function DashboardPage(): React.ReactElement {
  const { isError, error } = useDashboardSummary()

  return (
    <PageContainer>
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        <DashboardHeader />

        {isError ? (
          <div className="rounded-xl border border-destructive/40 bg-error-soft p-4 text-sm text-error-soft-foreground">
            Não foi possível carregar o dashboard: {error?.message ?? 'erro desconhecido'}
          </div>
        ) : null}

        {/* Bloco A — 6 KPI cards */}
        <KpiCardsRow />

        {/* Bloco E — evolução, full-width */}
        <EvolutionChart />

        {/* Bloco B + D lado a lado em lg, empilhados em md- */}
        <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <ConversionFunnel />
          </div>
          <OperationalLists />
        </div>

        {/* Bloco C — 5 charts de distribuição */}
        <DistributionGrid />
      </div>
    </PageContainer>
  )
}
