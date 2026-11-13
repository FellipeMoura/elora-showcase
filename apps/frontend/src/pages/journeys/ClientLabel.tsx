import { useClient } from '@/hooks/useClients'

interface ClientLabelProps {
  clientId: string
  // Quando true, exibe telefone abaixo do nome.
  showPhone?: boolean
}

// Resolve clientId → nome do cliente via useClient. React Query dedupa,
// então N rows do mesmo cliente fazem 1 fetch. Loading state mostra o
// id truncado.
export function ClientLabel({
  clientId,
  showPhone = false,
}: ClientLabelProps): React.ReactElement {
  const { data: client, isLoading } = useClient(clientId)

  if (isLoading || !client) {
    return (
      <span className="font-mono text-xs text-muted-foreground">
        {clientId.slice(0, 8)}…
      </span>
    )
  }

  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-medium">{client.name}</span>
      {showPhone && (
        <span className="text-xs text-muted-foreground">{client.phoneE164}</span>
      )}
    </div>
  )
}
