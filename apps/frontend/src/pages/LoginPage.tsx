import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { LoginForm } from '@/components/auth/LoginForm'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { useMe } from '@/hooks/useMe'
import { getTenantSlug } from '@/lib/tenant'

export function LoginPage(): React.ReactElement {
  const { data: me, isLoading } = useMe()
  const navigate = useNavigate()
  const location = useLocation()
  const slug = getTenantSlug()

  // Já logado tentando ir pra /login? Volta pro destino original (ou /).
  useEffect(() => {
    if (!isLoading && me?.user) {
      const from = (location.state as { from?: string } | null)?.from ?? '/'
      navigate(from, { replace: true })
    }
  }, [me, isLoading, navigate, location.state])

  return (
    <div className="flex min-h-svh flex-col bg-background text-foreground">
      <div className="flex justify-end p-4">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-6 text-card-foreground shadow-sm">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold tracking-tight">Entrar no Elora</h1>
            <p className="text-sm text-muted-foreground">
              {slug
                ? `Tenant: ${slug}`
                : 'Acesse via subdomínio do tenant (ex: clinica-a.localhost:5500).'}
            </p>
          </div>

          {slug ? (
            <LoginForm
              onSuccess={() => {
                const from = (location.state as { from?: string } | null)?.from ?? '/'
                navigate(from, { replace: true })
              }}
            />
          ) : (
            <p className="text-sm text-destructive">
              Sem tenant no host — o backend rejeita login sem subdomínio.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
