import {
  isChannelMock,
  isChannelProvisioned,
  type WhatsappChannel,
} from '@/api/whatsappChannels'

// Badges compartilhados entre WhatsappChannelsPage (lista) e
// WhatsappChannelDetailPage. Tokens semânticos do design system
// (info/success/warning/error/tertiary/muted) — sem cores hardcoded.

export function ColorSwatch({
  color,
  size = 'sm',
}: {
  color: string | null
  size?: 'sm' | 'md'
}): React.ReactElement {
  const dim = size === 'md' ? 'size-5' : 'size-3'
  if (!color) {
    return (
      <span
        aria-hidden
        className={
          dim + ' shrink-0 rounded-full border border-border bg-muted'
        }
      />
    )
  }
  return (
    <span
      aria-hidden
      className={dim + ' shrink-0 rounded-full border border-border'}
      style={{ backgroundColor: color }}
      title={color}
    />
  )
}

export function ProviderBadge({
  channel,
}: {
  channel: WhatsappChannel
}): React.ReactElement {
  if (isChannelMock(channel)) {
    return (
      <span className="rounded bg-tertiary px-1.5 py-0.5 text-xs font-medium text-tertiary-foreground">
        Mock
      </span>
    )
  }
  const label = channel.providerType === 'baileys' ? 'Baileys' : 'Meta Cloud'
  return (
    <span className="rounded bg-info/15 px-1.5 py-0.5 text-xs font-medium text-info">
      {label}
    </span>
  )
}

export function ProvisionBadge({
  channel,
}: {
  channel: WhatsappChannel
}): React.ReactElement {
  if (isChannelMock(channel)) {
    return (
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
        n/a
      </span>
    )
  }
  if (isChannelProvisioned(channel)) {
    return (
      <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
        Provisionado
      </span>
    )
  }
  return (
    <span className="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning">
      Não provisionado
    </span>
  )
}

export function ActiveBadge({
  active,
}: {
  active: boolean
}): React.ReactElement {
  return active ? (
    <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
      Ativo
    </span>
  ) : (
    <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
      Inativo
    </span>
  )
}

// Estado do socket WhatsApp ↔ Evolution. Atualiza em tempo real via socket
// (pipeline normaliza CONNECTION_UPDATE → publica no Redis → core repassa
// → useChatRealtime invalida a query). Mock channels não pareiam, então
// não recebem evento — exibimos "n/a".
export function ConnectionBadge({
  channel,
}: {
  channel: WhatsappChannel
}): React.ReactElement {
  if (isChannelMock(channel)) {
    return (
      <span
        className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground"
        title="Canal mock não tem socket real"
      >
        n/a
      </span>
    )
  }
  const state = channel.connectionState
  if (state === 'open') {
    return (
      <span className="rounded bg-success/15 px-1.5 py-0.5 text-xs font-medium text-success">
        Conectado
      </span>
    )
  }
  if (state === 'connecting') {
    return (
      <span className="rounded bg-warning/15 px-1.5 py-0.5 text-xs font-medium text-warning">
        Conectando…
      </span>
    )
  }
  if (state === 'closed') {
    return (
      <span className="rounded bg-error/15 px-1.5 py-0.5 text-xs font-medium text-error">
        Desconectado
      </span>
    )
  }
  // state === 'unknown' OU null (canal nunca recebeu CONNECTION_UPDATE —
  // recém-provisionado, ou criado antes da feature). Visual neutro pra
  // não alarmar; quando o primeiro evento chegar, o badge se ajusta.
  return (
    <span
      className="rounded bg-tertiary px-1.5 py-0.5 text-xs font-medium text-tertiary-foreground"
      title="Aguardando primeiro evento de conexão do Evolution"
    >
      Aguardando
    </span>
  )
}
