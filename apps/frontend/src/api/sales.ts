import { coreApi } from '@/api/client'

// Espelha schemas do backend (apps/core/src/modules/sales/SalesTypes.ts).
// Valores monetários chegam como string (Drizzle decimal): '1234.56'.

export const SALE_STATUSES = ['open', 'paid', 'cancelled'] as const
export type SaleStatus = (typeof SALE_STATUSES)[number]

export const PAYMENT_STATUSES = ['pending', 'paid', 'cancelled'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PAYMENT_METHODS = [
  'pix',
  'credit_card',
  'debit_card',
  'cash',
  'bank_transfer',
  'other',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export interface Sale {
  id: string
  tenantId: string
  quoteId: string
  journeyId: string
  clientId: string
  subtotalAmount: string
  discountAmount: string
  totalAmount: string
  paidAmount: string
  status: SaleStatus
  closedAt: string
  closedByUserId: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface SaleItem {
  id: string
  tenantId: string
  saleId: string
  quoteItemId: string | null
  procedureId: string
  quantitySessions: number
  unitPrice: string
  discountPct: string
  computedAmount: string
  notes: string | null
  createdAt: string
}

export interface Payment {
  id: string
  tenantId: string
  saleId: string
  installmentNumber: number
  totalInstallments: number
  amount: string
  paymentMethod: PaymentMethod
  dueDate: string
  paidAt: string | null
  status: PaymentStatus
  notes: string | null
  createdAt: string
  updatedAt: string
}

export interface SaleListItem extends Sale {
  clientName: string
  clientPhoneE164: string
  pendingInstallments: number
  overdueInstallments: number
}

export interface SaleWithDetails {
  sale: Sale
  items: SaleItem[]
  payments: Payment[]
}

export type SaleSortField =
  | 'createdAt'
  | 'closedAt'
  | 'totalAmount'
  | 'paidAmount'

export interface FindSalesQuery {
  page?: number
  pageSize?: number
  clientId?: string
  journeyId?: string
  status?: SaleStatus
  closedFrom?: string
  closedTo?: string
  q?: string
  sortBy?: SaleSortField
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedSales {
  items: SaleListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// ----------------------------------------------------------------------
// Close sale (input do POST /quotes/:id/close-sale)
// ----------------------------------------------------------------------

export interface PaymentInput {
  amount: number
  paymentMethod: PaymentMethod
  dueDate: string // YYYY-MM-DD
  paidAt?: string | null
  notes?: string | null
}

export interface CloseSaleInput {
  selectedItemIds: string[]
  discountAmount?: number
  payments: PaymentInput[]
  notes?: string | null
}

export interface CloseSaleResponse {
  quote: {
    id: string
    status: string
    totalAmount: string
    [key: string]: unknown
  }
  sale: Sale
  items: SaleItem[]
  payments: Payment[]
  procedureSessionIds: string[]
}

// ----------------------------------------------------------------------
// Operações em parcela
// ----------------------------------------------------------------------

export interface MarkPaymentPaidInput {
  paidAt?: string
  notes?: string | null
}

export interface UpdatePaymentInput {
  amount?: number
  paymentMethod?: PaymentMethod
  dueDate?: string
  notes?: string | null
}

export interface PaymentMutationResponse {
  payment: Payment
  sale: Sale
}

// ----------------------------------------------------------------------
// API
// ----------------------------------------------------------------------

export async function fetchSales(
  query: FindSalesQuery = {},
): Promise<PaginatedSales> {
  const res = await coreApi.get<PaginatedSales>('/sales', { params: query })
  return res.data
}

export async function fetchSaleById(id: string): Promise<SaleWithDetails> {
  const res = await coreApi.get<SaleWithDetails>(`/sales/${id}`)
  return res.data
}

export async function markPaymentPaid(
  saleId: string,
  paymentId: string,
  input: MarkPaymentPaidInput = {},
): Promise<PaymentMutationResponse> {
  const res = await coreApi.post<PaymentMutationResponse>(
    `/sales/${saleId}/payments/${paymentId}/mark-paid`,
    input,
  )
  return res.data
}

export async function updatePayment(
  saleId: string,
  paymentId: string,
  input: UpdatePaymentInput,
): Promise<PaymentMutationResponse> {
  const res = await coreApi.patch<PaymentMutationResponse>(
    `/sales/${saleId}/payments/${paymentId}`,
    input,
  )
  return res.data
}
