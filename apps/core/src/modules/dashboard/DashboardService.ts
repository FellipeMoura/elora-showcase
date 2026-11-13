import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import {
  DashboardQuery,
  durationDaysOf,
  resolveComparePrevRange,
  resolveGranularity,
  resolvePeriodRange,
} from './DashboardQuery.js';
import type {
  DashboardGranularity,
  DashboardPeriod,
  DashboardSummary,
} from './DashboardTypes.js';

const MONTHS_PT = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
];

// Rótulo do eixo X do bloco E a partir do início do bucket (YYYY-MM-DD) e da
// granularidade: mensal 'Mai/26', trimestral 'T2/26', semanal/diário '15 Mai'
// (dia de início do bucket). Curto pra caber no eixo sem girar.
function formatBucketLabel(iso: string, g: DashboardGranularity): string {
  const [y, m, d] = iso.split('-').map(Number);
  const yy = String(y).slice(-2);
  const mon = MONTHS_PT[(m ?? 1) - 1] ?? '';
  switch (g) {
    case 'monthly':
      return `${mon}/${yy}`;
    case 'quarterly':
      return `T${Math.floor(((m ?? 1) - 1) / 3) + 1}/${yy}`;
    case 'weekly':
    case 'daily':
    default:
      return `${d} ${mon}`;
  }
}

