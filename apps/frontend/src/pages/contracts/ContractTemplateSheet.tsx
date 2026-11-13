import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { ExternalLink, Plus, RefreshCw, X } from 'lucide-react'
import { TextField } from '@/components/form/TextField'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { ComboboxField, type ComboboxOption } from '@/components/form/ComboboxField'
import { SelectField, SelectItem } from '@/components/form/SelectField'
import {
  useContractVariablesCatalog,
  useCreateContractTemplate,
  useUpdateContractTemplate,
  useZapsignPanelInfo,
  useZapsignTemplatesList,
} from '@/hooks/useContracts'
import {
  CONTRACT_KIND_LABELS,
  inspectZapsignTemplate,
  type ContractKind,
  type ContractTemplate,
} from '@/api/contracts'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// Form de cadastro/edição de template de contrato.
//
// Template é apontamento pra um template cadastrado no painel ZapSign.
// Aqui o admin informa: nome amigável, tipo, ID externo (UUID do ZapSign)
// e a lista de variáveis declaradas no template (ex: clientName, procedure).
//
// As variáveis viram inputs no ContractSendSheet quando o operador envia
// um contrato a partir desse template.
// =====================================================================

const formSchema = z.object({
  name: z.string().trim().min(1, 'Nome obrigatório').max(255),
  kind: z.enum(['consent_term', 'service_contract', 'image_release', 'other']),
  zapsignTemplateId: z
    .string()
    .trim()
    .min(1, 'ID do template na ZapSign obrigatório')
    .max(64),
  active: z.boolean(),
})

type FormValues = z.infer<typeof formSchema>

const FORM_ID = 'contract-template-form'

interface ContractTemplateSheetProps {
  open: boolean
  template: ContractTemplate | null
  onOpenChange: (open: boolean) => void
}

const KIND_OPTIONS: Array<ContractKind> = [
  'consent_term',
  'service_contract',
  'image_release',
  'other',
]

