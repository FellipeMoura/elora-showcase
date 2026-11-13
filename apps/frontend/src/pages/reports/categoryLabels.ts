// Categorias canônicas do produto. Sincronizado com o registry do backend
// (apps/core/src/modules/reports/registry.ts). Adicionar categoria nova
// exige update nos dois lugares (e provavelmente um item em
// REPORT_CATEGORY_ORDER abaixo).

export const REPORT_CATEGORIES = ['comercial', 'operacional', 'financeiro'] as const

export type ReportCategory = (typeof REPORT_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  comercial: 'Comercial',
  operacional: 'Operacional',
  financeiro: 'Financeiro',
}

// Ordem de exibição do ButtonGroup — espelha REPORT_CATEGORIES.
export const REPORT_CATEGORY_OPTIONS: ReadonlyArray<{
  value: ReportCategory
  label: string
}> = REPORT_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))

export function categoryLabel(category: string): string {
  if (isReportCategory(category)) return CATEGORY_LABELS[category]
  // Fallback defensivo pra categories órfãs (vindo do banco antes de sync).
  return category.charAt(0).toUpperCase() + category.slice(1)
}

export function isReportCategory(value: string): value is ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(value)
}
