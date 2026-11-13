// Helpers compartilhados do LeadsSummaryRenderer: comparativos, formatação,
// labels. Mantidos fora do .tsx pra ficar fácil de testar e re-usar em
// renderers futuros que sigam a mesma lógica.

export type DeltaDirection = 'above' | 'within' | 'below'
export type DeltaStatus = 'success' | 'primary' | 'error'

// Direção do delta: above/within/below baseado em threshold (faixa "na média").
export function compareDelta(
  value: number,
  avg: number,
  threshold: number,
): DeltaDirection {
  const diff = value - avg
  if (Math.abs(diff) < threshold) return 'within'
  return diff > 0 ? 'above' : 'below'
}

// Mapeia direção → status semântico. `inverted=true` pra métricas onde
// menor é melhor (ex: tempo de resposta).
export function deltaToStatus(
  delta: DeltaDirection,
  inverted = false,
): DeltaStatus {
  if (delta === 'within') return 'primary'
  if (inverted) return delta === 'above' ? 'error' : 'success'
  return delta === 'above' ? 'success' : 'error'
}

// Threshold proporcional pra tempo de resposta: ±20% da média.
// Métricas absolutas (Total, Convertidos %, etc) usam threshold fixo.
export function responseTimeThreshold(avgMin: number): number {
  return avgMin * 0.2
}

// ---- Formatadores ----

const intFmt = new Intl.NumberFormat('pt-BR')
const pctFmt = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  maximumFractionDigits: 1,
})
const moneyFmt = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return intFmt.format(n)
}

export function formatPct(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return pctFmt.format(n)
}

export function formatMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return moneyFmt.format(n)
}

// Tempo em minutos. < 60 → "45 min"; >= 60 → "1h 15min".
export function formatMinutes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  if (n < 60) return `${Math.round(n)} min`
  const h = Math.floor(n / 60)
  const m = Math.round(n - h * 60)
  return m === 0 ? `${h}h` : `${h}h ${m}min`
}

// Data YYYY-MM-DD → DD/MM
export function formatDayShort(yyyymmdd: string): string {
  const [, m, d] = yyyymmdd.split('-')
  if (!m || !d) return yyyymmdd
  return `${d}/${m}`
}

// ---- Labels ----

export const SOURCE_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  form: 'Formulário',
  sheets: 'Planilha',
  manual: 'Manual',
  recycling: 'Reciclagem',
  imported: 'Importado',
  other: 'Outros',
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source
}

export const LOST_REASON_LABELS: Record<string, string> = {
  price: 'Preço',
  no_show: 'No-show',
  disqualified: 'Desqualificado',
  timeout: 'Timeout',
  other: 'Outros',
}

export function lostReasonLabel(reason: string | null): string {
  if (reason === null) return 'Sem motivo registrado'
  return LOST_REASON_LABELS[reason] ?? reason
}
