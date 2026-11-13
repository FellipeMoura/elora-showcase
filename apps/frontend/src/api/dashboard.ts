import { coreApi } from '@/api/client'
import type { Period } from '@/hooks/usePeriodFilter'

// Espelha o contrato de apps/core/src/modules/dashboard/DashboardTypes.ts
// (GET /dashboard/summary). Resposta única com todos os blocos A–E. Nesta
// fase só o bloco A (cards) vem preenchido; B/C/D/E retornam estruturas
// vazias (granularity de E já vem calculada). Ver docs/dashboard-domain.md.

// Alias mantido por compat com módulos que importam DashboardPeriod.
// Tipo canônico vive em `@/hooks/usePeriodFilter` (`Period`).
export type DashboardPeriod = Period

export type DashboardGranularity = 'daily' | 'weekly' | 'monthly' | 'quarterly'

export interface DashboardSummaryQuery {
  period: DashboardPeriod
  from?: string
  to?: string
}

interface CardDelta {
  deltaPct: number | null
}

export interface DashboardCards {
  salesAmount: { value: number; count: number } & CardDelta
  receivedAmount: { value: number } & CardDelta
  todayAppointments: {
    total: number
    breakdown: {
      attended: number
      noShow: number
      scheduled: number
      cancelled: number
      confirmed: number
    }
  }
  newLeads: { count: number } & CardDelta
  leadToSaleRate: { value: number } & CardDelta
  averageTicket: { value: number } & CardDelta
  sparklines: {
    salesAmount: number[]
    receivedAmount: number[]
    newLeads: number[]
    averageTicket: number[]
  }
}

export interface DashboardFunnel {
  stages: Array<{ id: string; label: string; value: number }>
  transitionsTimeAvgDays: {
    leadToEvaluation: number | null
    evaluationToQuote: number | null
    quoteToSale: number | null
  }
}

export interface DashboardEvolution {
  granularity: DashboardGranularity
  buckets: Array<{
    bucketStart: string
    bucketLabel: string
    leadsCount: number
    salesCount: number
    salesAmount: number
  }>
  derived: {
    averageTicket: number
    leadToSaleRate: number
    leadToSaleCycleDays: number | null
  }
}

export interface DashboardDistribution {
  revenueByDay: Array<{ date: string; amount: number }>
  leadsBySource: Array<{ source: string; count: number }>
  lostReasons: Array<{ reason: string; count: number }>
  paymentMethods: Array<{ method: string; amount: number; count: number }>
  leadSubstages: Array<{ substage: string; count: number }>
}

export interface DashboardOperational {
  upcomingPayments: Array<{
    id: string
    saleId: string
    clientName: string
    amount: number
    dueDate: string
    installment: string
    isOverdue: boolean
  }>
  upcomingEvaluations: Array<{
    id: string
    clientName: string
    scheduledAt: string
    professional: string | null
  }>
  unansweredConversations: Array<{
    conversationId: string
    clientName: string
    lastInboundAt: string
    preview: string
  }>
}

export interface DashboardSummary {
  period: {
    from: string
    to: string
    comparePrevFrom: string
    comparePrevTo: string
  }
  cards: DashboardCards
  funnel: DashboardFunnel
  evolution: DashboardEvolution
  distribution: DashboardDistribution
  operational: DashboardOperational
}

export async function fetchDashboardSummary(
  query: DashboardSummaryQuery,
): Promise<DashboardSummary> {
  const res = await coreApi.get<DashboardSummary>('/dashboard/summary', {
    params: query,
  })
  return res.data
}
