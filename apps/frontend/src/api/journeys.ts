import { coreApi } from '@/api/client'

export const JOURNEY_STAGES = [
  'lead',
  'evaluation',
  'sale',
  'treatment',
  'result',
] as const
export type JourneyStage = (typeof JOURNEY_STAGES)[number]

export const JOURNEY_STATUSES = ['active', 'won', 'lost'] as const
export type JourneyStatus = (typeof JOURNEY_STATUSES)[number]

export const JOURNEY_SOURCES = [
  'whatsapp',
  'form',
  'sheets',
  'manual',
  'recycling',
  'imported',
  'other',
] as const
export type JourneySource = (typeof JOURNEY_SOURCES)[number]

export const MANUAL_JOURNEY_SOURCES = [
  'manual',
  'form',
  'sheets',
  'imported',
  'other',
] as const
export type ManualJourneySource = (typeof MANUAL_JOURNEY_SOURCES)[number]

export const LOST_REASONS = [
  'no_show',
  'price',
  'disqualified',
  'timeout',
  'quote_rejected',
  'quote_expired',
  'other',
] as const
export type LostReason = (typeof LOST_REASONS)[number]

export interface Journey {
  id: string
  tenantId: string
  clientId: string
  stage: JourneyStage
  source: JourneySource
  sourceMetadata: Record<string, unknown> | null
  status: JourneyStatus
  lostReason: string | null
  lastActivityAt: string
  closedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface JourneyEvent {
  id: string
  tenantId: string
  journeyId: string
  eventType: string
  payload: Record<string, unknown> | null
  actorUserId: string | null
  createdAt: string
}

export type JourneySortField =
  | 'createdAt'
  | 'updatedAt'
  | 'lastActivityAt'
  | 'stage'
  | 'status'

export interface FindJourneysQuery {
  page?: number
  pageSize?: number
  stage?: JourneyStage
  status?: JourneyStatus | 'all'
  source?: JourneySource
  clientId?: string
  sortBy?: JourneySortField
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedJourneys {
  items: Journey[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface PaginatedJourneyEvents {
  items: JourneyEvent[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface CreateJourneyInput {
  clientId: string
  source?: ManualJourneySource
  sourceMetadata?: Record<string, unknown>
}

export interface MarkLostInput {
  reason: LostReason
}

export async function fetchJourneys(
  query: FindJourneysQuery = {},
): Promise<PaginatedJourneys> {
  const res = await coreApi.get<PaginatedJourneys>('/journeys', { params: query })
  return res.data
}

export async function fetchJourneyById(id: string): Promise<Journey> {
  const res = await coreApi.get<Journey>(`/journeys/${id}`)
  return res.data
}

export async function fetchJourneyEvents(
  journeyId: string,
  query: { page?: number; pageSize?: number; eventType?: string } = {},
): Promise<PaginatedJourneyEvents> {
  const res = await coreApi.get<PaginatedJourneyEvents>(
    `/journeys/${journeyId}/events`,
    { params: query },
  )
  return res.data
}

export async function createJourney(input: CreateJourneyInput): Promise<Journey> {
  const res = await coreApi.post<Journey>('/journeys', input)
  return res.data
}

export async function markJourneyWon(id: string): Promise<Journey> {
  const res = await coreApi.post<Journey>(`/journeys/${id}/won`)
  return res.data
}

export async function markJourneyLost(
  id: string,
  input: MarkLostInput,
): Promise<Journey> {
  const res = await coreApi.post<Journey>(`/journeys/${id}/lost`, input)
  return res.data
}
