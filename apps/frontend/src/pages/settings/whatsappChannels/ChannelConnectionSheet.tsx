import { useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { CheckCircle2, Loader2, QrCode, RefreshCw, WifiOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  useChannelConnectionState,
  useChannelQrCode,
  useProvisionWhatsappChannel,
} from '@/hooks/useWhatsappChannels'
import {
  isChannelMock,
  isChannelProvisioned,
  type ConnectionStateName,
  type WhatsappChannel,
} from '@/api/whatsappChannels'
import { apiErrorText } from '@/lib/apiError'

interface ChannelConnectionSheetProps {
  open: boolean
  channel: WhatsappChannel | null
  onOpenChange: (open: boolean) => void
}

// Sheet de pareamento — gerencia 3 estados visíveis ao admin:
// 1. Não provisionado → botão "Provisionar instância"
// 2. Provisionado e pareando → mostra QR + state (poll ativo)
// 3. Conectado → checkmark + atalho pra recarregar QR se desconectar
export function ChannelConnectionSheet({
  open,
  channel,
  onOpenChange,
}: ChannelConnectionSheetProps): React.ReactElement {
  const provisionMutation = useProvisionWhatsappChannel()

  const channelId = channel?.id
  const isMock = channel ? isChannelMock(channel) : false
  const isProvisioned = channel ? isChannelProvisioned(channel) : false

  // Polling ativo só quando: sheet aberta + canal provisionado e não-mock.
  // (Mock channel não tem instância Evolution real — não faz sentido pedir QR.)
  const pollingEnabled = open && isProvisioned && !isMock

  const stateQuery = useChannelConnectionState(channelId, {
    enabled: pollingEnabled,
  })
  const connectionState: ConnectionStateName =
    stateQuery.data?.state ?? 'unknown'
  const isConnected = connectionState === 'open'

  // QR não precisa ser refetched quando já conectou — economiza requests.
  const qrEnabled = pollingEnabled && !isConnected
  const qrQuery = useChannelQrCode(channelId, { enabled: qrEnabled })

  // Notifica sucesso uma única vez quando estado muda pra 'open'. Usa o
  // próprio queryKey como dep — refetches sem mudança de state não disparam.
  useEffect(() => {
    if (connectionState === 'open' && open) {
      toast.success('WhatsApp conectado!', { id: `channel-open-${channelId}` })
    }
  }, [connectionState, open, channelId])

  const handleProvision = async () => {
    if (!channel) return
    try {
      await provisionMutation.mutateAsync(channel.id)
      toast.success('Instância provisionada. Pegue o QR e escaneie.')
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response
        ?.status
      const message = apiErrorText(err)
      if (status === 409) {
        toast.error(
          message ?? 'Canal não pode ser provisionado (já existe ou é mock).',
        )
      } else {
        toast.error(message ?? 'Erro ao provisionar instância. Veja os logs.')
      }
    }
  }

  // Pega o data URL do QR. Backend pode mandar com ou sem prefixo
  // `data:image/png;base64,` — normalizamos pra UI ser estável.
  const qrSrc = useMemo(() => {
    const raw = qrQuery.data?.base64
    if (!raw) return null
    return raw.startsWith('data:') ? raw : `data:image/png;base64,${raw}`
  }, [qrQuery.data?.base64])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-lg"
      >
        <SheetContainer>
          <SheetToolbar
            srTitle={channel?.name ? `Conectar — ${channel.name}` : 'Conectar canal'}
          />

          <SheetBody>
            {isMock ? (
              <MockChannelInfo />
            ) : !isProvisioned ? (
              <NotProvisionedView
                isLoading={provisionMutation.isPending}
                onProvision={handleProvision}
              />
            ) : isConnected ? (
              <ConnectedView
                phoneNumber={channel?.phoneNumber ?? null}
                onRefreshQr={() => qrQuery.refetch()}
              />
            ) : (
              <PairingView
                qrSrc={qrSrc}
                pairingCode={qrQuery.data?.pairingCode}
                connectionState={connectionState}
                isLoadingQr={qrQuery.isLoading}
                isErrorQr={qrQuery.isError}
                onRefreshQr={() => qrQuery.refetch()}
              />
            )}
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}

function MockChannelInfo(): React.ReactElement {
  return (
    <div className="rounded-md border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
      Canais Mock não precisam de pareamento. Use-os pra exercitar webhook
      inbound e outbound em dev. Connection-state sempre retorna{' '}
      <code className="font-mono">open</code>.
    </div>
  )
}

interface NotProvisionedViewProps {
  isLoading: boolean
  onProvision: () => void
}

function NotProvisionedView({
  isLoading,
  onProvision,
}: NotProvisionedViewProps): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-card p-4 text-sm">
        <p className="font-medium">Instância Evolution ainda não foi criada.</p>
        <p className="mt-1 text-muted-foreground">
          Clicar em "Provisionar" cria a instância no Evolution e configura o
          webhook pro chat receber as mensagens. Depois disso, o QR fica
          disponível pra pareamento.
        </p>
      </div>

      <Button
        onClick={onProvision}
        disabled={isLoading}
        className="w-full"
      >
        {isLoading ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Provisionando…
          </>
        ) : (
          'Provisionar instância'
        )}
      </Button>
    </div>
  )
}

