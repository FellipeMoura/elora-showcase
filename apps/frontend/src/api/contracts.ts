import { coreApi } from '@/api/client'

// =====================================================================
// Contract Templates — apontamento pra template no painel ZapSign.
// =====================================================================

export type ContractKind =
  | 'consent_term'
  | 'service_contract'
  | 'image_release'
  | 'other'

export const CONTRACT_KIND_LABELS: Record<ContractKind, string> = {
  consent_term: 'Termo de consentimento',
  service_contract: 'Contrato de serviço',
  image_release: 'Uso de imagem',
  other: 'Outro',
}

// Procedimento vinculado a um template de termo de consentimento (Fase 7).
export interface TemplateProcedure {
  id: string
  name: string
}

export interface ContractTemplate {
  id: string
  tenantId: string
  name: string
  kind: ContractKind
  zapsignTemplateId: string
  variables: string[]
  active: boolean
  createdAt: string
  updatedAt: string
  // Presente só em templates `consent_term` — procedimentos vinculados (Fase 7).
  procedures?: TemplateProcedure[]
}

export interface CreateContractTemplateInput {
  name: string
  kind?: ContractKind
  zapsignTemplateId: string
  variables?: string[]
}

export interface UpdateContractTemplateInput {
  name?: string
  kind?: ContractKind
  zapsignTemplateId?: string
  variables?: string[]
  active?: boolean
}

