import { useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertCircle, ArrowLeft, Loader2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { PeriodFilter } from '@/components/data/PeriodFilter'
import { useReportDetail, useRunReport } from '@/hooks/useReports'
import { usePeriodFilter } from '@/hooks/usePeriodFilter'
import { PrintableReport } from './components/PrintableReport'
import { ReportFormBySlug, REPORT_RUN_FORM_ID } from './forms'
import { ReportRendererBySlug } from './renderers'
import { apiErrorText } from '@/lib/apiError'

// Slugs cujo paramsSchema bate com `{ period, from?, to? }` — usam o
// componente compartilhado <PeriodFilter> direto na toolbar (sem form
// inline). Pra novos relatórios com filtro de período, adicionar o slug
// aqui — o resto da página detecta automaticamente.
const SLUGS_WITH_PERIOD_FILTER = new Set<string>([
  'leads.summary',
  'sales.summary',
])

function usesPeriodFilter(slug: string | undefined): boolean {
  return slug ? SLUGS_WITH_PERIOD_FILTER.has(slug) : false
}

// Página dedicada de execução de relatório. Layout full-width pra acomodar
// tabelas largas; URL com search params é fonte da verdade dos filtros —
// bookmark/share funciona. Auto-executa ao montar e a cada mudança de
// params. Botão "Exportar PDF" chama window.print() — CSS @media print
// em index.css esconde shell e revela só o PrintableReport.
export function ReportRunPage(): React.ReactElement {
  const { slug } = useParams<{ slug: string }>()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const detailQuery = useReportDetail(slug)
  const hasPeriodFilter = usesPeriodFilter(slug)

  // Hook do PeriodFilter (URL como source). Só matters quando hasPeriodFilter,
  // mas chamamos incondicionalmente pra obedecer regra dos hooks.
  const { period, from, to, setPeriod } = usePeriodFilter()

  // Params a enviar pro backend. Pra relatórios com PeriodFilter, envia
  // `{period, from, to}` direto (backend resolve via shared/period/).
  // Caso contrário, envia todos os search params crus — cada handler
  // valida seu próprio paramsSchema.
  const backendParams = useMemo<Record<string, unknown>>(() => {
    if (hasPeriodFilter) {
      const params: Record<string, unknown> = { period }
      if (period === 'custom' && from) params.from = from
      if (period === 'custom' && to) params.to = to
      return params
    }
    const obj: Record<string, string> = {}
    searchParams.forEach((value, key) => {
      obj[key] = value
    })
    return obj
  }, [hasPeriodFilter, period, from, to, searchParams])

  const backendParamsKey = useMemo(
    () => JSON.stringify(backendParams),
    [backendParams],
  )

  const runMutation = useRunReport()

  // Auto-executa ao montar e quando filtros mudam.
  useEffect(() => {
    if (!slug || !detailQuery.data) return
    runMutation.reset()
    runMutation.mutate(
      { slug, params: backendParams },
      {
        onError: (err) => {
          const message =
            apiErrorText(err) ?? 'Erro ao executar relatório.'
          toast.error(message)
        },
      },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, detailQuery.data?.id, backendParamsKey])

  // Pra relatórios SEM PeriodFilter, o form inline atualiza URL via este
  // callback (pattern original). Pra os COM PeriodFilter, setPeriod do
  // hook já atualiza URL — o submit do form inline nem é montado.
  const applyFilters = (newParams: Record<string, unknown>): void => {
    const sp = new URLSearchParams()
    for (const [k, v] of Object.entries(newParams)) {
      if (v === null || v === undefined || v === '') continue
      sp.set(k, String(v))
    }
    setSearchParams(sp, { replace: false })
  }

  const handlePrint = (): void => {
    window.print()
  }

  // Loading do detail
  if (detailQuery.isLoading) {
    return (
      <PageContainer>
        <PageToolbar>
          <PageToolbar.Action
            icon={<ArrowLeft />}
            onClick={() => navigate('/reports')}
            variant="ghost"
            placement="leading"
            aria-label="Voltar"
          />
        </PageToolbar>
        <div className="flex flex-1 items-center justify-center gap-2 rounded-md border bg-card p-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Carregando relatório…
        </div>
      </PageContainer>
    )
  }

  if (detailQuery.isError || !detailQuery.data || !slug) {
    return (
      <PageContainer>
        <PageToolbar>
          <PageToolbar.Action
            icon={<ArrowLeft />}
            onClick={() => navigate('/reports')}
            variant="ghost"
            placement="leading"
            aria-label="Voltar"
          />
        </PageToolbar>
        <div className="flex flex-col items-center gap-3 rounded-md border border-error/40 bg-error-soft p-8 text-sm text-error-soft-foreground">
          <div className="flex items-center gap-2">
            <AlertCircle className="size-4" />
            Relatório não encontrado ou indisponível.
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/reports')}>
            Voltar pra lista
          </Button>
        </div>
      </PageContainer>
    )
  }

  const report = detailQuery.data
  const periodInfo = extractPeriod(runMutation.data?.data)
  const generatedAt =
    runMutation.data?.meta.generatedAt ?? new Date().toISOString()

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Action
          icon={<ArrowLeft />}
          onClick={() => navigate('/reports')}
          variant="ghost"
          placement="leading"
          aria-label="Voltar"
        />

        {hasPeriodFilter && (
          <PageToolbar.Filter label="Período" minWidth={260}>
            <PeriodFilter
              period={period}
              from={from}
              to={to}
              onChange={setPeriod}
              selectWidthClassName="w-full"
            />
          </PageToolbar.Filter>
        )}

        <PageToolbar.Action
          icon={<Printer />}
          label="Exportar PDF"
          variant="outline"
          onClick={handlePrint}
          disabled={!runMutation.data}
        />
      </PageToolbar>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
        {/* Bloco de filtros inline — só pra relatórios SEM PeriodFilter */}
        {!hasPeriodFilter && (
          <div className="flex flex-col gap-3 rounded-md border bg-card p-3 print:hidden sm:flex-row sm:items-end">
            <div className="flex-1">
              <ReportFormBySlug
                slug={slug}
                onSubmit={applyFilters}
                isPending={runMutation.isPending}
                initialValues={Object.fromEntries(searchParams)}
              />
            </div>
            <Button
              type="submit"
              form={REPORT_RUN_FORM_ID}
              disabled={runMutation.isPending}
              className="sm:w-32"
            >
              {runMutation.isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Aplicando…
                </>
              ) : (
                'Aplicar'
              )}
            </Button>
          </div>
        )}

        {/* Conteúdo do relatório */}
        <PrintableReport
          reportName={report.name}
          period={periodInfo}
          generatedAt={generatedAt}
        >
          {runMutation.isPending && (
            <div className="flex items-center gap-2 rounded-md border bg-card p-4 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Gerando relatório…
            </div>
          )}

          {runMutation.isError && !runMutation.isPending && (
            <div className="flex items-center gap-2 rounded-md border border-error/40 bg-error-soft p-4 text-sm text-error-soft-foreground">
              <AlertCircle className="size-4 shrink-0" />
              <span>
                {apiErrorText(runMutation.error) ??
                  'Erro ao executar relatório.'}
              </span>
            </div>
          )}

          {runMutation.data && !runMutation.isPending && (
            <ReportRendererBySlug slug={slug} result={runMutation.data} />
          )}
        </PrintableReport>
      </div>
    </PageContainer>
  )
}

// Extrai period { from, to } do data do relatório quando presente.
function extractPeriod(
  data: unknown,
): { from: string; to: string } | null {
  if (!data || typeof data !== 'object') return null
  const period = (data as { period?: unknown }).period
  if (!period || typeof period !== 'object') return null
  const { from, to } = period as { from?: unknown; to?: unknown }
  if (typeof from === 'string' && typeof to === 'string') return { from, to }
  return null
}
