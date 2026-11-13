import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  fetchSaleById,
  fetchSales,
  markPaymentPaid,
  updatePayment,
  type FindSalesQuery,
  type MarkPaymentPaidInput,
  type PaginatedSales,
  type SaleWithDetails,
  type UpdatePaymentInput,
} from '@/api/sales'

export const SALES_QUERY_KEY = ['sales'] as const

export function salesListKey(query: FindSalesQuery) {
  return [...SALES_QUERY_KEY, 'list', query] as const
}

export function saleByIdKey(id: string) {
  return [...SALES_QUERY_KEY, 'detail', id] as const
}

export function useSales(query: FindSalesQuery) {
  return useQuery<PaginatedSales, Error>({
    queryKey: salesListKey(query),
    queryFn: () => fetchSales(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useSale(id: string | undefined) {
  return useQuery<SaleWithDetails, Error>({
    queryKey: saleByIdKey(id ?? ''),
    queryFn: () => fetchSaleById(id as string),
    enabled: Boolean(id),
  })
}

export function useMarkPaymentPaid() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      saleId,
      paymentId,
      input,
    }: {
      saleId: string
      paymentId: string
      input?: MarkPaymentPaidInput
    }) => markPaymentPaid(saleId, paymentId, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: SALES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: saleByIdKey(vars.saleId) })
    },
  })
}

export function useUpdatePayment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      saleId,
      paymentId,
      input,
    }: {
      saleId: string
      paymentId: string
      input: UpdatePaymentInput
    }) => updatePayment(saleId, paymentId, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: SALES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: saleByIdKey(vars.saleId) })
    },
  })
}
