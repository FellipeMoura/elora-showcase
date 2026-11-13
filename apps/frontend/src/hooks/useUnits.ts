import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  activateUnit,
  createUnit,
  deactivateUnit,
  deleteUnit,
  fetchUnitById,
  fetchUnits,
  updateUnit,
  type CreateUnitInput,
  type FindUnitsQuery,
  type PaginatedUnits,
  type Unit,
  type UpdateUnitInput,
} from '@/api/units'

export const UNITS_QUERY_KEY = ['units'] as const

export function unitsListKey(query: FindUnitsQuery) {
  return [...UNITS_QUERY_KEY, 'list', query] as const
}

export function unitByIdKey(id: string) {
  return [...UNITS_QUERY_KEY, 'detail', id] as const
}

export function useUnits(query: FindUnitsQuery) {
  return useQuery<PaginatedUnits, Error>({
    queryKey: unitsListKey(query),
    queryFn: () => fetchUnits(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useUnit(id: string | undefined) {
  return useQuery<Unit, Error>({
    queryKey: unitByIdKey(id ?? ''),
    queryFn: () => fetchUnitById(id as string),
    enabled: Boolean(id),
  })
}

export function useCreateUnit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateUnitInput) => createUnit(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UNITS_QUERY_KEY })
    },
  })
}

export function useUpdateUnit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUnitInput }) =>
      updateUnit(id, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: UNITS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: unitByIdKey(vars.id) })
    },
  })
}

export function useDeactivateUnit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deactivateUnit(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UNITS_QUERY_KEY })
    },
  })
}

export function useActivateUnit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => activateUnit(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UNITS_QUERY_KEY })
    },
  })
}

export function useDeleteUnit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteUnit(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: UNITS_QUERY_KEY })
    },
  })
}
