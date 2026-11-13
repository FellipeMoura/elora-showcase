import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cancelContract,
  copyContractLink,
  createContract,
  createContractTemplate,
  deleteContractTemplate,
  fetchContractById,
  fetchContracts,
  fetchContractTemplateById,
  fetchContractTemplates,
  fetchContractVariablesCatalog,
  fetchResolvedContractVariables,
  fetchTemplateProcedures,
  fetchZapsignPanelInfo,
  fetchZapsignTemplatesList,
  generateConsentTermsForSale,
  linkTemplateToProcedure,
  unlinkTemplateFromProcedure,
  updateContractTemplate,
  type Contract,
  type ContractTemplate,
  type CreateContractInput,
  type CreateContractTemplateInput,
  type FindContractsQuery,
  type FindContractTemplatesQuery,
  type GenerateConsentTermsResult,
  type PaginatedContracts,
  type PaginatedContractTemplates,
  type ResolveContractVariablesResult,
  type TemplateProcedure,
  type UpdateContractTemplateInput,
  type ZapsignPanelInfo,
  type ZapsignTemplateSummary,
} from '@/api/contracts'

// =====================================================================
// Contract Templates
// =====================================================================

export const CONTRACT_TEMPLATES_QUERY_KEY = ['contract-templates'] as const

export function contractTemplatesListKey(query: FindContractTemplatesQuery) {
  return [...CONTRACT_TEMPLATES_QUERY_KEY, 'list', query] as const
}

export function contractTemplateByIdKey(id: string) {
  return [...CONTRACT_TEMPLATES_QUERY_KEY, 'detail', id] as const
}

export function useContractTemplates(query: FindContractTemplatesQuery = {}) {
  return useQuery<PaginatedContractTemplates, Error>({
    queryKey: contractTemplatesListKey(query),
    queryFn: () => fetchContractTemplates(query),
    placeholderData: (prev) => prev,
    staleTime: 60 * 1000,
  })
}

export function useContractTemplate(id: string | undefined) {
  return useQuery<ContractTemplate, Error>({
    queryKey: contractTemplateByIdKey(id ?? ''),
    queryFn: () => fetchContractTemplateById(id as string),
    enabled: Boolean(id),
  })
}

export function useCreateContractTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateContractTemplateInput) =>
      createContractTemplate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTRACT_TEMPLATES_QUERY_KEY })
    },
  })
}

export function useUpdateContractTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string
      input: UpdateContractTemplateInput
    }) => updateContractTemplate(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTRACT_TEMPLATES_QUERY_KEY })
    },
  })
}

export function useDeleteContractTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteContractTemplate(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTRACT_TEMPLATES_QUERY_KEY })
    },
  })
}

// ----- Vínculo template × procedimento (Fase 7) -----
// As mutações invalidam a lista de templates pra refrescar o `procedures`
// denormalizado (subtabela em Settings) sem fetch dedicado.

export function useTemplateProcedures(
  templateId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  return useQuery<TemplateProcedure[], Error>({
    queryKey: [...CONTRACT_TEMPLATES_QUERY_KEY, 'procedures', templateId ?? ''],
    queryFn: () => fetchTemplateProcedures(templateId as string),
    enabled: Boolean(templateId) && (options.enabled ?? true),
  })
}

export function useLinkTemplateToProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      templateId,
      procedureId,
    }: {
      templateId: string
      procedureId: string
    }) => linkTemplateToProcedure(templateId, procedureId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTRACT_TEMPLATES_QUERY_KEY })
    },
  })
}

export function useUnlinkTemplateFromProcedure() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      templateId,
      procedureId,
    }: {
      templateId: string
      procedureId: string
    }) => unlinkTemplateFromProcedure(templateId, procedureId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTRACT_TEMPLATES_QUERY_KEY })
    },
  })
}

// ZapSign panel info é estável durante a sessão (depende só de env do
// backend) — staleTime infinito evita refetch a cada abertura do form.
export function useZapsignPanelInfo() {
  return useQuery<ZapsignPanelInfo, Error>({
    queryKey: [...CONTRACT_TEMPLATES_QUERY_KEY, 'zapsign-panel-info'],
    queryFn: fetchZapsignPanelInfo,
    staleTime: Infinity,
  })
}

// Lista de templates da ZapSign — refetch a cada 5min (admin pode criar
// template novo no painel sem o front saber). `enabled` permite o caller
// pular fetch quando o sheet está fechado ou ZapSign não está provisionado.
export function useZapsignTemplatesList(options: { enabled?: boolean } = {}) {
  return useQuery<ZapsignTemplateSummary[], Error>({
    queryKey: [...CONTRACT_TEMPLATES_QUERY_KEY, 'zapsign-templates-list'],
    queryFn: fetchZapsignTemplatesList,
    enabled: options.enabled ?? true,
    staleTime: 5 * 60 * 1000,
  })
}

// Catálogo estático de chaves conhecidas — staleTime infinito (depende só
// do código do backend, não muda na sessão).
export function useContractVariablesCatalog(options: { enabled?: boolean } = {}) {
  return useQuery<string[], Error>({
    queryKey: [...CONTRACT_TEMPLATES_QUERY_KEY, 'variables-catalog'],
    queryFn: fetchContractVariablesCatalog,
    enabled: options.enabled ?? true,
    staleTime: Infinity,
  })
}

// =====================================================================
// Contracts
// =====================================================================

export const CONTRACTS_QUERY_KEY = ['contracts'] as const

// Resolver de variáveis pra um cliente — refetched ao trocar de cliente.
// `enabled` permite o caller pular fetch quando o sheet está fechado.
export function useResolvedContractVariables(
  clientId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  return useQuery<ResolveContractVariablesResult, Error>({
    queryKey: [...CONTRACTS_QUERY_KEY, 'variables-resolve', clientId ?? ''],
    queryFn: () => fetchResolvedContractVariables(clientId as string),
    enabled: Boolean(clientId) && (options.enabled ?? true),
    staleTime: 60 * 1000,
  })
}

export function contractsListKey(query: FindContractsQuery) {
  return [...CONTRACTS_QUERY_KEY, 'list', query] as const
}

export function contractByIdKey(id: string) {
  return [...CONTRACTS_QUERY_KEY, 'detail', id] as const
}

export function useContracts(query: FindContractsQuery = {}) {
  return useQuery<PaginatedContracts, Error>({
    queryKey: contractsListKey(query),
    queryFn: () => fetchContracts(query),
    placeholderData: (prev) => prev,
    staleTime: 30 * 1000,
  })
}

export function useContract(id: string | undefined) {
  return useQuery<Contract, Error>({
    queryKey: contractByIdKey(id ?? ''),
    queryFn: () => fetchContractById(id as string),
    enabled: Boolean(id),
  })
}

export function useCreateContract() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateContractInput) => createContract(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTRACTS_QUERY_KEY })
    },
  })
}

export function useCopyContractLink() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => copyContractLink(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: CONTRACTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: contractByIdKey(id) })
    },
  })
}

export function useCancelContract() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => cancelContract(id),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: CONTRACTS_QUERY_KEY })
      queryClient.invalidateQueries({ queryKey: contractByIdKey(id) })
    },
  })
}

// Bulk de termos de consentimento pendentes da venda (Fase 7). Invalida a lista
// de contratos pra a SaleContractsSection refrescar com os termos criados.
export function useGenerateConsentTermsForSale() {
  const queryClient = useQueryClient()
  return useMutation<GenerateConsentTermsResult, Error, string>({
    mutationFn: (saleId: string) => generateConsentTermsForSale(saleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CONTRACTS_QUERY_KEY })
    },
  })
}
