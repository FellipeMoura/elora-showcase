import type {
  PaymentMethod,
  QuoteOrigin,
  QuoteStatus,
} from '@/api/quotes'

export const STATUS_LABELS: Record<QuoteStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviado',
  accepted: 'Aceito',
  rejected: 'Recusado',
  expired: 'Expirado',
}

// Badge styling pareado por categoria semântica (ver design system §badge).
// Categorias com cor vívida (info/success/warning/error) → bg/15 + text-X.
export const STATUS_BADGE_CLASS: Record<QuoteStatus, string> = {
  draft: 'bg-muted text-muted-foreground',
  sent: 'bg-info/15 text-info',
  accepted: 'bg-success/15 text-success',
  rejected: 'bg-error/15 text-error',
  expired: 'bg-warning/15 text-warning',
}

export const ORIGIN_LABELS: Record<QuoteOrigin, string> = {
  evaluation: 'Avaliação',
  referral: 'Indicação interna',
  direct_sale: 'Venda direta',
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  cash: 'Dinheiro',
  bank_transfer: 'Transferência',
  other: 'Outro',
}
