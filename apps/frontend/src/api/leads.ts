import { coreApi } from '@/api/client'
import type { ClientAddress } from './clients'
import type { JourneySource, LostReason } from './journeys'

// Espelha os tipos do backend
// (apps/core/src/modules/leads/LeadsTypes.ts).
//
// Sub-estágios do funil de lead. Ordem canônica do funil — usada também
// como ordem default de exibição das colunas no board.
export const LEAD_SUBSTAGES = [
  'new',
  'template',
  'contact',
  'scheduled',
  'no_show',
  'rescheduled',
  'quoted',
] as const

export type LeadSubstage = (typeof LEAD_SUBSTAGES)[number]

// Sources permitidos em POST manual (espelha manualLeadSourceValues).
export const MANUAL_LEAD_SOURCES = [
  'manual',
  'form',
  'sheets',
  'imported',
  'other',
] as const

export type ManualLeadSource = (typeof MANUAL_LEAD_SOURCES)[number]

export interface LeadCard {
  id: string
  clientId: string
  clientName: string
  clientPhone: string | null
  substage: LeadSubstage | null
  source: JourneySource
  lastActivityAt: string
  createdAt: string
  conversationId: string | null
  whatsappContactId: string | null
  lastMessagePreview: string | null
  lastMessageDirection: 'inbound' | 'outbound' | 'internal_note' | null
  lastMessageKind:
    | 'text'
    | 'media'
    | 'template'
    | 'system'
    | 'sticker'
    | 'call'
    | null
  lastMessageMediaType:
    | 'image'
    | 'audio'
    | 'video'
    | 'document'
    | 'sticker'
    | null
  nextEvaluationAt: string | null
}

export interface LeadDetail {
  id: string
  tenantId: string
  clientId: string
  clientName: string
  clientPhone: string | null
  clientEmail: string | null
  stage: 'lead'
  substage: LeadSubstage | null
  status: 'active' | 'won' | 'lost'
  source: JourneySource
  sourceMetadata: Record<string, unknown> | null
  lostReason: string | null
  lastActivityAt: string
  closedAt: string | null
  createdAt: string
  updatedAt: string
  conversationId: string | null
  nextEvaluationAt: string | null
  latestQuoteId: string | null
  latestQuoteStatus: string | null
}

export type LeadSortField = 'createdAt' | 'updatedAt' | 'lastActivityAt'

export interface FindLeadsQuery {
  page?: number
  pageSize?: number
  substage?: LeadSubstage
  source?: JourneySource
  ageMinDays?: number
  ageMaxDays?: number
  channelId?: string
  search?: string
  sortBy?: LeadSortField
  sortDir?: 'asc' | 'desc'
}

// Resposta de /leads/board — uma página por substage + totais agregados.
export interface LeadsBoardColumn {
  items: LeadCard[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export type LeadsBoardColumns = Record<LeadSubstage, LeadsBoardColumn>

// Inclui chave 'unset' pra leads sem substage definido (anomalia transitória).
export type LeadsCounts = Record<LeadSubstage | 'unset', number>

export interface LeadsBoardResponse {
  columns: LeadsBoardColumns
  totals: LeadsCounts
}

export interface PaginatedLeads {
  items: LeadCard[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// Cadastro inline — cliente + journey numa só chamada. Source é fixada em
// 'manual' pelo backend; outras origens (form, sheets) terão endpoints
// próprios quando aparecerem. `createWhatsappContact` só deve vir `true`
// depois que /whatsapp/numbers/check confirmou que o número existe.
export interface CreateLeadInput {
  name: string
  phoneE164: string
  email?: string | null
  birthDate?: string | null
  document?: string | null
  address?: ClientAddress | null
  notes?: string | null
  isVip?: boolean
  createWhatsappContact?: boolean
  // Número que o WhatsApp efetivamente reconhece — vem do
  // /whatsapp/numbers/check (resolveNumber). Pode diferir de phoneE164 por
  // causa da quirk BR (celulares com DDD ≥ 31 com conta cadastrada sem o 9).
  // Propagar evita o backend repetir o probe.
  whatsappE164?: string
}

export interface MarkLeadLostInput {
  reason: LostReason
}

export interface UpdateLeadSubstageInput {
  substage: LeadSubstage
}

export async function fetchLeadsBoard(
  query: FindLeadsQuery = {},
): Promise<LeadsBoardResponse> {
  const res = await coreApi.get<LeadsBoardResponse>('/leads/board', {
    params: query,
  })
  return res.data
}

export async function fetchLeadsCounts(
  query: Omit<FindLeadsQuery, 'page' | 'pageSize' | 'substage' | 'sortBy' | 'sortDir'> = {},
): Promise<LeadsCounts> {
  const res = await coreApi.get<LeadsCounts>('/leads/counts', { params: query })
  return res.data
}

export async function fetchLeads(query: FindLeadsQuery = {}): Promise<PaginatedLeads> {
  const res = await coreApi.get<PaginatedLeads>('/leads', { params: query })
  return res.data
}

export async function fetchLeadById(id: string): Promise<LeadDetail> {
  const res = await coreApi.get<LeadDetail>(`/leads/${id}`)
  return res.data
}

export async function createLead(input: CreateLeadInput): Promise<LeadDetail> {
  const res = await coreApi.post<LeadDetail>('/leads', input)
  return res.data
}

export async function updateLeadSubstage(
  id: string,
  input: UpdateLeadSubstageInput,
): Promise<LeadDetail> {
  const res = await coreApi.put<LeadDetail>(`/leads/${id}/substage`, input)
  return res.data
}

export async function recomputeLeadSubstage(id: string): Promise<LeadDetail> {
  const res = await coreApi.post<LeadDetail>(`/leads/${id}/recompute-substage`)
  return res.data
}

export async function markLeadLost(
  id: string,
  input: MarkLeadLostInput,
): Promise<LeadDetail> {
  const res = await coreApi.post<LeadDetail>(`/leads/${id}/mark-lost`, input)
  return res.data
}

export async function recycleLead(previousId: string): Promise<LeadDetail> {
  const res = await coreApi.post<LeadDetail>(`/leads/${previousId}/recycle`)
  return res.data
}
