import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Loader2,
  MessageCircle,
} from 'lucide-react'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useGenerateAttendanceLink } from '@/hooks/useSessionAttendance'
import { useOpenClientChat } from '@/hooks/useOpenClientChat'
import type { SessionAttendanceLink } from '@/api/sessionAttendances'
import type { Appointment } from '@/api/appointments'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// Sheet de presença assinada — gerada quando o operador clica
// "Marcar presença" no popover de um agendamento kind=procedure.
//
// Fluxo:
//   1. Abre → mutation `useGenerateAttendanceLink` dispara
//      POST /appointments/:id/attendance/link.
//   2. Backend resolve TODAS as sessões pending do cliente no dia e
//      retorna { token, signUrl, coveredSessions[], reused }.
//   3. Sheet exibe a lista de procedimentos cobertos pela mesma
//      assinatura + ações: abrir no chat, copiar link, abrir local.
//
// Espelha o padrão visual do ContractSendSheet (SuccessPanel).
// =====================================================================

interface SessionAttendanceSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointment: Appointment | null
  clientName: string | undefined
}

function buildChatMessage(
  clientName: string | undefined,
  link: SessionAttendanceLink,
): string {
  const greeting = clientName
    ? `Olá, ${clientName.split(' ')[0]}!`
    : 'Olá!'
  const count = link.coveredSessions.length
  const sessoes = count === 1 ? 'sessão de hoje' : `${count} sessões de hoje`
  return `${greeting} Pra confirmar sua presença na ${sessoes}, abre esse link e siga as instruções: ${link.signUrl}`
}

export function SessionAttendanceSheet({
  open,
  onOpenChange,
  appointment,
  clientName,
}: SessionAttendanceSheetProps): React.ReactElement {
  const generateMut = useGenerateAttendanceLink()
  const [link, setLink] = useState<SessionAttendanceLink | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !appointment) {
      setLink(null)
      setError(null)
      return
    }
    let cancelled = false
    setLink(null)
    setError(null)
    generateMut
      .mutateAsync(appointment.id)
      .then((result) => {
        if (!cancelled) setLink(result)
      })
      .catch((err) => {
        if (cancelled) return
        const message =
          apiErrorText(err) ?? 'Falha ao gerar link de presença'
        setError(message)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, appointment?.id])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle="Marcar presença">
            <SheetToolbar.Action
              label="Fechar"
              onClick={() => onOpenChange(false)}
            />
          </SheetToolbar>

          <SheetBody>
            {generateMut.isPending && !link && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Gerando link de presença…
              </div>
            )}
            {error && !link && (
              <div className="flex flex-col gap-2 rounded-md border border-error/40 bg-error-soft p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="size-4 shrink-0 text-error" />
                  <div className="flex flex-col gap-1">
                    <p className="text-sm font-medium text-error-soft-foreground">
                      Não foi possível gerar o link
                    </p>
                    <p className="text-xs text-muted-foreground">{error}</p>
                  </div>
                </div>
              </div>
            )}
            {link && appointment && (
              <SuccessPanel
                link={link}
                clientId={appointment.clientId}
                clientName={clientName}
              />
            )}
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}

interface SuccessPanelProps {
  link: SessionAttendanceLink
  clientId: string
  clientName: string | undefined
}

function SuccessPanel({
  link,
  clientId,
  clientName,
}: SuccessPanelProps): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const { openClientChat, openingFor } = useOpenClientChat()

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(link.signUrl)
      setCopied(true)
      toast.success('Link copiado')
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Não foi possível copiar')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-success/30 bg-success/10 p-3">
        <p className="text-sm font-medium text-success">
          {link.reused ? 'Link reutilizado' : 'Link gerado'}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {link.reused
            ? 'Já existe um link ativo para essa data. Envie ou abra abaixo.'
            : 'Envie o link pelo chat ou abra no navegador da clínica (ex: tablet).'}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">
          Sessões cobertas por essa assinatura
        </span>
        <ul className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3">
          {link.coveredSessions.map((s) => {
            const time = new Date(s.scheduledAt).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })
            return (
              <li key={s.id} className="flex items-center gap-2 text-sm">
                <Check className="size-4 shrink-0 text-success" />
                <span className="font-medium">{s.procedureName}</span>
                <span className="text-xs text-muted-foreground">
                  às {time}
                  {s.professionalName ? ` · ${s.professionalName}` : ''}
                </span>
              </li>
            )
          })}
        </ul>
        {link.coveredSessions.length > 1 && (
          <p className="text-[11px] text-muted-foreground">
            Se outra sessão for agendada para esse dia depois, será preciso
            gerar um novo link para incluí-la.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Link de presença</span>
        <div className="flex items-center gap-2 rounded-md border border-input bg-background p-2">
          <code className="min-w-0 flex-1 truncate text-xs">{link.signUrl}</code>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="default"
          disabled={openingFor === clientId}
          onClick={() =>
            void openClientChat(clientId, buildChatMessage(clientName, link))
          }
          className="w-full"
        >
          <MessageCircle className="mr-2 size-4" />
          Abrir conversa no chat
        </Button>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={handleCopy}
            className="flex-1"
          >
            {copied ? 'Copiado!' : 'Copiar link'}
          </Button>
          <Button
            variant="outline"
            onClick={() => window.open(link.signUrl, '_blank')}
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
