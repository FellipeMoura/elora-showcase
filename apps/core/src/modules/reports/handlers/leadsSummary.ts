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
// leads.summary — Resumo de leads no período.
//
// Considera journeys CRIADAS no intervalo [from, to] e segue o estado
// ATUAL delas (won/lost/active) — cohort analysis. Permite responder
// "investimento em leads de junho deu retorno?" mesmo que venda tenha
// fechado em julho.
//
// Aceita filtro de período via `period` (igual ao dashboard) + `from`/`to`
// pra `period=custom`. Default 30d. Range é resolvido via helper compartilhado.
//
// Output blocks:
//   - period: range resolvido (espelhado no header de print do frontend)
//   - summary: totais + total convertido (R$) + taxas
//   - daily:   linha por dia com comparativos vs média
//   - dailyAverages: referência pra comparativos visuais no frontend
//   - bySource: agregação por origem (WhatsApp/manual/etc.)
//   - lostReasons: ranking dos motivos de perda
// =====================================================================

const isoDateString = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'Data inválida (use ISO YYYY-MM-DD)',
  });

export const leadsSummaryParamsSchema = z
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
  .openapi('LeadsSummaryParams');

export type LeadsSummaryParams = z.infer<typeof leadsSummaryParamsSchema>;

// ---- Shape do output ----

export interface LeadsSummarySummary {
  totalEntered: number;
  won: number;
  lost: number;
  active: number;
  conversionRate: number;
  lossRate: number;
  totalConvertedValue: number;
}

export interface LeadsSummaryDay {
  date: string; // YYYY-MM-DD
  total: number;
  won: number;
  wonRate: number | null;
  lost: number;
  lostRate: number | null;
  pending: number;
  pendingRate: number | null;
  avgResponseTimeMin: number | null;
  convertedValue: number;
  avgTicket: number | null;
}

export interface LeadsSummaryDailyAverages {
  total: number;
  won: number;
  wonRate: number;
  lost: number;
  lostRate: number;
  avgResponseTimeMin: number | null;
  convertedValue: number;
  avgTicket: number | null;
}

export interface LeadsSummaryBySource {
  source: string;
  total: number;
  won: number;
  lost: number;
  active: number;
  conversionRate: number;
}

export interface LeadsSummaryLostReason {
  reason: string | null;
  count: number;
  pct: number;
}

export interface LeadsSummaryData {
  period: { from: string; to: string };
  summary: LeadsSummarySummary;
  daily: LeadsSummaryDay[];
  dailyAverages: LeadsSummaryDailyAverages;
  bySource: LeadsSummaryBySource[];
  lostReasons: LeadsSummaryLostReason[];
}

// ---- Helpers de query parsing ----

interface SummaryRow {
  total_entered: string | number;
  won: string | number;
  lost: string | number;
  active: string | number;
  total_converted_value: string | number | null;
  [key: string]: unknown;
}

interface DailyRow {
  day: Date | string;
  total: string | number;
  won: string | number;
  lost: string | number;
  pending: string | number;
  converted_value: string | number | null;
  avg_ticket: string | number | null;
  avg_response_min: string | number | null;
  [key: string]: unknown;
}

interface BySourceRow {
  source: string;
  total: string | number;
  won: string | number;
  lost: string | number;
  active: string | number;
  [key: string]: unknown;
}

interface LostReasonRow {
  reason: string | null;
  count: string | number;
  [key: string]: unknown;
}

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === 'string' ? Number(v) : v;
}

function nullableNum(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
}

function rate(part: number, total: number): number | null {
  if (total <= 0) return null;
  return part / total;
}