export interface FindContractTemplatesQuery {
  page?: number
  pageSize?: number
  q?: string
  kind?: ContractKind
  active?: boolean
  sortBy?: 'name' | 'kind' | 'createdAt' | 'updatedAt'
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedContractTemplates {
  items: ContractTemplate[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function fetchContractTemplates(
  query: FindContractTemplatesQuery = {},
): Promise<PaginatedContractTemplates> {
  const res = await coreApi.get<PaginatedContractTemplates>(
    '/contract-templates',
    { params: query },
  )
  return res.data
}

export async function fetchContractTemplateById(
  id: string,
): Promise<ContractTemplate> {
  const res = await coreApi.get<ContractTemplate>(`/contract-templates/${id}`)
  return res.data
}

export async function createContractTemplate(
  input: CreateContractTemplateInput,
): Promise<ContractTemplate> {
  const res = await coreApi.post<ContractTemplate>('/contract-templates', input)
  return res.data
}

export async function updateContractTemplate(
  id: string,
  input: UpdateContractTemplateInput,
): Promise<ContractTemplate> {
  const res = await coreApi.patch<ContractTemplate>(
    `/contract-templates/${id}`,
    input,
  )
  return res.data
}

export async function deleteContractTemplate(id: string): Promise<void> {
  await coreApi.delete(`/contract-templates/${id}`)
}

// =====================================================================
// ZapSign inspector — usado no form de cadastro de template pra (1) linkar
// pro painel ZapSign e (2) puxar nome+variáveis a partir de um template ID.
// =====================================================================

export interface ZapsignPanelInfo {
  panelUrl: string
  isSandbox: boolean
  configured: boolean
}

export interface ZapsignTemplateInfo {
  name: string | null
  variables: string[]
}

export interface ZapsignTemplateSummary {
  externalTemplateId: string
  name: string
}

export async function fetchZapsignPanelInfo(): Promise<ZapsignPanelInfo> {
  const res = await coreApi.get<ZapsignPanelInfo>(
    '/contract-templates/zapsign/panel-info',
  )
  return res.data
}

export async function fetchZapsignTemplatesList(): Promise<
  ZapsignTemplateSummary[]
> {
  const res = await coreApi.get<ZapsignTemplateSummary[]>(
    '/contract-templates/zapsign/templates',
  )
  return res.data
}

export async function inspectZapsignTemplate(
  zapsignTemplateId: string,
): Promise<ZapsignTemplateInfo> {
  const res = await coreApi.get<ZapsignTemplateInfo>(
    `/contract-templates/zapsign/templates/${encodeURIComponent(zapsignTemplateId)}`,
  )
  return res.data
}

// =====================================================================
// Vínculo template × procedimento (Fase 7). Os três endpoints de mutação
// devolvem a lista atualizada de procedimentos vinculados.
// =====================================================================

export async function fetchTemplateProcedures(
  templateId: string,
): Promise<TemplateProcedure[]> {
  const res = await coreApi.get<TemplateProcedure[]>(
    `/contract-templates/${templateId}/procedures`,
  )
  return res.data
}

export async function linkTemplateToProcedure(
  templateId: string,
  procedureId: string,
): Promise<TemplateProcedure[]> {
  const res = await coreApi.post<TemplateProcedure[]>(
    `/contract-templates/${templateId}/procedures`,
    { procedureId },
  )
  return res.data
}

export async function unlinkTemplateFromProcedure(
  templateId: string,
  procedureId: string,
): Promise<TemplateProcedure[]> {
  const res = await coreApi.delete<TemplateProcedure[]>(
    `/contract-templates/${templateId}/procedures/${procedureId}`,
  )
  return res.data
}

// =====================================================================
// Contracts — instância enviada pra assinatura.
// =====================================================================

export type ContractStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'signed'
  | 'declined'
  | 'expired'
  | 'cancelled'

export const CONTRACT_STATUS_LABELS: Record<ContractStatus, string> = {
  draft: 'Rascunho',
  sent: 'Enviado',
  viewed: 'Visualizado',
  signed: 'Assinado',
  declined: 'Recusado',
  expired: 'Expirado',
  cancelled: 'Cancelado',
}

// Map pros 8 tokens semânticos do design system (sem inventar paleta nova).
export const CONTRACT_STATUS_COLOR_CLASS: Record<ContractStatus, string> = {
  draft: 'bg-secondary/20 text-secondary',
  sent: 'bg-info/15 text-info',
  viewed: 'bg-primary/15 text-primary',
  signed: 'bg-success/15 text-success',
  declined: 'bg-error/15 text-error',
  expired: 'bg-warning/15 text-warning',
  cancelled: 'bg-secondary/20 text-secondary',
}

export interface ContractVariable {
  name: string
  value: string
}

export interface Contract {
  id: string
  tenantId: string
  clientId: string
  journeyId: string | null
  // Vínculo com a venda (Fase 7). Null em contratos avulsos antigos.
  saleId: string | null
  templateId: string | null
  variables: ContractVariable[]
  kind: ContractKind
  title: string
  status: ContractStatus
  zapsignDocumentId: string | null
  zapsignOpenId: string | null
  signUrl: string | null
  signedPdfObjectKey: string | null
  sentAt: string | null
  viewedAt: string | null
  signedAt: string | null
  declinedAt: string | null
  expiresAt: string | null
  failureReason: string | null
  createdByUserId: string | null
  idempotencyKey: string | null
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  client: {
    id: string
    name: string
    phoneE164: string
  }
  template: {
    id: string
    name: string
    kind: ContractKind
  } | null
}

export interface CreateContractInput {
  clientId: string
  templateId: string
  journeyId?: string | null
  // Vínculo com a venda (Fase 7). Presente, os uniques parciais de venda valem.
  saleId?: string | null
  title?: string
  variables: ContractVariable[]
  expiresInDays?: number
  // UUID gerado pelo frontend ao abrir o sheet. Reenvie o MESMO em retries —
  // backend devolve o contrato já criado em vez de criar outro (evita doc
  // órfão na ZapSign em double-submit).
  idempotencyKey?: string
}

export type ContractSortField =
  | 'createdAt'
  | 'updatedAt'
  | 'sentAt'
  | 'signedAt'
  | 'title'
  | 'status'

export interface FindContractsQuery {
  page?: number
  pageSize?: number
  clientId?: string
  journeyId?: string
  saleId?: string
  status?: ContractStatus
  kind?: ContractKind
  pendingOnly?: boolean
  sortBy?: ContractSortField
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedContracts {
  items: Contract[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export async function fetchContracts(
  query: FindContractsQuery = {},
): Promise<PaginatedContracts> {
  const res = await coreApi.get<PaginatedContracts>('/contracts', {
    params: query,
  })
  return res.data
}

export async function fetchContractById(id: string): Promise<Contract> {
  const res = await coreApi.get<Contract>(`/contracts/${id}`)
  return res.data
}

export async function createContract(
  input: CreateContractInput,
): Promise<Contract> {
  const res = await coreApi.post<Contract>('/contracts', input)
  return res.data
}

// Não dispara nada — só devolve o contract pra UI extrair signUrl e copiar.
// Endpoint nasceu como `resend` mas é só "give me the link" hoje; vira disparo
// de fato quando a Fase 3.5 do WhatsApp entrar.
export async function copyContractLink(id: string): Promise<Contract> {
  const res = await coreApi.post<Contract>(`/contracts/${id}/copy-link`)
  return res.data
}

export async function cancelContract(id: string): Promise<Contract> {
  const res = await coreApi.delete<Contract>(`/contracts/${id}`)
  return res.data
}

// =====================================================================
// Bulk de termos de consentimento por venda (Fase 7).
// =====================================================================

export type SkippedConsentTermReason = 'already_active' | 'provider_error'

export interface SkippedConsentTerm {
  templateId: string
  templateName: string
  reason: SkippedConsentTermReason
}

export interface GenerateConsentTermsResult {
  created: Contract[]
  skipped: SkippedConsentTerm[]
}

// Gera os termos de consentimento pendentes da venda. Idempotente: chamar 2x é
// seguro (termos já ativos são pulados sem custo). Erro de provider num template
// não aborta os outros — `created` parcial + `skipped` com o motivo.
export async function generateConsentTermsForSale(
  saleId: string,
): Promise<GenerateConsentTermsResult> {
  const res = await coreApi.post<GenerateConsentTermsResult>(
    `/sales/${saleId}/contracts/consent-terms`,
  )
  return res.data
}

// URL absoluta pra abrir/baixar o PDF assinado. Endpoint retorna binary
// — o browser baixa direto via window.open / link <a download>.
export function contractSignedPdfUrl(id: string): string {
  const base = coreApi.defaults.baseURL?.replace(/\/+$/, '') ?? ''
  return `${base}/contracts/${id}/signed-pdf`
}

// =====================================================================
// Catálogo + resolver de variáveis — usado pra pré-preencher inputs do
// ContractSendSheet a partir de clients/tenants, e pra marcar variáveis
// "conhecidas" no ContractTemplateSheet.
// =====================================================================

export type ContractVariableSource = 'client' | 'tenant' | 'system'

// `empty`  = cadastro vazio.
// `invalid` = cadastro tem valor mas formatter rejeitou (ex: CPF com 5 dígitos).
export type ContractMissingReason = 'empty' | 'invalid'

export interface MissingContractVariableField {
  // Chaves do catálogo que compartilham o mesmo label (ex: clientDocument
  // e clientDocumentRaw apontam pra mesma coluna `clients.document`).
  keys: string[]
  source: ContractVariableSource
  label: string
  reason: ContractMissingReason
}

export interface ResolveContractVariablesResult {
  resolved: Record<string, string>
  knownKeys: string[]
  missing: MissingContractVariableField[]
}

export async function fetchContractVariablesCatalog(): Promise<string[]> {
  const res = await coreApi.get<string[]>('/contracts/variables/catalog')
  return res.data
}

export async function fetchResolvedContractVariables(
  clientId: string,
): Promise<ResolveContractVariablesResult> {
  const res = await coreApi.get<ResolveContractVariablesResult>(
    '/contracts/variables/resolve',
    { params: { clientId } },
  )
  return res.data
}