// Variação % vs período anterior. null quando a base é 0 (não calculável).
// Arredondado a 1 casa.
function deltaPct(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// Converte média de dias (texto do Postgres, ou null) pra number arredondado.
function avgDays(v: string | null): number | null {
  return v == null ? null : round1(Number(v));
}

// Taxa de conversão 0..100 (won / closed). 0 quando não houve fechamento.
function rate(won: number, closed: number): number {
  if (closed === 0) return 0;
  return round1((won / closed) * 100);
}

export const DashboardService = {
  // Orquestra todas as queries do dashboard num único `withTenant` (RLS).
  // PR 1: bloco A (cards + deltas + sparklines) preenchido; B/C/D/E vazios
  // pra o contrato já existir por completo.
  //
  // Queries rodam serializadas: a transação do Drizzle usa 1 conexão e
  // paralelizar (`Promise.all`) quebra o protocolo do pg. Custo aceitável
  // pro V1 — bench de performance fica pro PR 8 (ver implementation.md).
  runSummary: async (
    tenantId: string,
    period: DashboardPeriod,
    fromIso?: string,
    toIso?: string,
  ): Promise<DashboardSummary> => {
    const range = resolvePeriodRange(period, fromIso, toIso);
    const prev = resolveComparePrevRange(range);
    const granularity = resolveGranularity(durationDaysOf(range));

    const blockA = await withTenant(db, tenantId, async (tx) => {
      const sales = await DashboardQuery.salesAggregate(tx, range, prev);
      const received = await DashboardQuery.receivedAggregate(tx, range, prev);
      const leads = await DashboardQuery.newLeadsAggregate(tx, range, prev);
      const conv = await DashboardQuery.leadToSaleAggregate(tx, range, prev);
      const today = await DashboardQuery.todayAppointments(tx);

      const sparkSales = await DashboardQuery.salesAmountSparkline(tx, range);
      const sparkReceived = await DashboardQuery.receivedAmountSparkline(tx, range);
      const sparkLeads = await DashboardQuery.newLeadsSparkline(tx, range);
      const sparkTicket = await DashboardQuery.averageTicketSparkline(tx, range);

      // Buckets do range (granularidade adaptativa). Servem ao bloco E (que
      // vira empty state no front quando granularity='daily') E ao C1 (receita
      // diária) — por isso sempre computamos, mesmo em ranges curtos.
      const cycleDays = await DashboardQuery.leadToSaleCycleDays(tx, range);
      const buckets = await DashboardQuery.evolutionBuckets(tx, range, granularity);

      // Bloco B (funil). Etapas 1/5 reusam leads/sales; 2/3/4 e tempos novos.
      const funnelCounts = await DashboardQuery.funnelStageCounts(tx, range);
      const funnelTransitions = await DashboardQuery.funnelTransitions(tx, range);

      // Bloco C (distribuição). C1 reusa `buckets`; demais são queries próprias.
      const leadsBySource = await DashboardQuery.leadsBySource(tx, range);
      const lostReasons = await DashboardQuery.lostReasons(tx, range);
      const paymentMethods = await DashboardQuery.paymentMethods(tx, range);
      const leadSubstages = await DashboardQuery.leadSubstages(tx);

      // Bloco D (operacional). Semântica fixa — ignora o filtro de período.
      const upcomingPayments =
        await DashboardQuery.operationalUpcomingPayments(tx);
      const upcomingEvaluations =
        await DashboardQuery.operationalUpcomingEvaluations(tx);
      const unansweredConversations =
        await DashboardQuery.operationalUnansweredConversations(tx);

      return {
        sales,
        received,
        leads,
        conv,
        today,
        cycleDays,
        buckets,
        funnelCounts,
        funnelTransitions,
        leadsBySource,
        lostReasons,
        paymentMethods,
        leadSubstages,
        upcomingPayments,
        upcomingEvaluations,
        unansweredConversations,
        sparklines: {
          salesAmount: sparkSales,
          receivedAmount: sparkReceived,
          newLeads: sparkLeads,
          averageTicket: sparkTicket,
        },
      };
    });

    const curSalesAmount = Number(blockA.sales.cur_amount);
    const prevSalesAmount = Number(blockA.sales.prev_amount);
    const curAvgTicket = Number(blockA.sales.cur_avg);
    const prevAvgTicket = Number(blockA.sales.prev_avg);
    const curReceived = Number(blockA.received.cur_received);
    const prevReceived = Number(blockA.received.prev_received);
    const curRate = rate(blockA.conv.cur_won, blockA.conv.cur_closed);
    const prevRate = rate(blockA.conv.prev_won, blockA.conv.prev_closed);

    return {
      period: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        comparePrevFrom: prev.from.toISOString(),
        comparePrevTo: prev.to.toISOString(),
      },
      cards: {
        salesAmount: {
          value: curSalesAmount,
          count: blockA.sales.cur_count,
          deltaPct: deltaPct(curSalesAmount, prevSalesAmount),
        },
        receivedAmount: {
          value: curReceived,
          deltaPct: deltaPct(curReceived, prevReceived),
        },
        todayAppointments: {
          total: blockA.today.total,
          breakdown: {
            attended: blockA.today.attended,
            noShow: blockA.today.no_show,
            scheduled: blockA.today.scheduled,
            cancelled: blockA.today.cancelled,
            confirmed: blockA.today.confirmed,
          },
        },
        newLeads: {
          count: blockA.leads.cur_leads,
          deltaPct: deltaPct(blockA.leads.cur_leads, blockA.leads.prev_leads),
        },
        leadToSaleRate: {
          value: curRate,
          deltaPct: deltaPct(curRate, prevRate),
        },
        averageTicket: {
          value: round1(curAvgTicket),
          deltaPct: deltaPct(curAvgTicket, prevAvgTicket),
        },
        sparklines: blockA.sparklines,
      },
      // ----- Bloco B — funil de conversão -----
      funnel: {
        // Ordem fixa: cada etapa filtra pelo timestamp do próprio evento no
        // range (não coorte). Etapas 1 e 5 reusam os agregados dos cards.
        stages: [
          { id: 'leads', label: 'Leads novos', value: blockA.leads.cur_leads },
          {
            id: 'evalScheduled',
            label: 'Avaliação agendada',
            value: blockA.funnelCounts.eval_scheduled,
          },
          {
            id: 'evalPerformed',
            label: 'Avaliação realizada',
            value: blockA.funnelCounts.eval_performed,
          },
          {
            id: 'quoteSent',
            label: 'Orçamento enviado',
            value: blockA.funnelCounts.quote_sent,
          },
          {
            id: 'salesClosed',
            label: 'Venda fechada',
            value: blockA.sales.cur_count,
          },
        ],
        transitionsTimeAvgDays: {
          leadToEvaluation: avgDays(blockA.funnelTransitions.lead_to_eval),
          evaluationToQuote: avgDays(blockA.funnelTransitions.eval_to_quote),
          quoteToSale: avgDays(blockA.funnelTransitions.quote_to_sale),
        },
      },
      // ----- Bloco E — evolução comercial -----
      evolution: {
        granularity,
        buckets: blockA.buckets.map((b) => ({
          bucketStart: b.bucket_start,
          bucketLabel: formatBucketLabel(b.bucket_start, granularity),
          leadsCount: b.leads,
          salesCount: b.sales_count,
          salesAmount: Number(b.sales_amount),
        })),
        derived: {
          // Reusa os agregados já calculados pros cards (mesma janela).
          averageTicket: round1(curAvgTicket),
          leadToSaleRate: curRate,
          leadToSaleCycleDays:
            blockA.cycleDays == null ? null : round1(blockA.cycleDays),
        },
      },
      // ----- Bloco C — distribuição -----
      distribution: {
        // C1 reusa os buckets de receita do bloco E (granularidade adaptativa).
        revenueByDay: blockA.buckets.map((b) => ({
          date: b.bucket_start,
          amount: Number(b.sales_amount),
        })),
        leadsBySource: blockA.leadsBySource,
        lostReasons: blockA.lostReasons,
        paymentMethods: blockA.paymentMethods.map((p) => ({
          method: p.method,
          amount: Number(p.amount),
          count: p.count,
        })),
        leadSubstages: blockA.leadSubstages,
      },
      // ----- Bloco D — operacional / alertas (semântica fixa) -----
      operational: {
        upcomingPayments: blockA.upcomingPayments.map((p) => ({
          id: p.id,
          saleId: p.sale_id,
          clientName: p.client_name,
          amount: Number(p.amount),
          dueDate: p.due_date,
          installment: p.installment,
          isOverdue: p.is_overdue,
        })),
        upcomingEvaluations: blockA.upcomingEvaluations.map((e) => ({
          id: e.id,
          clientName: e.client_name,
          // `tx.execute` devolve timestamp como string; normaliza pra ISO-Z
          // (mesma convenção do Drizzle query builder no resto do app).
          scheduledAt: new Date(e.scheduled_at).toISOString(),
          professional: e.professional,
        })),
        unansweredConversations: blockA.unansweredConversations.map((u) => ({
          conversationId: u.conversation_id,
          clientName: u.client_name,
          lastInboundAt: new Date(u.last_inbound_at).toISOString(),
          preview: u.preview,
        })),
      },
    };
  },
};
