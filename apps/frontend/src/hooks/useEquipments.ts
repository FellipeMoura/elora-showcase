import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  activateEquipment,
  createEquipment,
  deactivateEquipment,
  deleteEquipment,
  fetchEquipmentById,
  fetchEquipments,
  updateEquipment,
  type CreateEquipmentInput,
  type Equipment,
  type FindEquipmentsQuery,
  type PaginatedEquipments,
  type UpdateEquipmentInput,
} from '@/api/equipments'

export const EQUIPMENTS_QUERY_KEY = ['equipments'] as const

export function equipmentsListKey(query: FindEquipmentsQuery) {
  return [...EQUIPMENTS_QUERY_KEY, 'list', query] as const
}

export function equipmentByIdKey(id: string) {
  return [...EQUIPMENTS_QUERY_KEY, 'detail', id] as const
}

export function useEquipments(query: FindEquipmentsQuery) {
  return useQuery<PaginatedEquipments, Error>({
    queryKey: equipmentsListKey(query),
    queryFn: () => fetchEquipments(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useEquipment(id: string | undefined) {
  return useQuery<Equipment, Error>({
    queryKey: equipmentByIdKey(id ?? ''),
    queryFn: () => fetchEquipmentById(id as string),
    enabled: Boolean(id),
  })
}

export function useCreateEquipment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateEquipmentInput) => createEquipment(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EQUIPMENTS_QUERY_KEY })
    },
  })
}

export function useUpdateEquipment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateEquipmentInput }) =>
      updateEquipment(id, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: EQUIPMENTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: equipmentByIdKey(vars.id) })
    },
  })
}

export function useDeactivateEquipment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deactivateEquipment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EQUIPMENTS_QUERY_KEY })
    },
  })
}

export function useActivateEquipment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => activateEquipment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EQUIPMENTS_QUERY_KEY })
    },
  })
}

export function useDeleteEquipment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteEquipment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: EQUIPMENTS_QUERY_KEY })
    },
  })
}
