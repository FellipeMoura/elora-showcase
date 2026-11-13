import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { FilePlus, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  useContracts,
  useContractTemplates,
  useGenerateConsentTermsForSale,
} from '@/hooks/useContracts'
import type { Contract } from '@/api/contracts'
import { ContractRow, extractErrorMessage } from './ContractRow'
import { ContractSendSheet } from './ContractSendSheet'

// =====================================================================
// Seção "Contratos da venda" do SaleDetailPage (Fase 7). Centraliza a criação
// de contratos a partir da venda — todo contrato nasce com rastro comercial.
// Dois blocos: contrato de serviço (1 ativo por venda) e termos de consentimento
// (1 por template aplicável; gerados em lote via "Gerar termos pendentes").
//
// Atualiza em realtime: `useContracts` compartilha CONTRACTS_QUERY_KEY, que o
// `useChatRealtime` invalida em toda transição de `contract.status_changed`.
// =====================================================================

interface SaleContractsSectionProps {
  saleId: string
  clientId: string
  clientName: string
  journeyId?: string | null
  // Procedimentos da venda (sale_items) — interseção com os procedimentos
  // vinculados a cada template define quais termos a venda exige.
  procedureIds: string[]
}

export function SaleContractsSection({
  saleId,
  clientId,
  clientName,
  journeyId,
  procedureIds,
}: SaleContractsSectionProps): React.ReactElement {
  const [serviceSheetOpen, setServiceSheetOpen] = useState(false)

  const contractsQuery = useContracts({
    saleId,
    pageSize: 50,
    sortBy: 'createdAt',
    sortDir: 'desc',
  })
  // Templates de termo ativos (com procedimentos denormalizados) — pra saber
  // quais termos a venda exige e rotular os procedimentos cobertos.
  const consentTemplatesQuery = useContractTemplates({
    kind: 'consent_term',
    active: true,
    pageSize: 100,
  })
  const generate = useGenerateConsentTermsForSale()

  const contracts: Contract[] = contractsQuery.data?.items ?? []
  const consentTemplates = consentTemplatesQuery.data?.items ?? []

  const serviceContracts = contracts.filter(
    (c) => c.kind === 'service_contract',
  )
  const activeServiceContract = serviceContracts.find(
    (c) => c.status !== 'cancelled',
  )
  const consentContracts = contracts.filter((c) => c.kind === 'consent_term')

  const saleProcSet = useMemo(() => new Set(procedureIds), [procedureIds])

  // Templates de termo que cobrem ao menos 1 procedimento desta venda.
  const applicableTemplates = useMemo(
    () =>
      consentTemplates.filter((t) =>
        (t.procedures ?? []).some((p) => saleProcSet.has(p.id)),
      ),
    [consentTemplates, saleProcSet],
  )

  // Algum template de termo tem procedimento vinculado? Distingue "configure
  // templates" de "esta venda não exige termos" no empty state.
  const anyConsentTemplateLinked = consentTemplates.some(
    (t) => (t.procedures ?? []).length > 0,
  )

  const templateById = useMemo(
    () => new Map(consentTemplates.map((t) => [t.id, t])),
    [consentTemplates],
  )

  // Rótulo dos procedimentos da venda cobertos por um termo (interseção
  // template.procedures ∩ sale.procedureIds).
  const coveredLabel = (c: Contract): string | null => {
    const template = c.templateId ? templateById.get(c.templateId) : null
    const covered = (template?.procedures ?? []).filter((p) =>
      saleProcSet.has(p.id),
    )
    if (covered.length === 0) return null
    return `Cobre: ${covered.map((p) => p.name).join(', ')}`
  }

  const handleGenerate = async () => {
    try {
      const result = await generate.mutateAsync(saleId)
      const created = result.created.length
      const providerErrors = result.skipped.filter(
        (s) => s.reason === 'provider_error',
      )
      if (created > 0) {
        toast.success(
          `${created} termo${created === 1 ? '' : 's'} gerado${created === 1 ? '' : 's'}`,
        )
      }
      if (providerErrors.length > 0) {
        toast.error(
          `${providerErrors.length} termo${providerErrors.length === 1 ? '' : 's'} falhou no provedor — tente novamente`,
        )
      }
      if (created === 0 && providerErrors.length === 0) {
        toast.info('Nenhum termo pendente — todos já gerados')
      }
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-md border bg-background p-4">
      <h2 className="text-sm font-semibold">Contratos da venda</h2>

      {contractsQuery.isError && (
        <p className="text-sm text-error">Erro ao carregar contratos.</p>
      )}

      {/* ---- Contrato de serviço (1 ativo por venda) ---- */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            Contrato de serviço
          </h3>
          {!activeServiceContract && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setServiceSheetOpen(true)}
            >
              <FilePlus className="mr-1 size-4" />
              Criar contrato de serviço
            </Button>
          )}
        </div>
        {serviceContracts.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {serviceContracts.map((c) => (
              <ContractRow key={c.id} contract={c} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            Nenhum contrato de serviço para esta venda ainda.
          </p>
        )}
      </div>

      {/* ---- Termos de consentimento ---- */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            Termos de consentimento
          </h3>
          {applicableTemplates.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleGenerate()}
              disabled={generate.isPending}
            >
              {generate.isPending ? (
                <Loader2 className="mr-1 size-4 animate-spin" />
              ) : (
                <Sparkles className="mr-1 size-4" />
              )}
              Gerar termos pendentes
            </Button>
          )}
        </div>

        {consentContracts.length > 0 && (
          <ul className="flex flex-col gap-2">
            {consentContracts.map((c) => (
              <ContractRow
                key={c.id}
                contract={c}
                subtitle={coveredLabel(c)}
              />
            ))}
          </ul>
        )}

        {consentContracts.length === 0 &&
          (applicableTemplates.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Esta venda tem termos a gerar. Clique em “Gerar termos pendentes”.
            </p>
          ) : !anyConsentTemplateLinked ? (
            <p className="text-sm text-muted-foreground">
              Nenhum procedimento tem termo de consentimento configurado. Vincule
              em{' '}
              <Link
                to="/settings/contract-templates"
                className="text-primary hover:underline"
              >
                Configurações → Templates de contrato
              </Link>
              .
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Os procedimentos desta venda não exigem termo de consentimento.
            </p>
          ))}
      </div>

      <ContractSendSheet
        open={serviceSheetOpen}
        onOpenChange={setServiceSheetOpen}
        clientId={clientId}
        clientName={clientName}
        journeyId={journeyId}
        saleId={saleId}
        kindFilter="service_contract"
      />
    </section>
  )
}
