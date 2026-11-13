import { coreApi } from '@/api/client'
import type { CloseSaleInput, CloseSaleResponse } from './sales'

// Espelha quoteResponseSchema do backend
// (apps/core/src/modules/quotes/QuotesTypes.ts). Valores monetários chegam
// como string (Drizzle decimal) — formato '1234.56'.

export const QUOTE_ORIGINS = ['evaluation', 'referral', 'direct_sale'] as const
export type QuoteOrigin = (typeof QUOTE_ORIGINS)[number]

export const QUOTE_STATUSES = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
] as const
export type QuoteStatus = (typeof QUOTE_STATUSES)[number]

export const PAYMENT_METHODS = [
  'pix',
  'credit_card',
  'debit_card',
  'cash',
  'bank_transfer',
  'other',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export interface Quote {
  id: string
  tenantId: string
  journeyId: string
  origin: QuoteOrigin
  totalAmount: string
  discountAmount: string
  status: QuoteStatus
  validUntil: string | null
  notes: string | null
  createdByUserId: string | null
  sentAt: string | null
  acceptedAt: string | null
  rejectedAt: string | null
  createdAt: string
  updatedAt: string
}

// Quote enriquecido com dados do cliente — formato retornado por
// `GET /quotes` (listagem). O detalhe (`GET /quotes/:id`) usa `Quote` puro.
// sale* preenchido quando o quote foi fechado em venda (relação 1:1 via
// sales.quote_id); null caso contrário.
export interface QuoteListItem extends Quote {
  clientId: string
  clientName: string
  clientPhoneE164: string
  saleId: string | null
  saleTotalAmount: string | null
  saleClosedAt: string | null
}

export interface QuoteItem {
  id: string
  tenantId: string
  quoteId: string
  procedureId: string
  quantitySessions: number
  unitPrice: string
  discountPct: string
  notes: string | null
  createdAt: string
}

export interface QuoteWithItems {
  quote: Quote
  items: QuoteItem[]
}

export type QuoteSortField =
  | 'createdAt'
  | 'updatedAt'
  | 'sentAt'
  | 'acceptedAt'
  | 'totalAmount'

export interface FindQuotesQuery {
  page?: number
  pageSize?: number
  journeyId?: string
  // Histórico de orçamentos/vendas do cliente — agrega todas as journeys.
  clientId?: string
  status?: QuoteStatus
  origin?: QuoteOrigin
  // Busca textual em nome/telefone do cliente associado à quote.
  q?: string
  sortBy?: QuoteSortField
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedQuotes {
  items: QuoteListItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface CreateQuoteInput {
  journeyId: string
  origin: QuoteOrigin
  discountAmount?: number
  validUntil?: string | null
  notes?: string | null
}

export interface UpdateQuoteInput {
  discountAmount?: number
  validUntil?: string | null
  notes?: string | null
}

export interface CreateQuoteItemInput {
  procedureId: string
  quantitySessions: number
  unitPrice: number
  discountPct?: number
  notes?: string | null
}

export interface UpdateQuoteItemInput {
  quantitySessions?: number
  unitPrice?: number
  discountPct?: number
  notes?: string | null
}

// Input do POST /quotes/:id/close-sale — define em api/sales.ts. Re-export
// aqui pra manter compat dos imports antigos (hooks/useQuotes).
export type { CloseSaleInput, CloseSaleResponse } from './sales'

export interface QuoteItemMutationResponse {
  item: QuoteItem
  quote: Quote
}

export interface QuoteItemRemovalResponse {
  quote: Quote
}


// ----------------------------------------------------------------------
// Quotes
// ----------------------------------------------------------------------

export async function fetchQuotes(
  query: FindQuotesQuery = {},
): Promise<PaginatedQuotes> {
  const res = await coreApi.get<PaginatedQuotes>('/quotes', { params: query })
  return res.data
}

export async function fetchQuoteById(id: string): Promise<QuoteWithItems> {
  const res = await coreApi.get<QuoteWithItems>(`/quotes/${id}`)
  return res.data
}

export async function createQuote(input: CreateQuoteInput): Promise<Quote> {
  const res = await coreApi.post<Quote>('/quotes', input)
  return res.data
}

export async function updateQuote(
  id: string,
  input: UpdateQuoteInput,
): Promise<Quote> {
  const res = await coreApi.patch<Quote>(`/quotes/${id}`, input)
  return res.data
}

export async function deleteQuote(id: string): Promise<void> {
  await coreApi.delete(`/quotes/${id}`)
}

// ----------------------------------------------------------------------
// Items
// ----------------------------------------------------------------------

export async function createQuoteItem(
  quoteId: string,
  input: CreateQuoteItemInput,
): Promise<QuoteItemMutationResponse> {
  const res = await coreApi.post<QuoteItemMutationResponse>(
    `/quotes/${quoteId}/items`,
    input,
  )
  return res.data
}

export async function updateQuoteItem(
  quoteId: string,
  itemId: string,
  input: UpdateQuoteItemInput,
): Promise<QuoteItemMutationResponse> {
  const res = await coreApi.patch<QuoteItemMutationResponse>(
    `/quotes/${quoteId}/items/${itemId}`,
    input,
  )
  return res.data
}

export async function deleteQuoteItem(
  quoteId: string,
  itemId: string,
): Promise<QuoteItemRemovalResponse> {
  const res = await coreApi.delete<QuoteItemRemovalResponse>(
    `/quotes/${quoteId}/items/${itemId}`,
  )
  return res.data
}

// ----------------------------------------------------------------------
// Transições de status
// ----------------------------------------------------------------------

export async function sendQuote(id: string): Promise<Quote> {
  const res = await coreApi.post<Quote>(`/quotes/${id}/send`)
  return res.data
}

export async function closeSale(
  id: string,
  input: CloseSaleInput,
): Promise<CloseSaleResponse> {
  const res = await coreApi.post<CloseSaleResponse>(
    `/quotes/${id}/close-sale`,
    input,
  )
  return res.data
}

export async function revertQuoteToDraft(id: string): Promise<Quote> {
  const res = await coreApi.post<Quote>(`/quotes/${id}/revert-to-draft`)
  return res.data
}

export async function rejectQuote(id: string): Promise<Quote> {
  const res = await coreApi.post<Quote>(`/quotes/${id}/reject`)
  return res.data
}

export async function expireQuote(id: string): Promise<Quote> {
  const res = await coreApi.post<Quote>(`/quotes/${id}/expire`)
  return res.data
}
