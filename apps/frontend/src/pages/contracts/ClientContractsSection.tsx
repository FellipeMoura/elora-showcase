import { useContracts } from '@/hooks/useContracts'
import type { Contract } from '@/api/contracts'
import { ContractRow } from './ContractRow'

// =====================================================================
// Seção "Contratos" do detalhe do cliente. View-only desde a Fase 7: a
// CRIAÇÃO de contratos foi centralizada na tela da venda (SaleContractsSection)
// pra todo contrato nascer com rastro comercial. Aqui só listamos o histórico
// do cliente — ações sobre contratos existentes (copiar link, cancelar, baixar)
// continuam, via ContractRow.
//
// Mora fora do ClientDetailPage porque essa página já passou de 1100 linhas.
// Atualiza em realtime: `useContracts` compartilha CONTRACTS_QUERY_KEY, que o
// `useChatRealtime` invalida em toda transição de `contract.status_changed`.
// =====================================================================

interface ClientContractsSectionProps {
  clientId: string
}

export function ClientContractsSection({
  clientId,
}: ClientContractsSectionProps): React.ReactElement {
  // Ordenado por mais recente primeiro — operadora foca no que acabou de mexer.
  const { data, isLoading, isError } = useContracts({
    clientId,
    pageSize: 50,
    sortBy: 'createdAt',
    sortDir: 'desc',
  })

  const items: Contract[] = data?.items ?? []

  return (
    <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Contratos</h2>
      </header>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {isError && (
        <p className="text-sm text-error">Erro ao carregar contratos.</p>
      )}
      {!isLoading && items.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nenhum contrato pra este cliente. Contratos são criados pela tela da
          venda.
        </p>
      )}

      {items.length > 0 && (
        <ul className="flex flex-col gap-2">
          {items.map((c) => (
            <ContractRow key={c.id} contract={c} />
          ))}
        </ul>
      )}
    </section>
  )
}
