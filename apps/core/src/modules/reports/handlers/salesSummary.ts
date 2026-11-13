import { sql, withTenant } from '@elora/db';
import { db } from '../../../shared/database/db.js';
import { z } from '../../../shared/openapi/registry.js';
import {
  periodEnum,
  resolvePeriodRange,
  toIsoDateUtc,
} from '../../../shared/period/period.js';
import type { ReportContext } from '../registry.js';

// =====================================================================
// sales.summary — Resumo de vendas no período.
//
// Cohort por `sales.closed_at` em [from, to). Compara com período
// imediatamente anterior de MESMA duração — frontend mostra deltas
// como ↑/↓ + cor via ComparisonCell.
//
// Tratamento de cancelled:
//   - summary.current/previous: contam só em cancelledSales; saem dos
//     totais de R$, ticket, descontoRate.
//   - byProcedure / byPaymentMethod / bySalesperson: excluídos via
//     WHERE s.status <> 'cancelled' (cancelada = venda revertida).
//
// byPaymentMethod considera payments cuja venda fechou no período (não
// `paid_at`/`due_date` da parcela). Coerente com summary.
//
// Output blocks:
//   - range, previousRange: ISO YYYY-MM-DD (renderer mostra)
//   - summary: { current, previous } com KPIs
//   - byProcedure: top procedimentos vendidos
//   - byPaymentMethod: distribuição dos métodos planejados
//   - bySalesperson: performance por vendedor (closed_by_user_id)
// =====================================================================

const isoDateString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'Data inválida (use ISO YYYY-MM-DD)',
  });

