import { AlertCircle, FileText, Loader2, Send, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  extractTemplateVariables,
  renderTemplateBody,
  type MessageTemplate,
} from '@/api/messageTemplates'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useConfirm } from '@/components/ui/confirm-context'
import { useConversation } from '@/hooks/useConversations'
import { useSendMessage } from '@/hooks/useConversationMessages'
import { useMessageTemplates } from '@/hooks/useMessageTemplates'
import {
  useUpdateWhatsappContact,
  useWhatsappContact,
} from '@/hooks/useWhatsappContacts'
import { cn } from '@/lib/utils'
import { apiErrorText } from '@/lib/apiError'

interface TemplateComposerProps {
  conversationId: string
}

// Composer alternativo que substitui o MessageComposer quando a conversa
// está fora da janela de 24h do WhatsApp (sem inbound recente).
//
// Regra do WhatsApp (arquitetura.md §7.3 + chat-domain.md §9): só template
// aprovado dispara mensagem fora da janela, E o backend exige opt-in
// registrado (`whatsapp_contacts.opted_in_at`) antes de qualquer outbound.
//
// UX:
//   1. Banner explica por que não dá pra mandar texto livre
//   2. Se o contato não tem opt-in, banner extra com "Registrar opt-in"
//      manual (backend grava optInSource='manual'). Sem esse passo o envio
//      vira 403 — antecipamos pra evitar erro mascarado.
//   3. Select de templates ativos + inputs dinâmicos pra `{{var}}` + preview
//   4. Send dispara POST /messages com kind='template'
export function TemplateComposer({
  conversationId,
}: TemplateComposerProps): React.ReactElement {
  const { data: conversation } = useConversation(conversationId)
  const { data: templatesPage, isLoading, isError } = useMessageTemplates({
    status: 'active',
    pageSize: 100,
  })
  const { data: contact, isLoading: contactLoading } = useWhatsappContact(
    conversation?.whatsappContactId ?? null,
  )
  const updateContactMutation = useUpdateWhatsappContact()
  const confirm = useConfirm()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [variableValues, setVariableValues] = useState<Record<string, string>>(
    {},
  )
  const sendMutation = useSendMessage(conversationId)

  const templates = templatesPage?.items ?? []
  const selected: MessageTemplate | null = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId],
  )

  const variables = useMemo(
    () => (selected ? extractTemplateVariables(selected.body) : []),
    [selected],
  )

  const preview = useMemo(
    () => (selected ? renderTemplateBody(selected.body, variableValues) : ''),
    [selected, variableValues],
  )

  // Pré-condições pra liberar o botão de envio:
  //   - contato carregado E com opt-in registrado
  //   - template escolhido
  //   - todas as variáveis preenchidas (evita `{{nome}}` cru chegando)
  const hasOptIn = Boolean(contact?.optedInAt)
  // Quando a conversation não tem whatsappContactId (caso raro — conv
  // criada manualmente sem inbound prévio), não dá pra registrar opt-in
  // nem mandar mensagem. UI mostra banner explicativo.
  const missingContact = !conversation?.whatsappContactId
  const missingVariables = variables.filter((v) => !variableValues[v]?.trim())
  const canSend =
    Boolean(selected) &&
    missingVariables.length === 0 &&
    hasOptIn &&
    !sendMutation.isPending

  const handleSelect = (id: string): void => {
    setSelectedId(id)
    // Reset valores ao trocar de template — variáveis novas podem ter
    // nomes diferentes e manter valores antigos confunde o usuário.
    setVariableValues({})
  }

  const handleRegisterOptIn = async (): Promise<void> => {
    if (!contact) return
    const ok = await confirm({
      title: 'Registrar opt-in manual?',
      description:
        'Confirme apenas se o cliente autorizou o contato por WhatsApp ' +
        '(formulário assinado, autorização verbal, etc.). O consentimento ' +
        'fica registrado com origem "manual" pra auditoria.',
      confirmLabel: 'Registrar opt-in',
    })
    if (!ok) return

    try {
      await updateContactMutation.mutateAsync({
        id: contact.id,
        input: {
          optedInAt: new Date().toISOString(),
          optInSource: 'manual',
        },
      })
      toast.success('Opt-in registrado')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao registrar opt-in')
    }
  }

  const handleSend = (): void => {
    if (!selected || !canSend) return
    sendMutation.mutate(
      {
        kind: 'template',
        templateId: selected.id,
        templateVariables: variableValues,
      },
      {
        onSuccess: () => {
          setSelectedId(null)
          setVariableValues({})
        },
        onError: (err) => {
          const response = (err as { response?: { status?: number; data?: { message?: string } } })
            ?.response
          const status = response?.status
          const message = apiErrorText(err)
          if (!response) {
            toast.error('Sem conexão com o servidor. Verifique sua internet.')
          } else if (status === 401) {
            toast.error('Sessão expirada. Faça login novamente.')
            // Fallback pro 403 de opt-in caso o contato perca o opt-in entre
            // o load e o submit (race raro). Mensagem é específica.
          } else if (status === 403 && message?.includes('opt-in')) {
            toast.error('Opt-in não registrado — clique em "Registrar opt-in" e tente de novo.')
          } else if (status === 403) {
            toast.error(message ?? 'Sem permissão pra enviar este template')
          } else if (status === 409) {
            toast.error(message ?? 'Template desativado ou estado inválido')
          } else if (status === 429) {
            toast.error(message ?? 'Limite de envios atingido. Aguarde um instante.')
          } else if (status && status >= 500) {
            toast.error('Servidor indisponível. Tente novamente em instantes.')
          } else {
            toast.error(message ?? 'Erro ao enviar template. Tente novamente.')
          }
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-2 p-2">
      <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" />
        <div>
          <div className="font-medium text-warning">
            Janela de 24h fechada
          </div>
          <div className="text-muted-foreground">
            O cliente não enviou mensagem nas últimas 24h. Use um template
            aprovado pra retomar a conversa.
          </div>
        </div>
      </div>

      {missingContact && (
        <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
          Esta conversa não tem contato WhatsApp vinculado. Vincule um contato
          antes de enviar templates.
        </div>
      )}

      {!missingContact && !contactLoading && contact && !hasOptIn && (
        <div className="flex flex-col gap-2 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs">
          <div className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-error" />
            <div className="flex-1">
              <div className="font-medium text-error">
                Opt-in não registrado
              </div>
              <div className="text-muted-foreground">
                Política do WhatsApp: precisa do consentimento explícito do
                cliente antes do envio. Registre o opt-in manualmente se o
                cliente já autorizou.
              </div>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleRegisterOptIn}
            disabled={updateContactMutation.isPending}
            className="self-end"
          >
            {updateContactMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
            Registrar opt-in
          </Button>
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
          Erro ao carregar templates. Tente recarregar a página.
        </div>
      )}

      <Select
        value={selectedId ?? ''}
        onValueChange={handleSelect}
        disabled={isLoading || templates.length === 0}
      >
        <SelectTrigger className="text-sm">
          <SelectValue
            placeholder={
              isLoading
                ? 'Carregando templates…'
                : templates.length === 0
                  ? 'Nenhum template ativo'
                  : 'Selecionar template…'
            }
          />
        </SelectTrigger>
        <SelectContent>
          {templates.map((t) => (
            <SelectItem key={t.id} value={t.id}>
              <span className="flex items-center gap-2">
                <FileText className="size-3.5 text-muted-foreground" />
                {t.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selected && (
        <>
          {variables.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {variables.map((name) => (
                <label key={name} className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted-foreground">
                    {name}
                    <span className="ml-1 text-error">*</span>
                  </span>
                  <input
                    type="text"
                    value={variableValues[name] ?? ''}
                    onChange={(e) =>
                      setVariableValues((prev) => ({
                        ...prev,
                        [name]: e.target.value,
                      }))
                    }
                    placeholder={`Valor para {{${name}}}`}
                    className={cn(
                      'h-9 rounded-md border border-input bg-background px-3 text-sm',
                      'focus:outline-none focus:ring-2 focus:ring-ring',
                    )}
                  />
                </label>
              ))}
            </div>
          )}

          <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm whitespace-pre-wrap break-words">
            {preview || (
              <span className="text-muted-foreground">
                Sem corpo de mensagem.
              </span>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              disabled={!canSend}
              onClick={handleSend}
              aria-label="Enviar template"
              title={
                !hasOptIn
                  ? 'Registre o opt-in antes de enviar'
                  : missingVariables.length > 0
                    ? 'Preencha todas as variáveis'
                    : undefined
              }
            >
              <Send className="size-4" />
              {sendMutation.isPending ? 'Enviando…' : 'Enviar template'}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
