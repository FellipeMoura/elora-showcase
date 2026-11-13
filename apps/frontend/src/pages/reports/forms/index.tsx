import { REPORT_RUN_FORM_ID } from './formId'

// Dispatch de form inline por slug. Usado apenas pra relatórios que NÃO
// têm filtro padronizado na toolbar (ex: PeriodFilter). Relatórios com
// `period` filtram via toolbar — ReportRunPage detecta via lookup e
// pula o form inline. Ver SLUGS_WITH_PERIOD_FILTER em ReportRunPage.tsx.
//
// Quando relatório novo SEM filtro padrão entrar, adicionar entry aqui
// apontando pro form dedicado.

interface FormProps {
  onSubmit: (params: Record<string, unknown>) => void
  isPending: boolean
  initialValues?: Record<string, unknown>
}

const forms: Record<string, React.FC<FormProps>> = {}

export function ReportFormBySlug({
  slug,
  onSubmit,
  isPending,
  initialValues,
}: {
  slug: string
} & FormProps): React.ReactElement {
  const FormComponent = forms[slug]
  if (!FormComponent) {
    return (
      <form
        id={REPORT_RUN_FORM_ID}
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit({})
        }}
        className="flex flex-col gap-2 rounded-md border bg-card p-4"
      >
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          Sem parâmetros
        </span>
        <span className="text-sm">
          Este relatório não exige filtros. Aperte "Aplicar".
        </span>
      </form>
    )
  }
  return (
    <FormComponent
      onSubmit={onSubmit}
      isPending={isPending}
      initialValues={initialValues}
    />
  )
}

export { REPORT_RUN_FORM_ID }
