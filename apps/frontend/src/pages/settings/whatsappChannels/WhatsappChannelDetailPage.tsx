import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Ban, Pencil, Plug, Trash2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import {
  useActivateWhatsappChannel,
  useDeactivateWhatsappChannel,
  usePurgeWhatsappChannelConversations,
  useWhatsappChannel,
} from '@/hooks/useWhatsappChannels'
import {
  isChannelMock,
  isChannelProvisioned,
  type WhatsappChannel,
} from '@/api/whatsappChannels'
import {
  displayDateTime,
  displayPhone,
  displayRelativeTime,
} from '@/lib/format'
import { ChannelConnectionSheet } from './ChannelConnectionSheet'
import { WhatsappChannelFormSheet } from './WhatsappChannelFormSheet'
import {
  ActiveBadge,
  ColorSwatch,
  ConnectionBadge,
  ProviderBadge,
  ProvisionBadge,
} from './whatsappChannelBadges'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// Detalhe do canal — concentra as ações que antes estavam na row da lista
// (editar, gerenciar conexão, ativar/desativar). Mesmo pattern do
// ClientDetailPage: lista navega pra cá, ações vivem na toolbar.
// =====================================================================

export function WhatsappChannelDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()

  const channel = useWhatsappChannel(id)
  const deactivate = useDeactivateWhatsappChannel()
  const activate = useActivateWhatsappChannel()
  const purge = usePurgeWhatsappChannelConversations()

  const [editOpen, setEditOpen] = useState(false)
  const [connectionOpen, setConnectionOpen] = useState(false)

  // Auto-abre o sheet de conexão quando o canal está provisionável mas
  // ainda não foi provisionado — caso de uso primário: usuário acabou
  // de criar o canal e foi navegado pra cá. Ref keyed por id pra abrir
  // uma única vez por canal (se o user fechar sem provisionar, não
  // reabrimos no próximo refetch).
  const autoOpenedForId = useRef<string | null>(null)
  useEffect(() => {
    const c = channel.data
    if (!c) return
    if (autoOpenedForId.current === c.id) return
    autoOpenedForId.current = c.id
    if (!isChannelMock(c) && !isChannelProvisioned(c)) {
      setConnectionOpen(true)
    }
  }, [channel.data])

  const handleToggleActive = async (): Promise<void> => {
    if (!channel.data) return
    const c = channel.data
    const ok = await confirm(
      c.active
        ? {
            title: `Desativar ${c.name}?`,
            description:
              'O canal para de receber/enviar mensagens, mas a configuração é preservada.',
            confirmLabel: 'Desativar',
            variant: 'destructive',
          }
        : {
            title: `Reativar ${c.name}?`,
            confirmLabel: 'Reativar',
          },
    )
    if (!ok) return
    try {
      if (c.active) {
        await deactivate.mutateAsync(c.id)
        toast.success('Canal desativado')
      } else {
        await activate.mutateAsync(c.id)
        toast.success('Canal reativado')
      }
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao alterar status do canal')
    }
  }

  // Apaga conversas, mensagens e contatos do canal (o canal e a conexão
  // ficam). Pensado pra resetar o tenant demo. Clientes e journeys criados
  // pelo WhatsApp continuam no cadastro.
  const handlePurgeConversations = async (): Promise<void> => {
    if (!channel.data) return
    const c = channel.data
    const ok = await confirm({
      title: `Excluir conversas de ${c.name}?`,
      description:
        'Todas as conversas, mensagens e contatos deste canal serão apagados permanentemente. ' +
        'O canal, a conexão com o WhatsApp e os clientes cadastrados continuam. Essa ação não pode ser desfeita.',
      confirmLabel: 'Excluir conversas',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      const result = await purge.mutateAsync(c.id)
      toast.success(
        `${result.conversations} ${result.conversations === 1 ? 'conversa' : 'conversas'}, ` +
          `${result.messages} ${result.messages === 1 ? 'mensagem' : 'mensagens'} e ` +
          `${result.contacts} ${result.contacts === 1 ? 'contato' : 'contatos'} excluídos`,
      )
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao excluir conversas do canal')
    }
  }

  if (channel.isLoading || !id) {
    return (
      <PageContainer>
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Carregando canal…
        </div>
      </PageContainer>
    )
  }

  if (channel.isError || !channel.data) {
    return (
      <PageContainer>
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>Erro ao carregar canal.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('/settings/whatsapp-channels')}
          >
            Voltar
          </Button>
        </div>
      </PageContainer>
    )
  }

  const c = channel.data
  const isMock = isChannelMock(c)
  const isProvisioned = isChannelProvisioned(c)

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Action
          icon={<ArrowLeft />}
          onClick={() => navigate('/settings/whatsapp-channels')}
          variant="ghost"
          aria-label="Voltar"
        />
        <PageToolbar.Action
          label="Editar"
          icon={<Pencil />}
          onClick={() => setEditOpen(true)}
          variant="outline"
        />
        {!isMock && (
          <PageToolbar.Action
            label={isProvisioned ? 'Gerenciar conexão' : 'Conectar'}
            icon={<Plug />}
            onClick={() => setConnectionOpen(true)}
            variant="outline"
          />
        )}
        <PageToolbar.Action
          label={c.active ? 'Desativar' : 'Reativar'}
          icon={c.active ? <Ban /> : <Undo2 />}
          onClick={handleToggleActive}
          variant="outline"
          disabled={deactivate.isPending || activate.isPending}
        />
        <PageToolbar.Action
          label="Excluir conversas"
          icon={<Trash2 />}
          onClick={handlePurgeConversations}
          variant="outline"
          disabled={purge.isPending}
        />
      </PageToolbar>

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        <ChannelInfoSection channel={c} />
        <ConnectionDetailsSection
          channel={c}
          onOpenConnect={() => setConnectionOpen(true)}
        />
      </div>

      <WhatsappChannelFormSheet
        open={editOpen}
        channel={c}
        onOpenChange={setEditOpen}
      />
      <ChannelConnectionSheet
        open={connectionOpen}
        channel={c}
        onOpenChange={setConnectionOpen}
      />
    </PageContainer>
  )
}

