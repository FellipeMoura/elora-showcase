import type {
  PaymentMethod,
  PaymentStatus,
  SaleStatus,
} from '@/api/sales'

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  open: 'Em aberto',
  paid: 'Quitada',
  cancelled: 'Cancelada',
}

export const SALE_STATUS_BADGE_CLASS: Record<SaleStatus, string> = {
  open: 'bg-info/15 text-info',
  paid: 'bg-success/15 text-success',
  cancelled: 'bg-muted text-muted-foreground',
}

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: 'Pendente',
  paid: 'Recebida',
  cancelled: 'Cancelada',
}

export const PAYMENT_STATUS_BADGE_CLASS: Record<PaymentStatus, string> = {
  pending: 'bg-warning/15 text-warning',
  paid: 'bg-success/15 text-success',
  cancelled: 'bg-muted text-muted-foreground',
}

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  pix: 'PIX',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  cash: 'Dinheiro',
  bank_transfer: 'Transferência',
  other: 'Outro',
}
