import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { TextField } from '@/components/form/TextField'
import { UsernameInput } from '@/components/form/UsernameInput'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useGroups } from '@/hooks/useGroups'
import {
  useCreateUser,
  useSetUserGroups,
  useUpdateUser,
} from '@/hooks/useUsers'
import type { User } from '@/api/users'
import {
  apiErrorDetails,
  apiErrorMessage,
  apiErrorStatus,
} from '@/lib/apiError'

// Schema do form — versão leniente. Password é obrigatório só na criação;
// em edição, vazio significa "não trocar". Backend valida min(6) no envio.
//
// `username` é o identificador de login (obrigatório). `email` é opcional
// — só é usado como contato/recovery futuro; se preenchido, valida formato.
const formSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(255),
  username: z
    .string()
    .trim()
    .min(1, 'Usuário obrigatório')
    .max(255)
    .regex(/^[a-z0-9_]+$/, 'Apenas letras minúsculas, números e _'),
  email: z
    .string()
    .trim()
    .max(255)
    .refine((v) => v.length === 0 || /.+@.+\..+/.test(v), 'Email inválido'),
  password: z.string().trim().max(100),
  canEvaluate: z.boolean(),
  canApplyProcedures: z.boolean(),
})

type FormValues = z.infer<typeof formSchema>

