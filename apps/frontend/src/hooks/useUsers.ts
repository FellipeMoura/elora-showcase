import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  activateUser,
  createUser,
  deactivateUser,
  deleteUser,
  fetchUsers,
  setUserGroups,
  updateUser,
  type CreateUserInput,
  type FindUsersQuery,
  type PaginatedUsers,
  type UpdateUserInput,
  type User,
} from '@/api/users'

// Raiz das queries de users — mutations invalidam tudo de uma vez. A lista
// é paginada; refetch da page atual cobre o caso comum (edição/criação).
export const USERS_QUERY_KEY = ['users'] as const

export function usersQueryKey(query: FindUsersQuery) {
  return [...USERS_QUERY_KEY, query] as const
}

export function useUsers(query: FindUsersQuery) {
  return useQuery<PaginatedUsers, Error>({
    queryKey: usersQueryKey(query),
    queryFn: () => fetchUsers(query),
    // keepPreviousData semantics no v5: placeholderData garante UX suave
    // ao mudar de página/filtro sem flicker.
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useCreateUser() {
  const queryClient = useQueryClient()
  return useMutation<User, Error, CreateUserInput>({
    mutationFn: (input) => createUser(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
  })
}

export function useUpdateUser() {
  const queryClient = useQueryClient()
  return useMutation<User, Error, { id: string; input: UpdateUserInput }>({
    mutationFn: ({ id, input }) => updateUser(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
  })
}

export function useDeleteUser() {
  const queryClient = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
  })
}

export function useActivateUser() {
  const queryClient = useQueryClient()
  return useMutation<User, Error, string>({
    mutationFn: (id) => activateUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
  })
}

export function useDeactivateUser() {
  const queryClient = useQueryClient()
  return useMutation<User, Error, string>({
    mutationFn: (id) => deactivateUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
  })
}

export function useSetUserGroups() {
  const queryClient = useQueryClient()
  return useMutation<User, Error, { id: string; groupIds: string[] }>({
    mutationFn: ({ id, groupIds }) => setUserGroups(id, groupIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY })
    },
  })
}
