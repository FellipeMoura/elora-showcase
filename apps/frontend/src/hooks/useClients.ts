import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  activateClient,
  createClient,
  deactivateClient,
  deleteClient,
  fetchClientById,
  fetchClients,
  updateClient,
  type Client,
  type CreateClientInput,
  type FindClientsQuery,
  type PaginatedClients,
  type UpdateClientInput,
} from '@/api/clients'

// Chave raiz das queries do recurso. Mutations invalidam por raiz pra
// pegar lista + detail em um único invalidate.
export const CLIENTS_QUERY_KEY = ['clients'] as const

export function clientsListKey(query: FindClientsQuery) {
  return [...CLIENTS_QUERY_KEY, 'list', query] as const
}

export function clientByIdKey(id: string) {
  return [...CLIENTS_QUERY_KEY, 'detail', id] as const
}

// Lista paginada. keepPreviousData mantém os dados antigos visíveis enquanto
// a próxima página/busca carrega — evita flash de "Loading…" em paginação.
export function useClients(query: FindClientsQuery) {
  return useQuery<PaginatedClients, Error>({
    queryKey: clientsListKey(query),
    queryFn: () => fetchClients(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useClient(id: string | undefined) {
  return useQuery<Client, Error>({
    queryKey: clientByIdKey(id ?? ''),
    queryFn: () => fetchClientById(id as string),
    enabled: Boolean(id),
  })
}

export function useCreateClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateClientInput) => createClient(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_QUERY_KEY })
    },
  })
}

export function useUpdateClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateClientInput }) =>
      updateClient(id, input),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: clientByIdKey(vars.id) })
    },
  })
}

export function useDeactivateClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deactivateClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_QUERY_KEY })
    },
  })
}

export function useActivateClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => activateClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_QUERY_KEY })
    },
  })
}

export function useDeleteClient() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CLIENTS_QUERY_KEY })
    },
  })
}