interface UserFormSheetProps {
  open: boolean
  /** null = criar novo. User = editar existente. */
  user: User | null
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'user-form'

// Rótulos usados na mensagem de erro do backend (details[].path → label).
const FIELD_LABELS: Record<string, string> = {
  name: 'Nome',
  username: 'Usuário',
  email: 'Email',
  password: 'Senha',
  canEvaluate: 'Avaliador',
  canApplyProcedures: 'Aplicador',
}
const emptyValues: FormValues = {
  name: '',
  username: '',
  email: '',
  password: '',
  canEvaluate: false,
  canApplyProcedures: false,
}

function valuesFromUser(user: User | null): FormValues {
  if (!user) return emptyValues
  return {
    name: user.name,
    username: user.username,
    email: user.email ?? '',
    password: '',
    canEvaluate: user.canEvaluate,
    canApplyProcedures: user.canApplyProcedures,
  }
}

export function UserFormSheet({
  open,
  user,
  onOpenChange,
}: UserFormSheetProps): React.ReactElement {
  const isEdit = Boolean(user)
  const createMutation = useCreateUser()
  const updateMutation = useUpdateUser()
  const setGroupsMutation = useSetUserGroups()

  const groupsQuery = useGroups()
  const groupOptions = groupsQuery.data ?? []

  // Estado próprio pra checkboxes — RHF lida mal com arrays dinâmicos sem
  // useFieldArray, e a lista de grupos pode mudar à medida que o catálogo
  // global é atualizado.
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set(),
  )

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues,
  })

  // Reset dos campos quando o sheet abre OU o user alvo muda.
  useEffect(() => {
    if (!open) return
    reset(valuesFromUser(user))
    setSelectedGroupIds(new Set(user?.groupIds ?? []))
  }, [open, user, reset])

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const onSubmit = handleSubmit(async (data) => {
    // Password obrigatório só na criação. Na edição, vazio = não trocar
    // (não vai pro payload). Se preenchido, exige min 6.
    if (!isEdit && data.password.length < 6) {
      setError('password', {
        type: 'manual',
        message: 'Senha precisa de pelo menos 6 caracteres',
      })
      return
    }
    if (isEdit && data.password.length > 0 && data.password.length < 6) {
      setError('password', {
        type: 'manual',
        message: 'Mínimo 6 caracteres (ou deixe vazio pra manter)',
      })
      return
    }

    const groupIds = [...selectedGroupIds]

    try {
      let savedId: string
      // Email vazio no form vira null no payload (remove/mantém sem email).
      const emailPayload: string | null =
        data.email.length > 0 ? data.email : null
      if (isEdit && user) {
        const patch: {
          name?: string
          username?: string
          email?: string | null
          password?: string
          canEvaluate?: boolean
          canApplyProcedures?: boolean
        } = {}
        if (data.name !== user.name) patch.name = data.name
        if (data.username !== user.username) patch.username = data.username
        if (emailPayload !== (user.email ?? null)) patch.email = emailPayload
        if (data.password.length > 0) patch.password = data.password
        if (data.canEvaluate !== user.canEvaluate) {
          patch.canEvaluate = data.canEvaluate
        }
        if (data.canApplyProcedures !== user.canApplyProcedures) {
          patch.canApplyProcedures = data.canApplyProcedures
        }

        if (Object.keys(patch).length > 0) {
          const updated = await updateMutation.mutateAsync({
            id: user.id,
            input: patch,
          })
          savedId = updated.id
        } else {
          savedId = user.id
        }
      } else {
        const created = await createMutation.mutateAsync({
          name: data.name,
          username: data.username,
          email: emailPayload,
          password: data.password,
          canEvaluate: data.canEvaluate,
          canApplyProcedures: data.canApplyProcedures,
        })
        savedId = created.id
      }

      // Persiste a lista de grupos em uma chamada idempotente (PUT). Roda
      // sempre — backend faz diff, sem custo se a lista não mudou.
      await setGroupsMutation.mutateAsync({ id: savedId, groupIds })

      toast.success(isEdit ? 'Usuário atualizado' : 'Usuário criado')
      onOpenChange(false)
    } catch (err) {
      const status = apiErrorStatus(err)
      if (status === 409) {
        toast.error(apiErrorMessage(err, 'Conflito ao salvar usuário'))
      } else if (status === 400) {
        // Marca no form os campos que o backend rejeitou, além do toast.
        for (const detail of apiErrorDetails(err)) {
          if (detail.path in FIELD_LABELS) {
            setError(detail.path as keyof FormValues, {
              type: 'server',
              message: detail.message,
            })
          }
        }
        toast.error(apiErrorMessage(err, 'Dados inválidos', FIELD_LABELS))
      } else {
        toast.error('Erro ao salvar usuário. Tente novamente.')
      }
    }
  })

  const groupsLoading = groupsQuery.isLoading

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle={isEdit ? 'Editar usuário' : 'Novo usuário'}>
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            />
            <SheetToolbar.Action
              label={isSubmitting ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar'}
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting}
            />
          </SheetToolbar>

          <SheetBody>
            <form
              id={FORM_ID}
              onSubmit={onSubmit}
              className="flex flex-col gap-4"
              noValidate
            >
              <TextField
                label="Nome"
                placeholder="Maria Silva"
                autoComplete="name"
                error={errors.name?.message ?? null}
                required
                {...register('name')}
              />
              <UsernameInput
                label="Usuário"
                placeholder="maria_silva"
                helperText="Identificador de login. Único por tenant. Apenas letras minúsculas, números e _."
                error={errors.username?.message ?? null}
                required
                {...register('username')}
              />
              <TextField
                label="E-mail (opcional)"
                type="email"
                placeholder="maria@clinica.com"
                autoComplete="email"
                helperText="Usado só para contato/recuperação de senha."
                error={errors.email?.message ?? null}
                {...register('email')}
              />
              <TextField
                label="Senha"
                type="password"
                placeholder={isEdit ? 'Deixe vazio pra manter' : 'Mínimo 6 caracteres'}
                autoComplete="new-password"
                helperText={
                  isEdit
                    ? 'Preenchido apenas pra trocar.'
                    : undefined
                }
                error={errors.password?.message ?? null}
                required={!isEdit}
                {...register('password')}
              />

              <fieldset className="flex flex-col gap-2 rounded-md border border-input p-3">
                <legend className="px-1 text-sm font-medium">Capacidades</legend>
                <p className="text-xs text-muted-foreground">
                  Define quem pode ser atribuído a agendamentos. Independe do
                  grupo — o sistema bloqueia o agendamento se a capacidade
                  exigida não estiver marcada.
                </p>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="user-can-evaluate"
                    className="flex cursor-pointer items-center gap-3 rounded-sm px-1 py-1 hover:bg-accent/50"
                  >
                    <Switch
                      id="user-can-evaluate"
                      checked={watch('canEvaluate')}
                      onCheckedChange={(v) =>
                        setValue('canEvaluate', v === true, {
                          shouldDirty: true,
                        })
                      }
                    />
                    <span className="text-sm">Avaliadora</span>
                    <span className="text-xs text-muted-foreground">
                      atende agendamentos de avaliação
                    </span>
                  </label>
                  <label
                    htmlFor="user-can-apply"
                    className="flex cursor-pointer items-center gap-3 rounded-sm px-1 py-1 hover:bg-accent/50"
                  >
                    <Switch
                      id="user-can-apply"
                      checked={watch('canApplyProcedures')}
                      onCheckedChange={(v) =>
                        setValue('canApplyProcedures', v === true, {
                          shouldDirty: true,
                        })
                      }
                    />
                    <span className="text-sm">Aplicadora</span>
                    <span className="text-xs text-muted-foreground">
                      atende agendamentos de procedimento
                    </span>
                  </label>
                </div>
              </fieldset>

              <fieldset className="flex flex-col gap-2 rounded-md border border-input p-3">
                <legend className="px-1 text-sm font-medium">Grupos</legend>
                <p className="text-xs text-muted-foreground">
                  Selecione os perfis que este usuário deve assumir. O catálogo é
                  global — gerenciado pela equipe Elora.
                </p>
                {groupsLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando grupos…</p>
                ) : groupOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum grupo cadastrado.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {groupOptions.map((g) => {
                      const checked = selectedGroupIds.has(g.id)
                      const inputId = `user-group-${g.id}`
                      return (
                        <label
                          key={g.id}
                          htmlFor={inputId}
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-accent/50"
                        >
                          <Checkbox
                            id={inputId}
                            checked={checked}
                            onCheckedChange={() => toggleGroup(g.id)}
                          />
                          <span className="text-sm">{g.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            ({g.roleCode})
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </fieldset>

            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