function dateKey(d: Date | string): string {
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

// ---- Handler ----

export async function leadsSummaryHandler(
  params: LeadsSummaryParams,
  ctx: ReportContext
): Promise<LeadsSummaryData> {
  // Resolve range via helper compartilhado. `range.to` é EXCLUSIVO (col < to),
  // então as queries comparam `created_at < to` direto — sem +1 day.
  const range = resolvePeriodRange(params.period, params.from, params.to);
  const fromIso = toIsoDateUtc(range.from);
  // Pra mostrar no header (e na geração da daily series): `to` no output
  // é INCLUSIVO (o último dia mostrado é o anterior ao exclusivo).
  const toInclusiveIso = toIsoDateUtc(
    new Date(range.to.getTime() - 86_400_000)
  );

  return withTenant(db, ctx.tenantId, async (tx) => {
    // 1) Summary: totais + total convertido. Uma query agregada simples.
    const summaryRes = await tx.execute<SummaryRow>(sql`
      SELECT
        COUNT(*)::int                                            AS total_entered,
        SUM(CASE WHEN j.status='won' THEN 1 ELSE 0 END)::int     AS won,
        SUM(CASE WHEN j.status='lost' THEN 1 ELSE 0 END)::int    AS lost,
        SUM(CASE WHEN j.status='active' THEN 1 ELSE 0 END)::int  AS active,
        COALESCE(SUM(
          CASE WHEN j.status='won' THEN s.total_amount ELSE 0 END
        ), 0)::numeric                                           AS total_converted_value
      FROM journeys j
      LEFT JOIN sales s ON s.journey_id = j.id
      WHERE j.created_at >= ${range.from}
        AND j.created_at <  ${range.to}
    `);

    const summaryRow = (summaryRes.rows[0] ?? {
      total_entered: 0,
      won: 0,
      lost: 0,
      active: 0,
      total_converted_value: 0,
    }) as SummaryRow;

    const totalEntered = num(summaryRow.total_entered);
    const won = num(summaryRow.won);
    const lost = num(summaryRow.lost);
    const active = num(summaryRow.active);

    const summary: LeadsSummarySummary = {
      totalEntered,
      won,
      lost,
      active,
      conversionRate: rate(won, totalEntered) ?? 0,
      lossRate: rate(lost, totalEntered) ?? 0,
      totalConvertedValue: num(summaryRow.total_converted_value),
    };

    // 2) Daily breakdown. Query grande mas única: junta agregações de
    //    stats + sales + response time num único resultset via CTEs.
    //    LEFT JOIN com generate_series garante dias com 0 leads no output.
    const dailyRes = await tx.execute<DailyRow>(sql`
      WITH days AS (
        SELECT generate_series(${fromIso}::date, ${toInclusiveIso}::date, '1 day')::date AS day
      ),
      day_stats AS (
        SELECT
          j.created_at::date AS day,
          COUNT(*)::int AS total,
          SUM(CASE WHEN j.status='won' THEN 1 ELSE 0 END)::int  AS won,
          SUM(CASE WHEN j.status='lost' THEN 1 ELSE 0 END)::int AS lost,
          SUM(CASE WHEN j.status='active' THEN 1 ELSE 0 END)::int AS pending
        FROM journeys j
        WHERE j.created_at >= ${range.from}
          AND j.created_at <  ${range.to}
        GROUP BY j.created_at::date
      ),
      day_sales AS (
        SELECT
          j.created_at::date AS day,
          SUM(s.total_amount)::numeric AS converted_value,
          AVG(s.total_amount)::numeric AS avg_ticket
        FROM journeys j
        INNER JOIN sales s ON s.journey_id = j.id
        WHERE j.created_at >= ${range.from}
          AND j.created_at <  ${range.to}
          AND j.status = 'won'
        GROUP BY j.created_at::date
      ),
      journey_response AS (
        -- Tempo (minutos) entre primeira inbound da journey e primeira
        -- outbound posterior. Considera só journeys com conversa real.
        SELECT
          j.created_at::date AS day,
          EXTRACT(EPOCH FROM (mo.first_outbound - mi.first_inbound)) / 60
            AS response_min
        FROM journeys j
        INNER JOIN conversations c
          ON c.client_id = j.client_id
        INNER JOIN LATERAL (
          SELECT MIN(m.created_at) AS first_inbound
          FROM messages m
          WHERE m.conversation_id = c.id
            AND m.direction = 'inbound'
            AND m.created_at >= j.created_at
        ) mi ON mi.first_inbound IS NOT NULL
        INNER JOIN LATERAL (
          SELECT MIN(m.created_at) AS first_outbound
          FROM messages m
          WHERE m.conversation_id = c.id
            AND m.direction = 'outbound'
            AND m.created_at > mi.first_inbound
        ) mo ON mo.first_outbound IS NOT NULL
        WHERE j.created_at >= ${range.from}
          AND j.created_at <  ${range.to}
      ),
      day_response AS (
        SELECT day, AVG(response_min)::numeric AS avg_response_min
        FROM journey_response
        GROUP BY day
      )
      SELECT
        days.day                          AS day,
        COALESCE(ds.total, 0)::int        AS total,
        COALESCE(ds.won, 0)::int          AS won,
        COALESCE(ds.lost, 0)::int         AS lost,
        COALESCE(ds.pending, 0)::int      AS pending,
        COALESCE(dsa.converted_value, 0)::numeric AS converted_value,
        dsa.avg_ticket                    AS avg_ticket,
        dr.avg_response_min               AS avg_response_min
      FROM days
      LEFT JOIN day_stats    ds  ON ds.day  = days.day
      LEFT JOIN day_sales    dsa ON dsa.day = days.day
      LEFT JOIN day_response dr  ON dr.day  = days.day
      ORDER BY days.day
    `);

    const daily: LeadsSummaryDay[] = dailyRes.rows.map((r) => {
      const dRow = r as DailyRow;
      const total = num(dRow.total);
      const w = num(dRow.won);
      const l = num(dRow.lost);
      const p = num(dRow.pending);
      return {
        date: dateKey(dRow.day),
        total,
        won: w,
        wonRate: rate(w, total),
        lost: l,
        lostRate: rate(l, total),
        pending: p,
        pendingRate: rate(p, total),
        avgResponseTimeMin: nullableNum(dRow.avg_response_min),
        convertedValue: num(dRow.converted_value),
        avgTicket: nullableNum(dRow.avg_ticket),
      };
    });

    // 3) Daily averages — referência pros comparativos no frontend.
    //    Pra responseTime e avgTicket, ignora dias sem dado (null) na
    //    média; evita distorcer com zero artificial.
    const dailyAverages = computeDailyAverages(daily);

    // 4) By source — agregação por origem da journey.
    const bySourceRes = await tx.execute<BySourceRow>(sql`
      SELECT
        j.source::text                                           AS source,
        COUNT(*)::int                                            AS total,
        SUM(CASE WHEN j.status='won' THEN 1 ELSE 0 END)::int     AS won,
        SUM(CASE WHEN j.status='lost' THEN 1 ELSE 0 END)::int    AS lost,
        SUM(CASE WHEN j.status='active' THEN 1 ELSE 0 END)::int  AS active
      FROM journeys j
      WHERE j.created_at >= ${range.from}
        AND j.created_at <  ${range.to}
      GROUP BY j.source
      ORDER BY total DESC
    `);

    const bySource: LeadsSummaryBySource[] = bySourceRes.rows.map((r) => {
      const row = r as BySourceRow;
      const total = num(row.total);
      const wonS = num(row.won);
      return {
        source: row.source,
        total,
        won: wonS,
        lost: num(row.lost),
        active: num(row.active),
        conversionRate: rate(wonS, total) ?? 0,
      };
    });

    // 5) Lost reasons — ranking. Inclui null pra "sem motivo registrado".
    const lostReasonsRes = await tx.execute<LostReasonRow>(sql`
      SELECT
        j.lost_reason AS reason,
        COUNT(*)::int AS count
      FROM journeys j
      WHERE j.created_at >= ${range.from}
        AND j.created_at <  ${range.to}
        AND j.status = 'lost'
      GROUP BY j.lost_reason
      ORDER BY count DESC
    `);

    const lostReasons: LeadsSummaryLostReason[] = lostReasonsRes.rows.map((r) => {
      const row = r as LostReasonRow;
      return {
        reason: row.reason,
        count: num(row.count),
        pct: rate(num(row.count), lost) ?? 0,
      };
    });

    return {
      period: { from: fromIso, to: toInclusiveIso },
      summary,
      daily,
      dailyAverages,
      bySource,
      lostReasons,
    };
  });
}

// Calcula médias diárias usadas como referência pelos comparativos
// visuais. Pra metricas com null (responseTime, avgTicket), ignora os
// nulos na média — evita afundar a média com zeros artificiais.
function computeDailyAverages(
  daily: LeadsSummaryDay[]
): LeadsSummaryDailyAverages {
  if (daily.length === 0) {
    return {
      total: 0,
      won: 0,
      wonRate: 0,
      lost: 0,
      lostRate: 0,
      avgResponseTimeMin: null,
      convertedValue: 0,
      avgTicket: null,
    };
  }
  const n = daily.length;
  let total = 0;
  let won = 0;
  let lost = 0;
  let convertedValue = 0;
  let responseSum = 0;
  let responseCount = 0;
  let ticketSum = 0;
  let ticketCount = 0;
  for (const d of daily) {
    total += d.total;
    won += d.won;
    lost += d.lost;
    convertedValue += d.convertedValue;
    if (d.avgResponseTimeMin !== null) {
      responseSum += d.avgResponseTimeMin;
      responseCount += 1;
    }
    if (d.avgTicket !== null) {
      ticketSum += d.avgTicket;
      ticketCount += 1;
    }
  }
  return {
    total: total / n,
    won: won / n,
    wonRate: total > 0 ? won / total : 0,
    lost: lost / n,
    lostRate: total > 0 ? lost / total : 0,
    avgResponseTimeMin: responseCount > 0 ? responseSum / responseCount : null,
    convertedValue: convertedValue / n,
    avgTicket: ticketCount > 0 ? ticketSum / ticketCount : null,
  };
}