export function ContractTemplateSheet({
  open,
  template,
  onOpenChange,
}: ContractTemplateSheetProps): React.ReactElement {
  const isEdit = Boolean(template)
  const createTemplate = useCreateContractTemplate()
  const updateTemplate = useUpdateContractTemplate()
  const panelInfo = useZapsignPanelInfo()
  // Lista de templates ZapSign — fetched só com sheet aberto E ZapSign provisionado.
  // Se falhar, caímos no fallback de input manual (handleFetchVariables).
  const templatesList = useZapsignTemplatesList({
    enabled: open && panelInfo.data?.configured !== false,
  })
  // Catálogo de chaves que o backend resolve automaticamente — UI marca
  // cada variável importada com badge "auto" quando bate.
  const variablesCatalog = useContractVariablesCatalog({ enabled: open })
  const knownKeysSet = useMemo(
    () => new Set(variablesCatalog.data ?? []),
    [variablesCatalog.data],
  )
  const useCombobox =
    panelInfo.data?.configured !== false &&
    !templatesList.isError &&
    Boolean(templatesList.data)

  // Variáveis ficam num state separado pra suportar adicionar/remover.
  const [variables, setVariables] = useState<string[]>([])
  const [newVariable, setNewVariable] = useState('')
  const [isFetchingVariables, setIsFetchingVariables] = useState(false)
  const [templateSearch, setTemplateSearch] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      kind: 'consent_term',
      zapsignTemplateId: '',
      active: true,
    },
  })

  const watchedZapsignId = watch('zapsignTemplateId')?.trim() ?? ''

  useEffect(() => {
    if (open) {
      reset({
        name: template?.name ?? '',
        kind: template?.kind ?? 'consent_term',
        zapsignTemplateId: template?.zapsignTemplateId ?? '',
        active: template?.active ?? true,
      })
      setVariables(template?.variables ?? [])
      setNewVariable('')
      setTemplateSearch('')
    }
  }, [open, template, reset])

  // Filtra opções por busca local (Combobox espera lista já filtrada).
  const templateOptions: ComboboxOption[] = useMemo(() => {
    const all = templatesList.data ?? []
    const term = templateSearch.trim().toLowerCase()
    const filtered = term
      ? all.filter(
          (t) =>
            t.name.toLowerCase().includes(term) ||
            t.externalTemplateId.toLowerCase().includes(term),
        )
      : all
    return filtered.map((t) => ({
      value: t.externalTemplateId,
      label: t.name,
      hint: t.externalTemplateId,
    }))
  }, [templatesList.data, templateSearch])

  // Label custom quando o ID atual não está mais na lista — comum em edição
  // se o template foi removido do painel ZapSign.
  const selectedTemplateLabel = useMemo(() => {
    if (!watchedZapsignId) return null
    const found = templatesList.data?.find(
      (t) => t.externalTemplateId === watchedZapsignId,
    )
    if (found) return found.name
    return `${watchedZapsignId} (não encontrado na ZapSign)`
  }, [watchedZapsignId, templatesList.data])

  const handleAddVariable = () => {
    const value = newVariable.trim()
    if (!value) return
    if (variables.includes(value)) {
      toast.error('Variável já adicionada')
      return
    }
    setVariables([...variables, value])
    setNewVariable('')
  }

  const handleRemoveVariable = (name: string) => {
    setVariables(variables.filter((v) => v !== name))
  }

  // Puxa nome + variáveis a partir do ID do template na ZapSign. Sobrescreve
  // o array de variáveis (intencional — o template no ZapSign é fonte da
  // verdade); preenche o nome só se o campo estiver vazio pra não atropelar
  // edição manual do admin.
  const fetchAndApplyVariables = async (id: string): Promise<void> => {
    setIsFetchingVariables(true)
    try {
      const info = await inspectZapsignTemplate(id)
      setVariables(info.variables)
      const currentName = getValues('name').trim()
      if (!currentName && info.name) {
        setValue('name', info.name, { shouldValidate: true, shouldDirty: true })
      }
      if (info.variables.length === 0) {
        toast.warning('Template encontrado mas sem variáveis declaradas')
      } else {
        toast.success(
          `${info.variables.length} variável${info.variables.length === 1 ? '' : 'is'} importada${info.variables.length === 1 ? '' : 's'} do ZapSign`,
        )
      }
    } catch (err) {
      toast.error(extractErrorMessage(err))
    } finally {
      setIsFetchingVariables(false)
    }
  }

  const handleFetchVariables = (): void => {
    const id = getValues('zapsignTemplateId').trim()
    if (!id) {
      toast.error('Informe o ID do template antes de buscar')
      return
    }
    void fetchAndApplyVariables(id)
  }

  // Combobox onChange — atualiza o form, limpa variáveis se desmarcar, e
  // dispara fetch automático de variáveis quando seleciona um novo template.
  const handleSelectTemplate = (id: string | null): void => {
    const nextId = id ?? ''
    setValue('zapsignTemplateId', nextId, {
      shouldValidate: true,
      shouldDirty: true,
    })
    if (!id) {
      setVariables([])
      return
    }
    void fetchAndApplyVariables(id)
  }

  const onSubmit = handleSubmit(async (data) => {
    try {
      if (isEdit && template) {
        await updateTemplate.mutateAsync({
          id: template.id,
          input: {
            name: data.name,
            kind: data.kind,
            zapsignTemplateId: data.zapsignTemplateId,
            variables,
            active: data.active,
          },
        })
        toast.success('Template atualizado')
      } else {
        await createTemplate.mutateAsync({
          name: data.name,
          kind: data.kind,
          zapsignTemplateId: data.zapsignTemplateId,
          variables,
        })
        toast.success('Template cadastrado')
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle={isEdit ? 'Editar template' : 'Novo template'}>
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            />
            <SheetToolbar.Action
              label={isSubmitting ? 'Salvando…' : isEdit ? 'Salvar' : 'Cadastrar'}
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting}
            />
          </SheetToolbar>

          <SheetBody>
            <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4">
          <TextField
            label="Nome"
            required
            placeholder="Termo de consentimento — depilação"
            {...register('name')}
            error={errors.name?.message}
          />

          <SelectField
            id="template-kind"
            label="Tipo"
            value={watch('kind')}
            onValueChange={(v) =>
              setValue('kind', v as (typeof KIND_OPTIONS)[number], {
                shouldValidate: true,
                shouldDirty: true,
              })
            }
          >
            {KIND_OPTIONS.map((k) => (
              <SelectItem key={k} value={k}>
                {CONTRACT_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectField>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-end gap-2">
              {panelInfo.data && (
                <a
                  href={panelInfo.data.panelUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  Abrir painel ZapSign
                  <ExternalLink className="size-3" />
                </a>
              )}
            </div>

            {/* Hidden input registra o valor no react-hook-form mesmo quando
                o input visível é o Combobox (que não tem name/ref). */}
            <input type="hidden" {...register('zapsignTemplateId')} />

            {useCombobox ? (
              <ComboboxField
                label="Template na ZapSign"
                required
                error={errors.zapsignTemplateId?.message ?? null}
                value={watchedZapsignId || null}
                onChange={handleSelectTemplate}
                options={templateOptions}
                search={templateSearch}
                onSearchChange={setTemplateSearch}
                placeholder={
                  templatesList.isLoading
                    ? 'Carregando templates…'
                    : 'Selecione um template'
                }
                emptyLabel={
                  templatesList.data && templatesList.data.length === 0
                    ? 'Nenhum template cadastrado no painel ZapSign'
                    : 'Nenhum resultado'
                }
                isLoading={templatesList.isLoading || isFetchingVariables}
                selectedLabel={selectedTemplateLabel}
              />
            ) : (
              <div className="flex items-stretch gap-2">
                <TextField
                  label="ID do template na ZapSign"
                  required
                  containerClassName="flex-1"
                  placeholder="a1b2c3d4-e5f6-..."
                  defaultValue={watchedZapsignId}
                  onChange={(e) =>
                    setValue('zapsignTemplateId', e.target.value, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  error={errors.zapsignTemplateId?.message ?? null}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleFetchVariables}
                  disabled={
                    isFetchingVariables ||
                    !watchedZapsignId ||
                    panelInfo.data?.configured === false
                  }
                  title={
                    panelInfo.data?.configured === false
                      ? 'ZapSign não está provisionado no backend'
                      : 'Buscar variáveis automaticamente do template'
                  }
                >
                  <RefreshCw
                    className={`size-4 ${isFetchingVariables ? 'animate-spin' : ''}`}
                  />
                  <span className="ml-1.5 hidden sm:inline">
                    {isFetchingVariables ? 'Buscando…' : 'Buscar variáveis'}
                  </span>
                </Button>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              {useCombobox
                ? 'Selecione um template já cadastrado no painel ZapSign. ' +
                  'Variáveis são puxadas automaticamente ao escolher.'
                : 'Painel ZapSign → Modelos → copie o ID do modelo.'}{' '}
              {panelInfo.data?.isSandbox && (
                <span className="font-medium text-warning">
                  Modo sandbox — assinaturas sem validade jurídica.
                </span>
              )}
              {panelInfo.data?.configured === false && (
                <span className="font-medium text-error">
                  {' '}
                  ZapSign não provisionado — sem lista nem autofetch.
                </span>
              )}
              {templatesList.isError && (
                <span className="font-medium text-error">
                  {' '}
                  Falha ao carregar lista da ZapSign — usando entrada manual.
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Variáveis</h3>
              <span className="text-xs text-muted-foreground">
                {variables.length} cadastrada{variables.length === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Chaves marcadas no template do ZapSign. Variáveis com badge{' '}
              <span className="rounded bg-success/15 px-1 text-[10px] font-medium text-success">
                auto
              </span>{' '}
              são preenchidas automaticamente a partir de clients/tenants no envio
              (catálogo em <code>docs/contracts-domain.md §11</code>). Sem badge =
              o operador digita manualmente.
            </p>

            {variables.length > 0 && (
              <ul className="flex flex-col gap-1">
                {variables.map((v) => {
                  const isKnown = knownKeysSet.has(v)
                  return (
                    <li
                      key={v}
                      className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1"
                    >
                      <code className="flex-1 truncate text-xs">{v}</code>
                      {isKnown && (
                        <span
                          className="rounded bg-success/15 px-1 text-[10px] font-medium text-success"
                          title="Preenchida automaticamente a partir de clients/tenants no envio"
                        >
                          auto
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveVariable(v)}
                        className="text-muted-foreground hover:text-error"
                        aria-label={`Remover variável ${v}`}
                      >
                        <X className="size-4" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line no-restricted-syntax -- input compacto da ação "adicionar variável" (com botão ao lado) */}
              <input
                type="text"
                placeholder="nome_da_variavel"
                value={newVariable}
                onChange={(e) => setNewVariable(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddVariable()
                  }
                }}
                className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={handleAddVariable}
              >
                <Plus className="size-4" />
              </Button>
            </div>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                {...register('active')}
                className="size-4 rounded border-input"
              />
              <span className="text-sm">Template ativo</span>
            </label>
          )}
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}

function extractErrorMessage(err: unknown): string {
  const msg = apiErrorText(err)
  if (msg) return msg
  if (err instanceof Error) return err.message
  return 'Erro inesperado'
}
