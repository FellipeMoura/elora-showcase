import { coreApi } from '@/api/client'
import type { PaymentMethod } from '@/api/sales'

// Espelha schemas de apps/core/src/modules/cashier/CashierTypes.ts. Caixa =
// view operacional dos payments com status=paid.

export interface CashierEntry {
  paymentId: string
  saleId: string
  clientId: string
  clientName: string
  clientPhoneE164: string
  paidAt: string
  amount: string
  paymentMethod: PaymentMethod
  installmentNumber: number
  totalInstallments: number
}

export interface FindCashierEntriesQuery {
  page?: number
  pageSize?: number
  from?: string
  to?: string
  paymentMethod?: PaymentMethod
  clientId?: string
  q?: string
}

export interface PaginatedCashierEntries {
  items: CashierEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface CashierSummaryItem {
  paymentMethod: PaymentMethod
  count: number
  total: string
}

export interface CashierSummary {
  from: string
  to: string
  totalAmount: string
  totalCount: number
  byMethod: CashierSummaryItem[]
}

export interface CashierSummaryQuery {
  from?: string
  to?: string
}

export async function fetchCashierEntries(
  query: FindCashierEntriesQuery = {},
): Promise<PaginatedCashierEntries> {
  const res = await coreApi.get<PaginatedCashierEntries>('/cashier/entries', {
    params: query,
  })
  return res.data
}

export async function fetchCashierSummary(
  query: CashierSummaryQuery = {},
): Promise<CashierSummary> {
  const res = await coreApi.get<CashierSummary>('/cashier/summary', {
    params: query,
  })
  return res.data
}
