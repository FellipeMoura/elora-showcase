import { toast } from 'sonner'
import { Ban, Download, ExternalLink, MessageCircle, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useCancelContract, useCopyContractLink } from '@/hooks/useContracts'
import { useOpenClientChat } from '@/hooks/useOpenClientChat'
import {
  CONTRACT_STATUS_COLOR_CLASS,
  CONTRACT_STATUS_LABELS,
  contractSignedPdfUrl,
  type Contract,
  type ContractStatus,
} from '@/api/contracts'
import { displayDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// ContractRow — linha de contrato reutilizada em ClientContractsSection e
// SaleContractsSection (Fase 7). Self-contained: as ações copy-link / cancel /
// download moram aqui pra não duplicar handlers entre as duas seções (regra 13
// do CLAUDE.md — promover composição quando serve a 2+ superfícies).
// =====================================================================

// Status com link de assinatura ativo (botões abrir/copiar).
const LINKABLE: Array<ContractStatus> = ['sent', 'viewed']
// Status que ainda podem ser cancelados.
const CANCELLABLE: Array<ContractStatus> = ['draft', 'sent', 'viewed']

interface ContractRowProps {
  contract: Contract
  // Linha extra opcional abaixo do meta (ex: procedimentos cobertos pelo termo).
  subtitle?: React.ReactNode
}

export function ContractRow({
  contract: c,
  subtitle,
}: ContractRowProps): React.ReactElement {
  const confirm = useConfirm()
  const copyLink = useCopyContractLink()
  const cancel = useCancelContract()
  const { openClientChat, openingFor } = useOpenClientChat()

  const handleCopyLink = async () => {
    try {
      const updated = await copyLink.mutateAsync(c.id)
      if (updated.signUrl) {
        await navigator.clipboard.writeText(updated.signUrl)
        toast.success('Link copiado pra área de transferência')
      } else {
        toast.success('Contrato pronto')
      }
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  const handleCancel = async () => {
    const ok = await confirm({
      title: `Cancelar o contrato "${c.title}"?`,
      confirmLabel: 'Cancelar contrato',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await cancel.mutateAsync(c.id)
      toast.success('Contrato cancelado')
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }


  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded border bg-muted/20 p-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-xs font-medium',
              CONTRACT_STATUS_COLOR_CLASS[c.status],
            )}
          >
            {CONTRACT_STATUS_LABELS[c.status]}
          </span>
          <span className="truncate font-medium">{c.title}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {c.status === 'signed' && c.signedAt
            ? `Assinado em ${displayDateTime(c.signedAt)}`
            : c.sentAt
              ? `Enviado em ${displayDateTime(c.sentAt)}`
              : `Criado em ${displayDateTime(c.createdAt)}`}
          {c.failureReason && (
            <span className="ml-2 text-error">· {c.failureReason}</span>
          )}
        </div>
        {subtitle && (
          <div className="text-xs text-muted-foreground">{subtitle}</div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {c.signUrl && LINKABLE.includes(c.status) && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    void openClientChat(c.clientId, contractChatMessage(c))
                  }
                  disabled={openingFor === c.clientId}
                  aria-label="Abrir conversa no chat"
                >
                  <MessageCircle className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Abrir conversa no chat</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => window.open(c.signUrl as string, '_blank')}
                  aria-label="Abrir link de assinatura"
                >
                  <ExternalLink className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Abrir link de assinatura</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void handleCopyLink()}
                  aria-label="Copiar link de assinatura"
                >
                  <RefreshCcw className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copiar link de assinatura</TooltipContent>
            </Tooltip>
          </>
        )}
        {c.status === 'signed' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => window.open(contractSignedPdfUrl(c.id), '_blank')}
                aria-label="Baixar PDF assinado"
              >
                <Download className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Baixar PDF assinado</TooltipContent>
          </Tooltip>
        )}
        {CANCELLABLE.includes(c.status) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => void handleCancel()}
                aria-label="Cancelar contrato"
                className="text-error hover:text-error"
              >
                <Ban className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Cancelar contrato</TooltipContent>
          </Tooltip>
        )}
      </div>
    </li>
  )
}

// Mensagem pré-preenchida no chat ao abrir a conversa pra enviar o contrato.
// Compartilhada entre ContractRow e o painel de sucesso do ContractSendSheet.
export function contractChatMessage(c: {
  client: { name: string }
  title: string
  signUrl: string | null
}): string {
  return `Olá, ${c.client.name}! Segue o link para assinar o documento "${c.title}": ${c.signUrl ?? ''}`
}

export function extractErrorMessage(err: unknown): string {
  const msg = apiErrorText(err)
  if (msg) return msg
  if (err instanceof Error) return err.message
  return 'Erro inesperado'
}