// =====================================================================
// Section: Informações do canal — dados básicos + badges contextuais.
// =====================================================================

function ChannelInfoSection({
  channel,
}: {
  channel: WhatsappChannel
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
      <header className="flex flex-wrap items-center gap-2">
        <ColorSwatch color={channel.color} size="md" />
        <h1 className="truncate text-lg font-semibold">{channel.name}</h1>
        <ActiveBadge active={channel.active} />
        <ProviderBadge channel={channel} />
        <ProvisionBadge channel={channel} />
        <ConnectionBadge channel={channel} />
      </header>

      <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <InfoField
          label="Telefone"
          value={channel.phoneNumber ? displayPhone(channel.phoneNumber) : null}
        />
        <InfoField
          label="Cor"
          value={channel.color}
          mono={Boolean(channel.color)}
        />
        <InfoField
          label="Cadastrado em"
          value={displayRelativeTime(channel.createdAt)}
        />
        <InfoField
          label="Última atualização"
          value={displayRelativeTime(channel.updatedAt)}
        />
      </dl>
    </section>
  )
}

function InfoField({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null | undefined
  mono?: boolean
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          mono
            ? 'font-mono text-sm text-foreground'
            : 'text-sm text-foreground'
        }
      >
        {value && value.trim().length > 0 ? (
          value
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </dd>
    </div>
  )
}

// =====================================================================
// Section: Conexão — estado atual + timestamp + atalho pra abrir o sheet
// de pareamento. Em canal Mock não há socket real, mostra explicação.
// Em canal não-provisionado, CTA pra provisionar leva pro sheet também.
// =====================================================================

function ConnectionDetailsSection({
  channel,
  onOpenConnect,
}: {
  channel: WhatsappChannel
  onOpenConnect: () => void
}): React.ReactElement {
  const isMock = isChannelMock(channel)
  const isProvisioned = isChannelProvisioned(channel)

  // Mostra o nome da instância Evolution quando disponível — útil pra debug
  // (admin consegue cruzar com o painel do Evolution). API key e webhook
  // token NÃO entram aqui — não exibir segredos em UI mesmo pra admin.
  const instanceName =
    typeof channel.providerConfig.instanceName === 'string'
      ? channel.providerConfig.instanceName
      : null
  const baseUrl =
    typeof channel.providerConfig.baseUrl === 'string'
      ? channel.providerConfig.baseUrl
      : null

  return (
    <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Conexão</h2>
        {!isMock && (
          <Button variant="outline" size="sm" onClick={onOpenConnect}>
            <Plug className="mr-1 size-4" />
            {isProvisioned ? 'Gerenciar conexão' : 'Conectar'}
          </Button>
        )}
      </header>

      {isMock ? (
        <p className="text-sm text-muted-foreground">
          Canal Mock — não há sessão WhatsApp real. Usado pra exercitar fluxo
          de inbound/outbound em dev.
        </p>
      ) : !isProvisioned ? (
        <p className="text-sm text-muted-foreground">
          Instância Evolution ainda não foi criada. Use "Conectar" pra
          provisionar e parear pela primeira vez.
        </p>
      ) : (
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <InfoField
            label="Última atualização do estado"
            value={
              channel.connectionStateAt
                ? displayDateTime(channel.connectionStateAt)
                : null
            }
          />
          <InfoField label="Instância" value={instanceName} mono />
          <InfoField label="Base URL" value={baseUrl} mono />
          <InfoField
            label="Tipo de provider"
            value={
              channel.providerType === 'baileys' ? 'Baileys' : 'Meta Cloud'
            }
          />
        </dl>
      )}
    </section>
  )
}
