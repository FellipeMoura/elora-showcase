import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, Loader2, MessageCircle } from 'lucide-react'
import { TextField } from '@/components/form/TextField'
import { SelectField, SelectItem } from '@/components/form/SelectField'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  useContractTemplates,
  useCreateContract,
  useResolvedContractVariables,
} from '@/hooks/useContracts'
import { useOpenClientChat } from '@/hooks/useOpenClientChat'
import { contractChatMessage } from './ContractRow'
import type {
  Contract,
  ContractKind,
  ContractTemplate,
  CreateContractInput,
} from '@/api/contracts'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// Sheet de envio de contrato.
//
// Fluxo:
//   1. Operador escolhe template (dropdown carregado dos cadastrados).
//   2. Sheet renderiza dinamicamente 1 input por variável declarada no
//      template.
//   3. Submit cria documento no ZapSign + INSERT contract local.
//   4. Tela de sucesso: mostra signUrl com botões "Copiar link" e "Abrir".
//      Reaviso: o disparo automático via WhatsApp entra na Fase 3.5;
//      por enquanto o operador copia o link e envia manualmente.
// =====================================================================

interface ContractSendSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  clientId: string
  clientName: string
  // Opcional — vincula o contrato à jornada ativa do cliente.
  journeyId?: string | null
  // Opcional (Fase 7) — vincula o contrato à venda. Vai no body do POST e ativa
  // os uniques parciais de venda (1 contrato de serviço ativo, etc).
  saleId?: string
  // Opcional (Fase 7) — restringe o select aos templates desse kind (ex:
  // 'service_contract' quando aberto pela SaleContractsSection).
  kindFilter?: ContractKind
  // Opcional — pré-seleciona um template no abrir (ex: vindo de um botão
  // específico). Quando ausente, usuário escolhe no select.
  defaultTemplateId?: string
}

const FORM_ID = 'contract-send-form'

interface FormValues {
  templateId: string
  title: string
  expiresInDays: string
  // Variáveis ficam num objeto livre — chaves geradas a partir do template.
  variables: Record<string, string>
}

const formSchema = z.object({
  templateId: z.string().uuid('Selecione um template'),
  title: z.string().trim().max(255),
  expiresInDays: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 365),
      'Entre 1 e 365 dias',
    ),
  variables: z.record(z.string(), z.string()),
})