interface PairingViewProps {
  qrSrc: string | null
  pairingCode?: string
  connectionState: ConnectionStateName
  isLoadingQr: boolean
  isErrorQr: boolean
  onRefreshQr: () => void
}

function PairingView({
  qrSrc,
  pairingCode,
  connectionState,
  isLoadingQr,
  isErrorQr,
  onRefreshQr,
}: PairingViewProps): React.ReactElement {
  return (
    <div className="space-y-4">
      <StateBadge state={connectionState} />

      <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-card p-6">
        {isLoadingQr ? (
          <div className="flex h-64 w-64 items-center justify-center text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
          </div>
        ) : isErrorQr ? (
          <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 text-sm text-error">
            <WifiOff className="size-6" />
            <p>Falha ao buscar QR.</p>
          </div>
        ) : qrSrc ? (
          <img
            src={qrSrc}
            alt="QR code pra parear WhatsApp"
            className="h-64 w-64 rounded bg-white p-2"
          />
        ) : (
          <div className="flex h-64 w-64 flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
            <QrCode className="size-6" />
            <p>Aguardando QR do Evolution…</p>
          </div>
        )}

        {pairingCode && (
          <div className="text-center text-sm">
            <p className="text-muted-foreground">Ou use o código:</p>
            <p className="mt-1 font-mono text-base font-semibold tracking-widest">
              {pairingCode}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Como parear</p>
        <ol className="list-decimal space-y-1 pl-4">
          <li>Abre o WhatsApp no celular do número que vai operar.</li>
          <li>
            Menu (três pontos) → <strong>Aparelhos conectados</strong> →{' '}
            <strong>Conectar um aparelho</strong>.
          </li>
          <li>Escaneie o QR acima. O estado muda pra "Conectado" em segundos.</li>
        </ol>
      </div>

      <Button
        variant="outline"
        onClick={onRefreshQr}
        className="w-full"
        disabled={isLoadingQr}
      >
        <RefreshCw className="size-4" />
        Forçar novo QR
      </Button>
    </div>
  )
}

interface ConnectedViewProps {
  phoneNumber: string | null
  onRefreshQr: () => void
}

function ConnectedView({
  phoneNumber,
  onRefreshQr,
}: ConnectedViewProps): React.ReactElement {
  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2 rounded-md border border-success/40 bg-success/10 p-6 text-center">
        <CheckCircle2 className="size-10 text-success" />
        <p className="text-base font-medium">WhatsApp conectado</p>
        {phoneNumber && (
          <p className="font-mono text-sm text-muted-foreground">
            {phoneNumber}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">
          Mensagens já estão sincronizando. Você pode fechar esta janela.
        </p>
      </div>

      <Button
        variant="outline"
        onClick={onRefreshQr}
        className="w-full"
      >
        <RefreshCw className="size-4" />
        Recarregar QR (se precisar reparear)
      </Button>
    </div>
  )
}

function StateBadge({
  state,
}: {
  state: ConnectionStateName
}): React.ReactElement {
  const { label, className } = (() => {
    switch (state) {
      case 'open':
        return {
          label: 'Conectado',
          className: 'bg-success/15 text-success',
        }
      case 'connecting':
        return {
          label: 'Conectando…',
          className: 'bg-warning/15 text-warning',
        }
      case 'closed':
        return {
          label: 'Aguardando pareamento',
          className: 'bg-muted text-muted-foreground',
        }
      default:
        return {
          label: 'Estado desconhecido',
          className: 'bg-muted text-muted-foreground',
        }
    }
  })()

  return (
    <div className="flex items-center justify-between rounded-md border border-border bg-card p-3 text-sm">
      <span className="text-muted-foreground">Estado da sessão</span>
      <span
        className={
          'rounded px-2 py-1 text-xs font-medium ' + className
        }
      >
        {label}
      </span>
    </div>
  )
}
