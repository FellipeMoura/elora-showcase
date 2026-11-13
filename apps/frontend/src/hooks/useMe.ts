import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  login,
  logout,
  me,
  type MeResult,
  type RoleCode,
} from '@/api/auth'
import { disablePushOnLogout } from '@/lib/pushNotifications'
import { disconnectSocket } from '@/lib/socket'
import { useChatStore } from '@/stores/chatStore'

// Chave da query do usuário corrente. Centralizada pra `invalidate` ficar
// consistente em qualquer ponto do app.
export const ME_QUERY_KEY = ['me'] as const

// Estado de auth derivado puramente de server state — sem store separada.
// Quem precisar do user: `useMe()`. Quem precisar fazer login/logout:
// `useLogin()` / `useLogout()`. Refetch automático em focus e mount.
//
// O resultado inclui `user` (PublicUser) + `roleCodes` (RoleCode[]) —
// frontend usa roleCodes pra condicionar UI de permissões (ex: AvailabilityPage
// liberar "edita qualquer um" só pra admin/manager).
export function useMe() {
  return useQuery<MeResult, Error>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => me(),
    // Não retry em 401 — usuário não logado é estado válido, não erro de rede.
    retry: (failureCount, error) => {
      const status = (error as { response?: { status?: number } })?.response?.status
      if (status === 401) return false
      return failureCount < 2
    },
    // user data não muda no servidor com frequência durante uma sessão;
    // evita refetch desnecessário em troca de aba.
    staleTime: 5 * 60 * 1000,
  })
}

const PRIVILEGED_ROLES: ReadonlyArray<RoleCode> = ['admin', 'manager']

// Helper pra condicionar UI: o user logado tem permissão "gerencial"
// (admin/manager)? Usado em AvailabilityPage e outras telas com gate
// "qualquer profissional" vs "self only".
export function useIsPrivileged(): boolean {
  const { data } = useMe()
  if (!data) return false
  return data.roleCodes.some((r) => PRIVILEGED_ROLES.includes(r))
}

export function useLogin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ username, password }: { username: string; password: string }) =>
      login(username, password),
    onSuccess: () => {
      // Login retorna só PublicUser; pra hidratar com roleCodes precisaríamos
      // de um round-trip a /me. Em vez disso, invalida — TanStack refaz a
      // query automaticamente e a UI pega user + roleCodes consistentes.
      queryClient.invalidateQueries({ queryKey: ME_QUERY_KEY })
    },
  })
}

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      // Antes do logout: o DELETE da assinatura ainda precisa da sessão.
      // Sem isso o próximo usuário deste aparelho veria as notificações
      // de quem saiu. Best-effort, nunca bloqueia o logout.
      await disablePushOnLogout()
      await logout()
    },
    onSuccess: () => {
      // Desconecta socket + zera chatStore antes de limpar o cache. Sem
      // isso, listeners ficariam vivos brevemente apontando pra dados
      // que vão ser invalidados. Import direto (sem helper) pra evitar
      // ciclo com useChatRealtime, que depende de useMe.
      disconnectSocket()
      useChatStore.getState().reset()
      queryClient.clear()
    },
  })
}
