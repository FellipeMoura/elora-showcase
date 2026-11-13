import { useEffect } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useMe } from '@/hooks/useMe'
import { AUTH_EXPIRED_EVENT } from '@/api/interceptors'
import { disconnectSocket } from '@/lib/socket'
import { useChatStore } from '@/stores/chatStore'

interface RequireAuthProps {
  children: React.ReactNode
}

// Gateia rotas autenticadas. Faz três coisas:
// 1. Bloqueia render até a query do /me resolver — evita flicker entre logado/deslogado.
// 2. Redireciona pro /login se não autenticado.
// 3. Escuta o evento global de auth expirada (disparado pelo interceptor em 401)
//    e faz logout completo + navega pra /login. Mesmo cleanup do useLogout —
//    auth expirada do server é equivalente a logout iniciado pelo user.
export function RequireAuth({ children }: RequireAuthProps): React.ReactNode {
  const { data: me, isLoading, isError } = useMe()
  const user = me?.user
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useEffect(() => {
    const onExpired = (): void => {
      // [DIAG] instrumentação temporária — remover após diagnóstico
      console.log('[RequireAuth][diag] AUTH_EXPIRED_EVENT recebido → disconnectSocket + reset + navigate /login')
      console.trace('[RequireAuth][diag] AUTH_EXPIRED stack')
      // Mesma sequência do useLogout.onSuccess: socket → store → cache.
      // Ordem importa pra evitar listeners apontando pra dados invalidados.
      disconnectSocket()
      useChatStore.getState().reset()
      queryClient.clear()
      toast.error('Sessão expirada. Faça login novamente.')
      // Navegação explícita: não esperar useMe refetar/falhar pra disparar
      // o Navigate abaixo. Preserva o pathname pra o LoginPage redirecionar
      // de volta depois do login bem-sucedido.
      navigate('/login', {
        state: { from: location.pathname },
        replace: true,
      })
    }
    window.addEventListener(AUTH_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, onExpired)
  }, [queryClient, navigate, location.pathname])

  if (isLoading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <div className="text-sm text-muted-foreground">Carregando…</div>
      </div>
    )
  }

  if (isError || !user) {
    // Caso inicial: usuário entra direto numa rota protegida sem sessão.
    // (Auth expirada em runtime é tratada pelo event handler acima.)
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <>{children}</>
}
