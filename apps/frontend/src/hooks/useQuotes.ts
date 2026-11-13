import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  closeSale,
  createQuote,
  createQuoteItem,
  deleteQuote,
  deleteQuoteItem,
  expireQuote,
  fetchQuoteById,
  fetchQuotes,
  rejectQuote,
  revertQuoteToDraft,
  sendQuote,
  updateQuote,
  updateQuoteItem,
  type CloseSaleInput,
  type CreateQuoteInput,
  type CreateQuoteItemInput,
  type FindQuotesQuery,
  type PaginatedQuotes,
  type QuoteWithItems,
  type UpdateQuoteInput,
  type UpdateQuoteItemInput,
} from '@/api/quotes'

export const QUOTES_QUERY_KEY = ['quotes'] as const

export function quotesListKey(query: FindQuotesQuery) {
  return [...QUOTES_QUERY_KEY, 'list', query] as const
}

export function quoteByIdKey(id: string) {
  return [...QUOTES_QUERY_KEY, 'detail', id] as const
}

export function useQuotes(query: FindQuotesQuery) {
  return useQuery<PaginatedQuotes, Error>({
    queryKey: quotesListKey(query),
    queryFn: () => fetchQuotes(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useQuote(id: string | undefined) {
  return useQuery<QuoteWithItems, Error>({
    queryKey: quoteByIdKey(id ?? ''),
    queryFn: () => fetchQuoteById(id as string),
    enabled: Boolean(id),
  })
}

export function useCreateQuote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateQuoteInput) => createQuote(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUOTES_QUERY_KEY })
    },
  })
}

export function useUpdateQuote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateQuoteInput }) =>
      updateQuote(id, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: QUOTES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: quoteByIdKey(vars.id) })
    },
  })
}

export function useDeleteQuote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteQuote(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUOTES_QUERY_KEY })
    },
  })
}

export function useCreateQuoteItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      quoteId,
      input,
    }: {
      quoteId: string
      input: CreateQuoteItemInput
    }) => createQuoteItem(quoteId, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: quoteByIdKey(vars.quoteId) })
      queryClient.invalidateQueries({ queryKey: QUOTES_QUERY_KEY })
    },
  })
}

export function useUpdateQuoteItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      quoteId,
      itemId,
      input,
    }: {
      quoteId: string
      itemId: string
      input: UpdateQuoteItemInput
    }) => updateQuoteItem(quoteId, itemId, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: quoteByIdKey(vars.quoteId) })
      queryClient.invalidateQueries({ queryKey: QUOTES_QUERY_KEY })
    },
  })
}

export function useDeleteQuoteItem() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ quoteId, itemId }: { quoteId: string; itemId: string }) =>
      deleteQuoteItem(quoteId, itemId),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: quoteByIdKey(vars.quoteId) })
      queryClient.invalidateQueries({ queryKey: QUOTES_QUERY_KEY })
    },
  })
}

export function useSendQuote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => sendQuote(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: QUOTES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: quoteByIdKey(id) })
      // Send pode mover a journey de stage — invalida journeys.
      queryClient.invalidateQueries({ queryKey: ['journeys'] })
    },
  })
}

export function useCloseSale() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CloseSaleInput }) =>
      closeSale(id, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: QUOTES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: quoteByIdKey(vars.id) })
      queryClient.invalidateQueries({ queryKey: ['journeys'] })
      queryClient.invalidateQueries({ queryKey: ['procedure-sessions'] })
      queryClient.invalidateQueries({ queryKey: ['sales'] })
    },
  })
}

export function useRevertQuoteToDraft() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => revertQuoteToDraft(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: QUOTES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: quoteByIdKey(id) })
      // Substage da journey pode mudar (sai de 'quoted' pra contact/scheduled).
      queryClient.invalidateQueries({ queryKey: ['journeys'] })
    },
  })
}

export function useRejectQuote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => rejectQuote(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: QUOTES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: quoteByIdKey(id) })
      queryClient.invalidateQueries({ queryKey: ['journeys'] })
    },
  })
}

export function useExpireQuote() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => expireQuote(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: QUOTES_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: quoteByIdKey(id) })
    },
  })
}
