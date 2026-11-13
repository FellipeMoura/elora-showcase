import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { TextField } from '@/components/form/TextField'
import { SelectField, SelectItem } from '@/components/form/SelectField'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  useCreateMenu,
  useMenuGroups,
  useMenuTenants,
  useSetMenuGroups,
  useSetMenuTenants,
  useUpdateMenu,
} from '@/hooks/useMenus'
import { useGroups } from '@/hooks/useGroups'
import { useTenants } from '@/hooks/useTenants'
import type { Menu, MenuNode } from '@/api/menus'
import { apiErrorText } from '@/lib/apiError'

// Regex de hex CSS — mesma exigência do backend (`#RGB`, `#RRGGBB`, `#RRGGBBAA`).
// Vazio é permitido (opcional).
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

// Schema do form — versão leniente. Backend valida mais a fundo, aqui só
// cobrimos exigências de UX (label obrigatório, position inteiro >=0).
const formSchema = z.object({
  label: z.string().trim().min(1, 'Label obrigatório').max(255),
  icon: z.string().trim().max(64),
  color: z
    .string()
    .trim()
    .max(32)
    .refine((v) => v === '' || HEX_COLOR.test(v), {
      message: 'Cor precisa ser hex (#RGB, #RRGGBB ou #RRGGBBAA)',
    }),
  path: z.string().trim().max(512),
  position: z.coerce.number().int().min(0, 'Posição precisa ser >= 0'),
  parentId: z.string(), // '' = raiz, uuid = filho
})

type FormValues = z.infer<typeof formSchema>