export function ContractSendSheet({
  open,
  onOpenChange,
  clientId,
  clientName,
  journeyId,
  saleId,
  kindFilter,
  defaultTemplateId,
}: ContractSendSheetProps): React.ReactElement {
  const createContract = useCreateContract()
  // Lista só templates ativos pra escolha. `kindFilter` (Fase 7) restringe ao
  // tipo pedido pelo caller (ex: só contratos de serviço na tela da venda).
  const templatesQuery = useContractTemplates({ active: true, pageSize: 100 })
  const templates: ContractTemplate[] = (templatesQuery.data?.items ?? []).filter(
    (t) => !kindFilter || t.kind === kindFilter,
  )
  // Esconde o select quando o template já vem fixado (kind + default juntos) —
  // não faz sentido o operador trocar. Só mostra título + variáveis.
  const hideTemplateSelect = Boolean(kindFilter && defaultTemplateId)
  // Variáveis "conhecidas" resolvidas pelo backend (clientName, clientDocument,
  // tenantLegalName, today, etc.) — pré-preenche inputs ao escolher template.
  const resolvedVariables = useResolvedContractVariables(clientId, { enabled: open })

  // Estado de sucesso — mostra signUrl após criar.
  const [createdContract, setCreatedContract] = useState<Contract | null>(null)
  // Chave de idempotência: 1 UUID por abertura do sheet. Reenviado em retries
  // (duplo-clique, falha de rede) — backend devolve o contrato existente em
  // vez de criar segundo doc órfão na ZapSign.
  const [idempotencyKey, setIdempotencyKey] = useState<string>('')

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      templateId: defaultTemplateId ?? '',
      title: '',
      expiresInDays: '',
      variables: {},
    },
  })

  const selectedTemplateId = watch('templateId')
  const variables = watch('variables')
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) ?? null,
    [templates, selectedTemplateId],
  )

  // Filtra `missing` pelos campos que de fato impactam o template escolhido.
  // Operador não precisa ver "Endereço do cliente faltando" se o template
  // dele não usa nenhuma `clientAddress*`.
  const relevantMissing = useMemo(() => {
    const all = resolvedVariables.data?.missing ?? []
    if (!selectedTemplate) return []
    const declared = new Set(selectedTemplate.variables)
    return all.filter((m) => m.keys.some((k) => declared.has(k)))
  }, [resolvedVariables.data, selectedTemplate])

  // Partição das vars do template entre "conhecidas pelo catálogo" e
  // "manuais". Sem isso, um template com nomes não-canônicos (ex: `cpf` em
  // vez de `clientDocument`) gera UI silenciosa: sem pre-fill, sem banner
  // — e o operador acha que está bugado. Esse breakdown deixa explícito.
  const { knownInTemplate, unknownInTemplate } = useMemo(() => {
    if (!selectedTemplate) return { knownInTemplate: [], unknownInTemplate: [] }
    const catalog = new Set(resolvedVariables.data?.knownKeys ?? [])
    const known: string[] = []
    const unknown: string[] = []
    for (const v of selectedTemplate.variables) {
      if (catalog.has(v)) known.push(v)
      else unknown.push(v)
    }
    return { knownInTemplate: known, unknownInTemplate: unknown }
  }, [selectedTemplate, resolvedVariables.data])

  // Reset ao abrir/fechar — limpa estado de sucesso e form, e regenera a
  // chave de idempotência. Re-abrir o sheet pro mesmo cliente deve poder
  // criar um segundo contrato (a chave SÓ se repete em retry do mesmo submit).
  useEffect(() => {
    if (open) {
      setCreatedContract(null)
      setIdempotencyKey(crypto.randomUUID())
      reset({
        templateId: defaultTemplateId ?? '',
        title: '',
        expiresInDays: '',
        variables: {},
      })
    }
  }, [open, defaultTemplateId, reset])

  // Quando troca de template (ou quando o resolver termina de carregar),
  // inicializa o map de variáveis pré-preenchendo as chaves conhecidas via
  // catálogo (variableResolvers.ts no backend). Operador edita o que quiser
  // e preenche manualmente o que NÃO é conhecido (procedure, session_count…).
  //
  // Cuidado com `??`: ele só fallback em `null`/`undefined`, NÃO em string
  // vazia. Esse effect roda 2x (template trocado + resolver chega); na 1ª
  // passagem o resolver ainda não chegou e seta tudo como `''`. Se usássemos
  // `current ?? resolved[key]` na 2ª passagem, o `''` venceria o fallback e
  // os campos ficariam vazios pra sempre. Por isso testamos `!= ''`.
  useEffect(() => {
    if (!selectedTemplate) return
    const resolved = resolvedVariables.data?.resolved ?? {}
    const next: Record<string, string> = {}
    for (const key of selectedTemplate.variables) {
      const current = variables?.[key] ?? ''
      next[key] = current !== '' ? current : resolved[key] ?? ''
    }
    setValue('variables', next)
    // Não dependo de `variables` aqui senão entra em loop — só reseta na
    // troca de template ou quando o resolver vier do servidor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate?.id, resolvedVariables.data])

  const onSubmit = handleSubmit(async (data) => {
    if (!selectedTemplate) return
    const input: CreateContractInput = {
      clientId,
      templateId: data.templateId,
      journeyId: journeyId ?? undefined,
      saleId: saleId ?? undefined,
      title: data.title.trim() || undefined,
      variables: Object.entries(data.variables).map(([name, value]) => ({
        name,
        value: (value ?? '').trim(),
      })),
      expiresInDays: data.expiresInDays.trim()
        ? Number(data.expiresInDays.trim())
        : undefined,
      idempotencyKey,
    }

    try {
      const contract = await createContract.mutateAsync(input)
      setCreatedContract(contract)
      toast.success('Contrato criado e enviado pra ZapSign')
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
          <SheetToolbar srTitle="Enviar contrato">
            {createdContract ? (
              <SheetToolbar.Action
                label="Fechar"
                onClick={() => onOpenChange(false)}
              />
            ) : (
              [
                <SheetToolbar.Action
                  key="cancel"
                  label="Cancelar"
                  variant="ghost"
                  onClick={() => onOpenChange(false)}
                />,
                <SheetToolbar.Action
                  key="submit"
                  label={isSubmitting ? 'Enviando…' : 'Enviar'}
                  type="submit"
                  form={FORM_ID}
                  disabled={isSubmitting || !selectedTemplate}
                />,
              ]
            )}
          </SheetToolbar>

          <SheetBody>
            {createdContract ? (
              <SuccessPanel contract={createdContract} />
            ) : (
              <form
                id={FORM_ID}
                onSubmit={onSubmit}
                className="flex flex-col gap-4"
              >
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground">
                Enviando contrato para
              </span>
              <span className="font-medium">{clientName}</span>
            </div>

            <div
              className={cn(
                'flex flex-col gap-1.5',
                hideTemplateSelect && 'hidden',
              )}
            >
              {templatesQuery.isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" />
                  Carregando templates…
                </div>
              ) : templates.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum template cadastrado ainda. Cadastre em
                  Configurações → Templates de contrato.
                </p>
              ) : (
                <SelectField
                  id="contract-template"
                  label="Template"
                  required
                  value={watch('templateId') || undefined}
                  onValueChange={(v) =>
                    setValue('templateId', v, {
                      shouldValidate: true,
                      shouldDirty: true,
                    })
                  }
                  placeholder="Selecione um template…"
                  error={errors.templateId?.message ?? null}
                >
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectField>
              )}
            </div>

            <TextField
              label="Título (opcional)"
              placeholder={selectedTemplate?.name ?? 'Usa o nome do template'}
              {...register('title')}
              error={errors.title?.message}
            />

            <TextField
              label="Validade (dias)"
              placeholder="Sem limite"
              type="number"
              min={1}
              max={365}
              {...register('expiresInDays')}
              error={errors.expiresInDays?.message}
            />

            {selectedTemplate && relevantMissing.length > 0 && (
              <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-soft p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 shrink-0 text-warning" />
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-warning-soft-foreground">
                      Campos pendentes pra esse contrato
                    </p>
                    <p className="text-xs text-muted-foreground">
                      O contrato pode ser enviado assim, mas vai sair com esses
                      campos em branco. Recomenda-se preencher antes:
                    </p>
                  </div>
                </div>
                <ul className="ml-6 list-disc text-xs text-muted-foreground">
                  {relevantMissing.map((m) => {
                    const cadastro =
                      m.source === 'client' ? 'do cliente' : 'da clínica'
                    const tail =
                      m.reason === 'invalid'
                        ? `formato inválido no cadastro ${cadastro}`
                        : `cadastro ${cadastro}`
                    return (
                      <li key={m.label}>
                        <span className="font-medium text-foreground">
                          {m.label}
                        </span>{' '}
                        <span className="text-muted-foreground">— {tail}</span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {selectedTemplate && selectedTemplate.variables.length === 0 && (
              <div className="flex flex-col gap-1 rounded-md border border-info/30 bg-info/10 p-3">
                <p className="text-sm font-medium text-info">
                  Template sem variáveis declaradas
                </p>
                <p className="text-xs text-muted-foreground">
                  Edite o template em Configurações → Templates de contrato e
                  use “Buscar variáveis” pra puxar do ZapSign. Sem isso, o
                  contrato é enviado como está no painel.
                </p>
              </div>
            )}

            {selectedTemplate && selectedTemplate.variables.length > 0 && (
              <div className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-sm font-semibold">Variáveis do template</h3>
                    <p className="text-xs text-muted-foreground">
                      {knownInTemplate.length} preenchida
                      {knownInTemplate.length === 1 ? '' : 's'} pelo cadastro
                      {unknownInTemplate.length > 0 && (
                        <>
                          {', '}
                          {unknownInTemplate.length} manual
                          {unknownInTemplate.length === 1 ? '' : 'is'}
                        </>
                      )}
                      .
                    </p>
                  </div>
                  {resolvedVariables.isLoading && (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="size-3 animate-spin" />
                      Pré-preenchendo…
                    </span>
                  )}
                </div>
                {knownInTemplate.length === 0 && (
                  <p className="rounded border border-warning/40 bg-warning-soft px-2 py-1.5 text-xs text-warning-soft-foreground">
                    Nenhuma variável deste template bate com o catálogo
                    (<code className="text-[10px]">client*</code>,{' '}
                    <code className="text-[10px]">tenant*</code>,{' '}
                    <code className="text-[10px]">today</code>). Vão precisar
                    ser digitadas a cada envio. Considere renomeá-las no
                    painel ZapSign pra ganhar pre-fill automático.
                  </p>
                )}
                {selectedTemplate.variables.map((key) => {
                  const isKnown = resolvedVariables.data?.knownKeys.includes(key)
                  const inputId = `contract-var-${key}`
                  return (
                    <TextField
                      key={key}
                      id={inputId}
                      label={key}
                      type="text"
                      className="font-mono"
                      helperText={
                        isKnown
                          ? 'Preenchida automaticamente a partir de clients/tenants.'
                          : undefined
                      }
                      {...register(`variables.${key}` as const)}
                    />
                  )
                })}
              </div>
            )}
              </form>
            )}
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}

// =====================================================================
// Tela de sucesso — mostra signUrl + ações de copy/abrir.
// Disparo automático via WhatsApp entra na Fase 3.5; por enquanto o
// operador copia o link e envia manualmente pra cliente.
// =====================================================================

function SuccessPanel({ contract }: { contract: Contract }): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    if (!contract.signUrl) return
    try {
      await navigator.clipboard.writeText(contract.signUrl)
      setCopied(true)
      toast.success('Link copiado')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  const { openClientChat, openingFor } = useOpenClientChat()

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-success/30 bg-success/10 p-3">
        <p className="text-sm font-medium text-success">
          Contrato criado com sucesso
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          O documento foi enviado pra ZapSign. Abra a conversa do cliente no
          chat pra mandar o link, ou copie pra enviar por outro canal.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          Link de assinatura
        </span>
        <div className="flex items-center gap-2 rounded-md border border-input bg-background p-2">
          <code className="min-w-0 flex-1 truncate text-xs">
            {contract.signUrl ?? '—'}
          </code>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="default"
          onClick={() =>
            void openClientChat(contract.clientId, contractChatMessage(contract))
          }
          disabled={openingFor === contract.clientId}
          className="w-full"
        >
          <MessageCircle className="mr-2 size-4" />
          Abrir conversa no chat
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={handleCopy}
            disabled={!contract.signUrl}
            className="flex-1"
          >
            {copied ? 'Copiado!' : 'Copiar link'}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              if (contract.signUrl) window.open(contract.signUrl, '_blank')
            }}
            disabled={!contract.signUrl}
            className="flex-1"
          >
            <ExternalLink className="mr-2 size-4" />
            Abrir no navegador
          </Button>
        </div>
      </div>
    </div>
  )
}

function extractErrorMessage(err: unknown): string {
  const msg = apiErrorText(err)
  if (msg) return msg
  if (err instanceof Error) return err.message
  return 'Erro inesperado ao criar contrato'
}
