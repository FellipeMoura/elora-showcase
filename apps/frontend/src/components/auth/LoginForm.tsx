import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/form/TextField'
import { UsernameInput } from '@/components/form/UsernameInput'
import { useLogin } from '@/hooks/useMe'
import { apiErrorText } from '@/lib/apiError'

const loginSchema = z.object({
  username: z
    .string()
    .trim()
    .min(1, 'Usuário obrigatório')
    .max(255)
    .regex(/^[a-z0-9_]+$/, 'Apenas letras minúsculas, números e _'),
  password: z.string().min(6, 'Senha muito curta'),
})

type LoginInput = z.infer<typeof loginSchema>

interface LoginFormProps {
  onSuccess?: () => void
}

export function LoginForm({ onSuccess }: LoginFormProps): React.ReactElement {
  const login = useLogin()
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: '', password: '' },
  })

  const onSubmit = handleSubmit(async (data) => {
    try {
      await login.mutateAsync(data)
      onSuccess?.()
    } catch (err) {
      // Backend retorna 401 com mensagem genérica pra credenciais inválidas.
      // Outros erros (500, network) caem no fallback.
      const response = (err as { response?: { status?: number; data?: { message?: string } } })?.response
      const status = response?.status
      const backendMessage = apiErrorText(err)
      if (status === 401) {
        toast.error('Credenciais inválidas')
      } else if (status === 403) {
        toast.error('Usuário desativado')
      } else if (status === 429) {
        toast.error(backendMessage ?? 'Muitas tentativas. Tente novamente em alguns minutos.')
      } else {
        toast.error(backendMessage ?? 'Erro ao entrar. Tente novamente.')
      }
    }
  })

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <UsernameInput
        label="Usuário"
        placeholder="seu_usuario"
        error={errors.username?.message ?? null}
        required
        {...register('username')}
      />
      <TextField
        label="Senha"
        type="password"
        autoComplete="current-password"
        placeholder="••••••••"
        error={errors.password?.message ?? null}
        required
        {...register('password')}
      />
      <Button type="submit" disabled={isSubmitting || login.isPending} className="w-full">
        {isSubmitting || login.isPending ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  )
}
