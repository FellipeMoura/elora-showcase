import type { AxiosError, AxiosInstance } from 'axios'

// Evento global disparado quando uma sessão autenticada expira em runtime
// (cookie inválido após estar logado). O <RequireAuth> escuta e força
// logout + redirect.
//
// Endpoints excluídos do disparo:
//   - /auth/login → 401 nele é credencial inválida (vai pro try/catch do form)
//   - /auth/me   → 401 nele é o estado normal "deslogado" no boot do app,
//                  NÃO sessão expirada. Disparar AUTH_EXPIRED aqui causa
//                  loop: clear cache → refetch useMe → 401 → loop, e ainda
//                  desconecta o socket recém-conectado pós-login.
//
// Pattern reaproveitado do sistema legado: desacopla o interceptor (que não
// tem acesso a router/store) do consumidor (componente React).
export const AUTH_EXPIRED_EVENT = 'elora:auth-expired'

interface ApiErrorBody {
  message?: string
  details?: unknown
}

export function installInterceptors(instance: AxiosInstance): void {
  instance.interceptors.response.use(
    (response) => response,
    (error: AxiosError<ApiErrorBody>) => {
      const status = error.response?.status
      const url = error.config?.url ?? ''

      // 401 só dispara "auth expired" pra rotas que NÃO sejam de auth.
      // /auth/login: credencial inválida (try/catch do form).
      // /auth/me:    estado normal "deslogado" no boot — disparar aqui
      //              causaria loop infinito de clear/refetch e desconectaria
      //              o socket pós-login.
      const isAuthEndpoint = url.includes('/auth/login') || url.includes('/auth/me')
      if (status === 401 && !isAuthEndpoint) {
        window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT))
      }

      return Promise.reject(error)
    },
  )
}