export const salesSummaryParamsSchema = z
  .object({
    period: periodEnum.default('30d').openapi({
      description:
        'Preset de período. `custom` exige from+to. Mesma semântica do dashboard.',
    }),
    from: isoDateString.optional().openapi({
      description: 'Início do range (obrigatório quando period=custom).',
      example: '2026-05-01',
    }),
    to: isoDateString.optional().openapi({
      description: 'Fim do range, inclusivo (obrigatório quando period=custom).',
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
  .openapi('SalesSummaryParams');

export type SalesSummaryParams = z.infer<typeof salesSummaryParamsSchema>;

// ---- Shape do output ----

export interface SalesSummaryKpis {
  totalSales: number;
  totalRevenue: number;
  totalDiscount: number;
  totalReceived: number;
  totalPending: number;
  avgTicket: number | null;
  discountRate: number | null;
  paidSales: number;
  openSales: number;
  cancelledSales: number;
}

export interface SalesSummaryByProcedure {
  procedureId: string;
  procedureName: string;
  salesCount: number;
  totalSessions: number;
  revenue: number;
  avgPricePerSession: number | null;
}

export interface SalesSummaryByPaymentMethod {
  method: string;
  installments: number;
  amount: number;
  pct: number;
}

export interface SalesSummaryBySalesperson {
  userId: string | null;
  userName: string | null;
  salesCount: number;
  revenue: number;
  avgTicket: number | null;
  discountRate: number | null;
}

export interface SalesSummaryData {
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string };
  summary: {
    current: SalesSummaryKpis;
    previous: SalesSummaryKpis;
  };
  byProcedure: SalesSummaryByProcedure[];
  byPaymentMethod: SalesSummaryByPaymentMethod[];
  bySalesperson: SalesSummaryBySalesperson[];
}

// ---- Helpers de query parsing ----

interface SummaryRow {
  total_sales: string | number;
  paid_sales: string | number;
  open_sales: string | number;
  cancelled_sales: string | number;
  total_revenue: string | number | null;
  total_discount: string | number | null;
  total_received: string | number | null;
  total_pending: string | number | null;
  [key: string]: unknown;
}

interface ByProcedureRow {
  procedure_id: string;
  procedure_name: string;
  sales_count: string | number;
  total_sessions: string | number;
  revenue: string | number | null;
  [key: string]: unknown;
}

interface ByPaymentMethodRow {
  method: string;
  installments: string | number;
  amount: string | number | null;
  [key: string]: unknown;
}

interface BySalespersonRow {
  user_id: string | null;
  user_name: string | null;
  sales_count: string | number;
  revenue: string | number | null;
  total_discount: string | number | null;
  [key: string]: unknown;
}

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'string' ? Number(v) : v;
}

function rate(part: number, total: number): number | null {
  if (total <= 0) return null;
  return part / total;
}

// ---- Handler ----

export async function salesSummaryHandler(
  params: SalesSummaryParams,
  ctx: ReportContext
): Promise<SalesSummaryData> {
  // Range atual via helper compartilhado. `to` é EXCLUSIVO.
  const range = resolvePeriodRange(params.period, params.from, params.to);
  const fromIso = toIsoDateUtc(range.from);
  const toInclusiveIso = toIsoDateUtc(
    new Date(range.to.getTime() - 86_400_000)
  );

  // Período anterior: mesma duração, terminando onde o atual começa.
  // [prevFrom, prevTo) com prevTo = range.from.
  const durationMs = range.to.getTime() - range.from.getTime();
  const prevTo = range.from;
  const prevFrom = new Date(range.from.getTime() - durationMs);
  const prevFromIso = toIsoDateUtc(prevFrom);
  const prevToInclusiveIso = toIsoDateUtc(
    new Date(prevTo.getTime() - 86_400_000)
  );

  return withTenant(db, ctx.tenantId, async (tx) => {
    // 1) Summary atual + anterior — query única com UNION ALL pra evitar
    //    round-trip e duplicar SQL. Distingue via coluna `bucket`.
    const summaryRes = await tx.execute<
      SummaryRow & { bucket: 'current' | 'previous' }
    >(sql`
      WITH base AS (
        SELECT
          'current'::text AS bucket,
          s.status,
          s.total_amount,
          s.discount_amount,
          s.paid_amount
        FROM sales s
        WHERE s.closed_at >= ${range.from}
          AND s.closed_at <  ${range.to}
        UNION ALL
        SELECT
          'previous'::text AS bucket,
          s.status,
          s.total_amount,
          s.discount_amount,
          s.paid_amount
        FROM sales s
        WHERE s.closed_at >= ${prevFrom}
          AND s.closed_at <  ${prevTo}
      )
      SELECT
        bucket,
        COUNT(*)::int                                                       AS total_sales,
        SUM(CASE WHEN status='paid'      THEN 1 ELSE 0 END)::int            AS paid_sales,
        SUM(CASE WHEN status='open'      THEN 1 ELSE 0 END)::int            AS open_sales,
        SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END)::int            AS cancelled_sales,
        COALESCE(SUM(
          CASE WHEN status <> 'cancelled' THEN total_amount    ELSE 0 END
        ), 0)::numeric                                                      AS total_revenue,
        COALESCE(SUM(
          CASE WHEN status <> 'cancelled' THEN discount_amount ELSE 0 END
        ), 0)::numeric                                                      AS total_discount,
        COALESCE(SUM(
          CASE WHEN status <> 'cancelled' THEN paid_amount     ELSE 0 END
        ), 0)::numeric                                                      AS total_received,
        COALESCE(SUM(
          CASE WHEN status = 'open' THEN total_amount - paid_amount ELSE 0 END
        ), 0)::numeric                                                      AS total_pending
      FROM base
      GROUP BY bucket
    `);

    const summaryByBucket: Record<'current' | 'previous', SummaryRow | null> = {
      current: null,
      previous: null,
    };
    for (const row of summaryRes.rows) {
      summaryByBucket[row.bucket] = row;
    }

    const summary = {
      current: rowToKpis(summaryByBucket.current),
      previous: rowToKpis(summaryByBucket.previous),
    };

    // 2) byProcedure — agregação sobre sale_items, juntando procedures
    //    pra nome. Exclui cancelled. Ordenado por receita desc.
    //    `salesCount` é DISTINCT de saleId pra refletir nº de vendas
    //    (não de itens) que incluíram o procedimento.
    const byProcedureRes = await tx.execute<ByProcedureRow>(sql`
      SELECT
        p.id                                  AS procedure_id,
        p.name                                AS procedure_name,
        COUNT(DISTINCT si.sale_id)::int       AS sales_count,
        COALESCE(SUM(si.quantity_sessions), 0)::int AS total_sessions,
        COALESCE(SUM(si.computed_amount), 0)::numeric AS revenue
      FROM sale_items si
      INNER JOIN sales s      ON s.id = si.sale_id
      INNER JOIN procedures p ON p.id = si.procedure_id
      WHERE s.closed_at >= ${range.from}
        AND s.closed_at <  ${range.to}
        AND s.status   <> 'cancelled'
      GROUP BY p.id, p.name
      ORDER BY revenue DESC
    `);

    const byProcedure: SalesSummaryByProcedure[] = byProcedureRes.rows.map((r) => {
      const revenue = num(r.revenue);
      const sessions = num(r.total_sessions);
      return {
        procedureId: r.procedure_id,
        procedureName: r.procedure_name,
        salesCount: num(r.sales_count),
        totalSessions: sessions,
        revenue,
        avgPricePerSession: sessions > 0 ? revenue / sessions : null,
      };
    });

    // 3) byPaymentMethod — payments cujo sale fechou no período. Exclui
    //    cancelled. % é em cima do total dos próprios payments listados
    //    (não do totalRevenue — pq amount de parcela inclui desconto já
    //    aplicado, é o valor planejado).
    const byPaymentMethodRes = await tx.execute<ByPaymentMethodRow>(sql`
      SELECT
        pay.payment_method::text         AS method,
        COUNT(*)::int                    AS installments,
        COALESCE(SUM(pay.amount), 0)::numeric AS amount
      FROM payments pay
      INNER JOIN sales s ON s.id = pay.sale_id
      WHERE s.closed_at >= ${range.from}
        AND s.closed_at <  ${range.to}
        AND s.status   <> 'cancelled'
      GROUP BY pay.payment_method
      ORDER BY amount DESC
    `);

    const totalPaymentsAmount = byPaymentMethodRes.rows.reduce(
      (acc, r) => acc + num(r.amount),
      0
    );

    const byPaymentMethod: SalesSummaryByPaymentMethod[] =
      byPaymentMethodRes.rows.map((r) => {
        const amount = num(r.amount);
        return {
          method: r.method,
          installments: num(r.installments),
          amount,
          pct: rate(amount, totalPaymentsAmount) ?? 0,
        };
      });

    // 4) bySalesperson — vendas por usuário que fechou. LEFT JOIN em
    //    users porque closed_by_user_id pode ser NULL (set null on delete
    //    ou vendas legadas). discountRate = totalDiscount / (revenue +
    //    discount) — proporção média de desconto sobre a tabela.
    const bySalespersonRes = await tx.execute<BySalespersonRow>(sql`
      SELECT
        u.id                                       AS user_id,
        u.name                                     AS user_name,
        COUNT(*)::int                              AS sales_count,
        COALESCE(SUM(s.total_amount),    0)::numeric AS revenue,
        COALESCE(SUM(s.discount_amount), 0)::numeric AS total_discount
      FROM sales s
      LEFT JOIN users u ON u.id = s.closed_by_user_id
      WHERE s.closed_at >= ${range.from}
        AND s.closed_at <  ${range.to}
        AND s.status   <> 'cancelled'
      GROUP BY u.id, u.name
      ORDER BY revenue DESC
    `);

    const bySalesperson: SalesSummaryBySalesperson[] = bySalespersonRes.rows.map(
      (r) => {
        const revenue = num(r.revenue);
        const discount = num(r.total_discount);
        const count = num(r.sales_count);
        return {
          userId: r.user_id,
          userName: r.user_name,
          salesCount: count,
          revenue,
          avgTicket: count > 0 ? revenue / count : null,
          discountRate: rate(discount, revenue + discount),
        };
      }
    );

    return {
      period: { from: fromIso, to: toInclusiveIso },
      previousPeriod: { from: prevFromIso, to: prevToInclusiveIso },
      summary,
      byProcedure,
      byPaymentMethod,
      bySalesperson,
    };
  });
}

// Converte row do summary (current/previous) pra KPIs derivados.
// Quando não há linha (período vazio) retorna zeros.
function rowToKpis(row: SummaryRow | null): SalesSummaryKpis {
  if (!row) {
    return {
      totalSales: 0,
      totalRevenue: 0,
      totalDiscount: 0,
      totalReceived: 0,
      totalPending: 0,
      avgTicket: null,
      discountRate: null,
      paidSales: 0,
      openSales: 0,
      cancelledSales: 0,
    };
  }
  const totalSales = num(row.total_sales);
  const cancelledSales = num(row.cancelled_sales);
  const validSales = totalSales - cancelledSales;
  const totalRevenue = num(row.total_revenue);
  const totalDiscount = num(row.total_discount);
  return {
    totalSales,
    totalRevenue,
    totalDiscount,
    totalReceived: num(row.total_received),
    totalPending: num(row.total_pending),
    // avgTicket considera só vendas não-canceladas (totalRevenue já exclui).
    avgTicket: validSales > 0 ? totalRevenue / validSales : null,
    discountRate: rate(totalDiscount, totalRevenue + totalDiscount),
    paidSales: num(row.paid_sales),
    openSales: num(row.open_sales),
    cancelledSales,
  };
}