interface MenuFormSheetProps {
  open: boolean
  /** null = criar novo. Menu = editar existente. */
  menu: Menu | null
  /** Pai pré-selecionado quando cria submenu via "+Sub" da row. null = raiz. */
  defaultParentId?: string | null
  /** Árvore de menus pra montar o select de parent. */
  parents: MenuNode[]
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'menu-form'
const emptyValues: FormValues = {
  label: '',
  icon: '',
  color: '',
  path: '',
  position: 0,
  parentId: '',
}

function valuesFromMenu(menu: Menu | null, defaultParentId?: string | null): FormValues {
  if (!menu) {
    return {
      ...emptyValues,
      parentId: defaultParentId ?? '',
    }
  }
  return {
    label: menu.label,
    icon: menu.icon ?? '',
    color: menu.color ?? '',
    path: menu.path ?? '',
    position: menu.position,
    parentId: menu.parentId ?? '',
  }
}

// Achata árvore só com nós-raiz pra select de parent — submenu não pode
// virar pai de outro submenu (estrutura 2 níveis no produto).
function flattenRoots(tree: MenuNode[]): Menu[] {
  return tree.filter((n) => n.parentId === null)
}

export function MenuFormSheet({
  open,
  menu,
  defaultParentId,
  parents,
  onOpenChange,
}: MenuFormSheetProps): React.ReactElement {
  const isEdit = Boolean(menu)
  const createMutation = useCreateMenu()
  const updateMutation = useUpdateMenu()
  const setTenantsMutation = useSetMenuTenants()
  const setGroupsMutation = useSetMenuGroups()

  const tenantsQuery = useTenants()
  const menuTenantsQuery = useMenuTenants(menu?.id ?? null)
  const groupsQuery = useGroups()
  const menuGroupsQuery = useMenuGroups(menu?.id ?? null)

  // Conjuntos marcados — estado próprio porque RHF lida mal com arrays
  // dinâmicos de checkbox sem useFieldArray. Tenants e grupos são listas
  // paralelas ao form principal.
  const [selectedTenantIds, setSelectedTenantIds] = useState<Set<string>>(
    new Set(),
  )
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(
    new Set(),
  )

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues,
  })

  // Espelho da cor pro <input type="color"> — que exige `#RRGGBB` mesmo
  // quando o campo texto está vazio. Fallback pra preto quando não há cor.
  const colorValue = watch('color')
  const pickerValue =
    colorValue && /^#[0-9a-fA-F]{6}$/.test(colorValue) ? colorValue : '#000000'

  useEffect(() => {
    if (!open) return
    reset(valuesFromMenu(menu, defaultParentId))
    // Edit: marca tenants e grupos já vinculados (espera fetch terminar).
    // Create: deixa vazio — usuário marca quem quer.
    if (menu && menuTenantsQuery.data) {
      setSelectedTenantIds(new Set(menuTenantsQuery.data.map((t) => t.id)))
    } else if (!menu) {
      setSelectedTenantIds(new Set())
    }
    if (menu && menuGroupsQuery.data) {
      setSelectedGroupIds(new Set(menuGroupsQuery.data.map((g) => g.id)))
    } else if (!menu) {
      setSelectedGroupIds(new Set())
    }
  }, [
    open,
    menu,
    defaultParentId,
    reset,
    menuTenantsQuery.data,
    menuGroupsQuery.data,
  ])

  const rootOptions = flattenRoots(parents)
  // Edição: ao editar um menu raiz, não permitir trocar pra ser filho de
  // si mesmo. Submenu pode trocar de pai livremente entre raízes.
  const selectableRoots = isEdit
    ? rootOptions.filter((r) => r.id !== menu?.id)
    : rootOptions

  const tenantOptions = useMemo(
    () => tenantsQuery.data ?? [],
    [tenantsQuery.data],
  )

  const groupOptions = useMemo(
    () => groupsQuery.data ?? [],
    [groupsQuery.data],
  )

  const toggleTenant = (tenantId: string) => {
    setSelectedTenantIds((prev) => {
      const next = new Set(prev)
      if (next.has(tenantId)) next.delete(tenantId)
      else next.add(tenantId)
      return next
    })
  }

  const toggleGroup = (groupId: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  const onSubmit = handleSubmit(async (data) => {
    const payload = {
      label: data.label,
      icon: data.icon === '' ? null : data.icon,
      color: data.color === '' ? null : data.color,
      path: data.path === '' ? null : data.path,
      position: data.position,
      parentId: data.parentId === '' ? null : data.parentId,
    }

    const tenantIds = [...selectedTenantIds]
    const groupIds = [...selectedGroupIds]

    try {
      let savedId: string
      if (isEdit && menu) {
        const updated = await updateMutation.mutateAsync({
          id: menu.id,
          input: payload,
        })
        savedId = updated.id
      } else {
        const created = await createMutation.mutateAsync(payload)
        savedId = created.id
      }

      // Persiste tenants e grupos em PUTs idempotentes — backend faz o diff.
      await setTenantsMutation.mutateAsync({ menuId: savedId, tenantIds })
      await setGroupsMutation.mutateAsync({ menuId: savedId, groupIds })

      toast.success(isEdit ? 'Menu atualizado' : 'Menu criado')
      onOpenChange(false)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const message = apiErrorText(err)
      if (status === 409) {
        toast.error(message ?? 'Conflito ao salvar menu')
      } else if (status === 400) {
        toast.error(message ?? 'Dados inválidos')
      } else {
        toast.error('Erro ao salvar menu. Tente novamente.')
      }
    }
  })

  const tenantsLoading = tenantsQuery.isLoading || (isEdit && menuTenantsQuery.isLoading)
  const groupsLoading = groupsQuery.isLoading || (isEdit && menuGroupsQuery.isLoading)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle={isEdit ? 'Editar menu' : 'Novo menu'}>
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
              {/* Radix Select não aceita item com value="" — sentinela
                  `__root__` representa "sem pai" e vira '' no form. */}
              <SelectField
                id="menu-parent"
                label="Pai"
                value={watch('parentId') || '__root__'}
                onValueChange={(v) =>
                  setValue('parentId', v === '__root__' ? '' : v, {
                    shouldDirty: true,
                  })
                }
                helperText="Raiz aparece direto no sidebar. Submenu aparece dentro do pai escolhido."
              >
                <SelectItem value="__root__">— Sem pai (menu raiz) —</SelectItem>
                {selectableRoots.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectField>

              <TextField
                label="Label"
                placeholder="Clientes"
                error={errors.label?.message ?? null}
                required
                {...register('label')}
              />

              <TextField
                label="Ícone"
                placeholder="users"
                helperText="Nome do ícone Lucide (ex: 'users', 'calendar', 'settings', 'user-cog'). Lista em lucide.dev/icons."
                error={errors.icon?.message ?? null}
                {...register('icon')}
              />

              <div className="flex items-start gap-2">
                <TextField
                  label="Cor do ícone"
                  placeholder="#ef4444"
                  helperText="Hex CSS (ex: #ef4444). Deixe vazio pra herdar a cor do tema."
                  error={errors.color?.message ?? null}
                  containerClassName="flex-1"
                  {...register('color')}
                />
                <input
                  type="color"
                  aria-label="Selecionar cor do ícone"
                  value={pickerValue}
                  onChange={(e) =>
                    setValue('color', e.target.value, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  className="h-12 w-12 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-1"
                />
              </div>

              <TextField
                label="Path"
                placeholder="/clients"
                helperText="Rota destino quando o usuário clica. Deixe vazio se for só agrupador."
                error={errors.path?.message ?? null}
                {...register('path')}
              />

              <TextField
                label="Posição"
                type="number"
                min={0}
                step={1}
                helperText="Ordem dentro do mesmo nível. Menor = mais acima."
                error={errors.position?.message ?? null}
                required
                {...register('position')}
              />

              <fieldset className="flex flex-col gap-2 rounded-md border border-input p-3">
                <legend className="px-1 text-sm font-medium">Tenants com acesso</legend>
                <p className="text-xs text-muted-foreground">
                  Marque quais clínicas enxergam este menu. Sem marcação, o menu fica
                  só no catálogo — ninguém vê.
                </p>
                {tenantsLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando tenants…</p>
                ) : tenantOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum tenant cadastrado.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {tenantOptions.map((t) => {
                      const checked = selectedTenantIds.has(t.id)
                      const inputId = `menu-tenant-${t.id}`
                      return (
                        <label
                          key={t.id}
                          htmlFor={inputId}
                          className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-0.5 hover:bg-accent/50"
                        >
                          <Checkbox
                            id={inputId}
                            checked={checked}
                            onCheckedChange={() => toggleTenant(t.id)}
                          />
                          <span className="text-sm">{t.name}</span>
                          <span className="font-mono text-xs text-muted-foreground">
                            ({t.slug})
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </fieldset>

              <fieldset className="flex flex-col gap-2 rounded-md border border-input p-3">
                <legend className="px-1 text-sm font-medium">Grupos com acesso</legend>
                <p className="text-xs text-muted-foreground">
                  Marque quais perfis enxergam este menu na sidebar. A matriz é
                  global — afeta todos os tenants vinculados acima.
                </p>
                {groupsLoading ? (
                  <p className="text-sm text-muted-foreground">Carregando grupos…</p>
                ) : groupOptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum grupo cadastrado.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {groupOptions.map((g) => {
                      const checked = selectedGroupIds.has(g.id)
                      const inputId = `menu-group-${g.id}`
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
