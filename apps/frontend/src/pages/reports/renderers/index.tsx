import type { RunReportResponse } from '@/api/reports'
import { LeadsSummaryRenderer } from './LeadsSummaryRenderer'
import { SalesSummaryRenderer } from './SalesSummaryRenderer'

// Dispatch de renderer por slug. Quando relatório novo for entrar na UI,
// adicionar entry aqui apontando pro componente dedicado. Sem entry, o
// fallback renderiza JSON cru — útil em dev antes do renderer existir.

type RendererComponent = React.FC<{ result: RunReportResponse<unknown> }>

const renderers: Record<string, RendererComponent> = {
  'leads.summary': LeadsSummaryRenderer,
  'sales.summary': SalesSummaryRenderer,
}

export function ReportRendererBySlug({
  slug,
  result,
}: {
  slug: string
  result: RunReportResponse<unknown>
}): React.ReactElement {
  const Renderer = renderers[slug]
  if (!Renderer) {
    return (
      <div className="flex flex-col gap-2 rounded-md border bg-card p-4">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Sem renderer dedicado — exibindo JSON cru
        </span>
        <pre className="overflow-auto rounded bg-muted/50 p-2 text-xs">
          {JSON.stringify(result, null, 2)}
        </pre>
      </div>
    )
  }
  return <Renderer result={result} />
}
