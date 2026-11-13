// Tradução PT-BR dos códigos enum que o backend devolve no bloco C (origens,
// motivos de perda, métodos de pagamento, substages). Backend mantém os
// identificadores em inglês (CLAUDE.md regra 1); a tradução é só de exibição.
// Fallback prettifica o código desconhecido (lost_reason é varchar livre).

function prettifyCode(code: string): string {
  const spaced = code.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const SOURCE_LABELS: Record<string, string> = {
  whatsapp: 'WhatsApp',
  form: 'Formulário',
  sheets: 'Planilha',
  manual: 'Manual',
  recycling: 'Reciclagem',
  imported: 'Importado',
  other: 'Outro',
}

const LOST_REASON_LABELS: Record<string, string> = {
  no_show: 'No-show',
  price: 'Preço',
  disqualified: 'Desqualificado',
  timeout: 'Sem resposta',
  other: 'Outro',
  unknown: 'Não informado',
}

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  cash: 'Dinheiro',
  bank_transfer: 'Transferência',
  other: 'Outro',
}

const LEAD_SUBSTAGE_LABELS: Record<string, string> = {
  new: 'Novo',
  template: 'Mensagem enviada',
  contact: 'Em contato',
  scheduled: 'Agendado',
  no_show: 'No-show',
  rescheduled: 'Reagendado',
  quoted: 'Orçado',
}

export function sourceLabel(code: string): string {
  return SOURCE_LABELS[code] ?? prettifyCode(code)
}

export function lostReasonLabel(code: string): string {
  return LOST_REASON_LABELS[code] ?? prettifyCode(code)
}

export function paymentMethodLabel(code: string): string {
  return PAYMENT_METHOD_LABELS[code] ?? prettifyCode(code)
}

export function leadSubstageLabel(code: string): string {
  return LEAD_SUBSTAGE_LABELS[code] ?? prettifyCode(code)
}

// Token de cor por substage de lead — reusa a paleta de identidade do kanban
// (index.css). Usado no stacked bar C5.
export const LEAD_SUBSTAGE_COLORS: Record<string, string> = {
  new: 'var(--lead-new)',
  template: 'var(--lead-template)',
  contact: 'var(--lead-contact)',
  scheduled: 'var(--lead-scheduled)',
  no_show: 'var(--lead-no-show)',
  rescheduled: 'var(--lead-rescheduled)',
  quoted: 'var(--lead-quoted)',
}

// Paleta categórica genérica pros charts sem token semântico próprio (C2
// origens, C4 métodos de pagamento). Ciclada por índice.
export const CATEGORICAL_PALETTE = [
  'var(--primary)',
  'var(--info)',
  'var(--success)',
  'var(--warning)',
  'var(--journey-evaluation)',
  'var(--journey-sale)',
  'var(--tertiary)',
  'var(--destructive)',
]
