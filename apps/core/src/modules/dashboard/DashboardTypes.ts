import { z } from '../../shared/openapi/registry.js';
import { periodEnum, type Period } from '../../shared/period/period.js';

// =====================================================================
// Dashboard — contrato do endpoint GET /dashboard/summary.
//
// Resposta única com todos os blocos (A–E). No PR 1 só o bloco A (cards)
// vem preenchido; B/C/D/E retornam estruturas vazias pra o contrato (e o
// OpenAPI/Postman) já existirem por completo. Ver docs/dashboard-domain.md
// (o quê/porquê) e docs/dashboard-implementation.md (o contrato detalhado).
// =====================================================================

// Filtro global de período — reusado de shared/period/. Default 30d.
// `custom` exige from+to (validado no superRefine abaixo). A3 (agendamentos
// hoje) e bloco D ignoram o filtro.
export const dashboardPeriodEnum = periodEnum;
export type DashboardPeriod = Period;

// Aceita data ISO (YYYY-MM-DD) ou timestamp ISO completo — o resolver de
// range trunca pro início do dia UTC de qualquer forma.
const isoDateString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'Data inválida (use formato ISO, ex: 2026-06-01)',
  });

export const dashboardSummaryQuerySchema = z
  .object({
    period: dashboardPeriodEnum.default('30d').openapi({
      description:
        'Janela de tempo aplicada a todos os blocos exceto A3 (sempre hoje) ' +
        'e bloco D (semântica fixa).',
    }),
    from: isoDateString.optional().openapi({
      description: 'Início do range (obrigatório quando period=custom).',
      example: '2026-05-01',
    }),
    to: isoDateString.optional().openapi({
      description: 'Fim do range, inclusivo no dia (obrigatório quando period=custom).',
      example: '2026-05-31',
    }),
  })
  .superRefine((val, ctx) => {
    if (val.period === 'custom' && (!val.from || !val.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'period=custom exige from e to',
        path: ['from'],
      });
    }
  })
  .openapi('DashboardSummaryQuery');

export type DashboardSummaryQuery = z.infer<typeof dashboardSummaryQuerySchema>;

export const dashboardGranularityEnum = z.enum([
  'daily',
  'weekly',
  'monthly',
  'quarterly',
]);

export type DashboardGranularity = z.infer<typeof dashboardGranularityEnum>;

// `deltaPct` é null quando o período anterior tem base 0 (variação % não é
// calculável). 0..100 nas taxas; valores monetários em reais (number).
const deltaPctSchema = z
  .number()
  .nullable()
  .openapi({ description: 'Variação % vs período anterior. null se base 0.' });

// ----- Bloco A — KPI cards -----

const cardsSchema = z.object({
  salesAmount: z.object({
    value: z.number(),
    count: z.number().int().nonnegative(),
    deltaPct: deltaPctSchema,
  }),
  receivedAmount: z.object({
    value: z.number(),
    deltaPct: deltaPctSchema,
  }),
  // Sempre "hoje" — ignora o filtro global. Sem delta (semântica de snapshot).
  todayAppointments: z.object({
    total: z.number().int().nonnegative(),
    breakdown: z.object({
      attended: z.number().int().nonnegative(),
      noShow: z.number().int().nonnegative(),
      scheduled: z.number().int().nonnegative(),
      cancelled: z.number().int().nonnegative(),
      confirmed: z.number().int().nonnegative(),
    }),
  }),
  newLeads: z.object({
    count: z.number().int().nonnegative(),
    deltaPct: deltaPctSchema,
  }),
  leadToSaleRate: z.object({
    value: z.number().openapi({ description: 'Taxa lead→venda 0..100.' }),
    deltaPct: deltaPctSchema,
  }),
  averageTicket: z.object({
    value: z.number(),
    deltaPct: deltaPctSchema,
  }),
  // Séries de 12 pontos pros mini-charts dentro dos cards. 12 buckets de
  // largura igual cobrindo o range selecionado.
  sparklines: z.object({
    salesAmount: z.array(z.number()),
    receivedAmount: z.array(z.number()),
    newLeads: z.array(z.number()),
    averageTicket: z.array(z.number()),
  }),
});

// ----- Bloco B — Funil (vazio no PR 1) -----

const funnelSchema = z.object({
  stages: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      value: z.number().int().nonnegative(),
    }),
  ),
  transitionsTimeAvgDays: z.object({
    leadToEvaluation: z.number().nullable(),
    evaluationToQuote: z.number().nullable(),
    quoteToSale: z.number().nullable(),
  }),
});

// ----- Bloco E — Evolução comercial (vazio no PR 1) -----

const evolutionSchema = z.object({
  granularity: dashboardGranularityEnum,
  buckets: z.array(
    z.object({
      bucketStart: z.string(),
      bucketLabel: z.string(),
      leadsCount: z.number().int().nonnegative(),
      salesCount: z.number().int().nonnegative(),
      salesAmount: z.number(),
    }),
  ),
  derived: z.object({
    averageTicket: z.number(),
    leadToSaleRate: z.number(),
    leadToSaleCycleDays: z.number().nullable(),
  }),
});

// ----- Bloco C — Distribuição (vazio no PR 1) -----

const distributionSchema = z.object({
  revenueByDay: z.array(z.object({ date: z.string(), amount: z.number() })),
  leadsBySource: z.array(z.object({ source: z.string(), count: z.number().int() })),
  lostReasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
  paymentMethods: z.array(
    z.object({
      method: z.string(),
      amount: z.number(),
      count: z.number().int(),
    }),
  ),
  leadSubstages: z.array(
    z.object({ substage: z.string(), count: z.number().int() }),
  ),
});

// ----- Bloco D — Operacional (vazio no PR 1) -----

const operationalSchema = z.object({
  upcomingPayments: z.array(
    z.object({
      id: z.string(),
      saleId: z.string(),
      clientName: z.string(),
      amount: z.number(),
      dueDate: z.string(),
      installment: z.string(),
      isOverdue: z.boolean(),
    }),
  ),
  upcomingEvaluations: z.array(
    z.object({
      id: z.string(),
      clientName: z.string(),
      scheduledAt: z.string(),
      professional: z.string().nullable(),
    }),
  ),
  unansweredConversations: z.array(
    z.object({
      conversationId: z.string(),
      clientName: z.string(),
      lastInboundAt: z.string(),
      preview: z.string(),
    }),
  ),
});

export const dashboardSummaryResponseSchema = z
  .object({
    period: z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
      comparePrevFrom: z.string().datetime(),
      comparePrevTo: z.string().datetime(),
    }),
    cards: cardsSchema,
    funnel: funnelSchema,
    evolution: evolutionSchema,
    distribution: distributionSchema,
    operational: operationalSchema,
  })
  .openapi('DashboardSummary');

export type DashboardSummary = z.infer<typeof dashboardSummaryResponseSchema>;
