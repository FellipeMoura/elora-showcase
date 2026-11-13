import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  createJourney,
  fetchJourneyById,
  fetchJourneyEvents,
  fetchJourneys,
  markJourneyLost,
  markJourneyWon,
  type CreateJourneyInput,
  type FindJourneysQuery,
  type Journey,
  type MarkLostInput,
  type PaginatedJourneyEvents,
  type PaginatedJourneys,
} from '@/api/journeys'

export const JOURNEYS_QUERY_KEY = ['journeys'] as const

export function journeysListKey(query: FindJourneysQuery) {
  return [...JOURNEYS_QUERY_KEY, 'list', query] as const
}

export function journeyByIdKey(id: string) {
  return [...JOURNEYS_QUERY_KEY, 'detail', id] as const
}

export function journeyEventsKey(
  journeyId: string,
  query: { page?: number; pageSize?: number; eventType?: string },
) {
  return [...JOURNEYS_QUERY_KEY, 'events', journeyId, query] as const
}

export function useJourneys(query: FindJourneysQuery) {
  return useQuery<PaginatedJourneys, Error>({
    queryKey: journeysListKey(query),
    queryFn: () => fetchJourneys(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useJourney(id: string | undefined) {
  return useQuery<Journey, Error>({
    queryKey: journeyByIdKey(id ?? ''),
    queryFn: () => fetchJourneyById(id as string),
    enabled: Boolean(id),
  })
}

export function useJourneyEvents(
  journeyId: string | undefined,
  query: { page?: number; pageSize?: number; eventType?: string } = {},
) {
  return useQuery<PaginatedJourneyEvents, Error>({
    queryKey: journeyEventsKey(journeyId ?? '', query),
    queryFn: () => fetchJourneyEvents(journeyId as string, query),
    enabled: Boolean(journeyId),
    staleTime: 15 * 1000,
  })
}

export function useCreateJourney() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateJourneyInput) => createJourney(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: JOURNEYS_QUERY_KEY })
    },
  })
}

export function useMarkJourneyWon() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => markJourneyWon(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: JOURNEYS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: journeyByIdKey(id) })
    },
  })
}

export function useMarkJourneyLost() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: MarkLostInput }) =>
      markJourneyLost(id, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: JOURNEYS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: journeyByIdKey(vars.id) })
    },
  })
}
