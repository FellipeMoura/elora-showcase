import type { AppointmentKind, AppointmentStatus } from '@/api/appointments'

// =====================================================================
// Cores fixas pra status + cor única pra avaliação. Hexa porque cards
// usam style inline (cor de procedure vem do DB, Tailwind dinâmico não
// funciona). Mantém alinhado visualmente com tokens semânticos do tema:
//   scheduled  → info     (azul)
//   confirmed  → primary  (índigo)
//   attended   → success  (verde)
//   no_show    → warning  (laranja)
//   cancelled  → error    (vermelho)
//
// Evaluation: teal, distintivo o suficiente das demais.
// Procedure fallback: cinza neutro quando procedure.color é null.
// =====================================================================

export const STATUS_HEX: Record<AppointmentStatus, string> = {
  scheduled: '#3b82f6',
  confirmed: '#6366f1',
  attended: '#10b981',
  no_show: '#f59e0b',
  cancelled: '#ef4444',
}

export const EVALUATION_HEX = '#14b8a6'
export const PROCEDURE_FALLBACK_HEX = '#6b7280'

// Mix do hex com branco — `ratio` em [0..1] = peso do branco.
// ratio=0.9 produz tint quase branco (bom pra bg de evaluation card).
export function lighten(hex: string, ratio = 0.9): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const mr = Math.round(r + (255 - r) * ratio)
  const mg = Math.round(g + (255 - g) * ratio)
  const mb = Math.round(b + (255 - b) * ratio)
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(mr)}${toHex(mg)}${toHex(mb)}`
}

// Escurece — útil pra borda mais sólida sobre o fill.
export function darken(hex: string, ratio = 0.2): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const mr = Math.round(r * (1 - ratio))
  const mg = Math.round(g * (1 - ratio))
  const mb = Math.round(b * (1 - ratio))
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(mr)}${toHex(mg)}${toHex(mb)}`
}

export type CalendarColorMode = 'status' | 'procedure'

export interface CardColors {
  // Borda/fundo conforme `style`. Style decidido pelo kind (eval=light,
  // procedure=dark) — fixo independente do mode. Só a cor varia com mode.
  style: 'light' | 'dark'
  primary: string
  // Cor do "outro" indicador (badge/dot no canto do card).
  iconColor: string
}

interface GetCardColorsInput {
  kind: AppointmentKind
  status: AppointmentStatus
  procedureColor: string | null | undefined
  mode: CalendarColorMode
}

export function getCardColors(input: GetCardColorsInput): CardColors {
  const statusColor = STATUS_HEX[input.status]
  const kindColor =
    input.kind === 'evaluation'
      ? EVALUATION_HEX
      : (input.procedureColor ?? PROCEDURE_FALLBACK_HEX)

  const style: CardColors['style'] = input.kind === 'evaluation' ? 'light' : 'dark'

  if (input.mode === 'status') {
    return { style, primary: statusColor, iconColor: kindColor }
  }
  return { style, primary: kindColor, iconColor: statusColor }
}
