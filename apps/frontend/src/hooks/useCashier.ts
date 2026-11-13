import { useQuery } from '@tanstack/react-query'
import {
  fetchCashierEntries,
  fetchCashierSummary,
  type CashierSummary,
  type CashierSummaryQuery,
  type FindCashierEntriesQuery,
  type PaginatedCashierEntries,
} from '@/api/cashier'

export const CASHIER_QUERY_KEY = ['cashier'] as const

export function cashierEntriesKey(query: FindCashierEntriesQuery) {
  return [...CASHIER_QUERY_KEY, 'entries', query] as const
}

export function cashierSummaryKey(query: CashierSummaryQuery) {
  return [...CASHIER_QUERY_KEY, 'summary', query] as const
}

export function useCashierEntries(query: FindCashierEntriesQuery) {
  return useQuery<PaginatedCashierEntries, Error>({
    queryKey: cashierEntriesKey(query),
    queryFn: () => fetchCashierEntries(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useCashierSummary(query: CashierSummaryQuery) {
  return useQuery<CashierSummary, Error>({
    queryKey: cashierSummaryKey(query),
    queryFn: () => fetchCashierSummary(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}
