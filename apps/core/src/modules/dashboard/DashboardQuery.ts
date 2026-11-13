import { sql, type Tx } from '@elora/db';
import { resolvePeriodRange, type PeriodRange } from '../../shared/period/period.js';
import type { DashboardGranularity } from './DashboardTypes.js';

// =====================================================================
// Dashboard — resolvers de granularidade + queries agregadas do bloco A
// (KPI cards). Todas as queries rodam dentro de `withTenant` (RLS filtra
// por tenant). Datas em UTC, sem timezone explícito.
//
// Resolver de range (`resolvePeriodRange`) vive em shared/period/ — usado
// também por relatórios. Mantém a regra de [from, to) com `to` exclusivo.
//
// Agregações usam `sql` template (FILTER, width_bucket, generate_series)
// — Postgres-specific, fora do alcance do query builder do Drizzle
// (CLAUDE.md regra 7). RLS continua valendo: SET LOCAL app.current_tenant
// está ativo na transação.
// =====================================================================

// Re-exportadas pra não quebrar callers existentes.
export { resolvePeriodRange };
export type { PeriodRange };

const DAY_MS = 86_400_000;

// Período anterior do mesmo tamanho, imediatamente antes do atual — base pros
// deltas % dos KPI cards. Contíguo (prev.to === range.from).
export function resolveComparePrevRange(range: PeriodRange): PeriodRange {
  const durationMs = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - durationMs),
    to: range.from,
  };
}

export function durationDaysOf(range: PeriodRange): number {
  return Math.round((range.to.getTime() - range.from.getTime()) / DAY_MS);
}

// Granularidade adaptativa do bloco E (calculada no backend, mandada pronta).
// < 14d cai em 'daily' — o front renderiza empty state ("período curto demais").
export function resolveGranularity(durationDays: number): DashboardGranularity {
  if (durationDays < 14) return 'daily';
  if (durationDays < 60) return 'weekly';
  if (durationDays < 540) return 'monthly';
  return 'quarterly';
}

// ---- Linhas brutas das agregações (texto pra decimais; Service converte) ----

export type SalesAggregateRow = {
  cur_amount: string;
  cur_count: number;
  cur_avg: string;
  prev_amount: string;
  prev_avg: string;
}

export type ReceivedAggregateRow = {
  cur_received: string;
  prev_received: string;
}

export type NewLeadsAggregateRow = {
  cur_leads: number;
  prev_leads: number;
}

export type LeadToSaleAggregateRow = {
  cur_won: number;
  cur_closed: number;
  prev_won: number;
  prev_closed: number;
}

export type TodayAppointmentsRow = {
  total: number;
  attended: number;
  no_show: number;
  scheduled: number;
  cancelled: number;
  confirmed: number;
}

export type EvolutionBucketRow = {
  bucket_start: string; // YYYY-MM-DD (início do bucket)
  leads: number;
  sales_count: number;
  sales_amount: string;
}

// Campo de date_trunc + passo do generate_series por granularidade. Postgres
// não tem intervalo '1 quarter' — trimestral usa trunc 'quarter' + passo de
// 3 meses. `field` é texto (primeiro arg de date_trunc) — passa como param.
function bucketUnits(granularity: DashboardGranularity): {
  truncField: string;
  stepInterval: string;
} {
  switch (granularity) {
    case 'weekly':
      return { truncField: 'week', stepInterval: '1 week' };
    case 'monthly':
      return { truncField: 'month', stepInterval: '1 month' };
    case 'quarterly':
      return { truncField: 'quarter', stepInterval: '3 months' };
    case 'daily':
      return { truncField: 'day', stepInterval: '1 day' };
  }
}

// 12 buckets de largura igual sobre [range.from, range.to). width_bucket
// classifica pelo epoch; LEFT JOIN com generate_series garante 12 pontos
// (zeros nos buckets sem dados).
async function sparkline(
  tx: Tx,
  // Fragmento já montado: SELECT da CTE `d` com colunas (idx, v).
  dataCte: ReturnType<typeof sql>,
): Promise<number[]> {
  const res = await tx.execute<{ idx: number; v: string }>(sql`
    WITH b AS (SELECT generate_series(1, 12) AS idx),
    d AS (${dataCte})
    SELECT b.idx, COALESCE(d.v, 0)::text AS v
    FROM b LEFT JOIN d ON d.idx = b.idx
    ORDER BY b.idx
  `);
  return res.rows.map((r) => Number(r.v));
}

export const DashboardQuery = {
  // A1 (vendas: valor + qtd) + A6 (ticket médio) — current e prev numa só
  // query. Janela externa cobre [prev.from, cur.to) (contígua) e os FILTERs
  // separam os dois lados.
  salesAggregate: async (
    tx: Tx,
    cur: PeriodRange,
    prev: PeriodRange,
  ): Promise<SalesAggregateRow> => {
    const res = await tx.execute<SalesAggregateRow>(sql`
      SELECT
        COALESCE(SUM(total_amount::numeric) FILTER (WHERE closed_at >= ${cur.from} AND closed_at < ${cur.to}), 0)::text AS cur_amount,
        COUNT(*) FILTER (WHERE closed_at >= ${cur.from} AND closed_at < ${cur.to})::int AS cur_count,
        COALESCE(AVG(total_amount::numeric) FILTER (WHERE closed_at >= ${cur.from} AND closed_at < ${cur.to}), 0)::text AS cur_avg,
        COALESCE(SUM(total_amount::numeric) FILTER (WHERE closed_at >= ${prev.from} AND closed_at < ${prev.to}), 0)::text AS prev_amount,
        COALESCE(AVG(total_amount::numeric) FILTER (WHERE closed_at >= ${prev.from} AND closed_at < ${prev.to}), 0)::text AS prev_avg
      FROM sales
      WHERE status <> 'cancelled'
        AND closed_at >= ${prev.from} AND closed_at < ${cur.to}
    `);
    return res.rows[0]!;
  },

  // A2 (recebido / caixa efetivo) — payments status=paid pelo paid_at.
  receivedAggregate: async (
    tx: Tx,
    cur: PeriodRange,
    prev: PeriodRange,
  ): Promise<ReceivedAggregateRow> => {
    const res = await tx.execute<ReceivedAggregateRow>(sql`
      SELECT
        COALESCE(SUM(amount::numeric) FILTER (WHERE paid_at >= ${cur.from} AND paid_at < ${cur.to}), 0)::text AS cur_received,
        COALESCE(SUM(amount::numeric) FILTER (WHERE paid_at >= ${prev.from} AND paid_at < ${prev.to}), 0)::text AS prev_received
      FROM payments
      WHERE status = 'paid' AND paid_at IS NOT NULL
        AND paid_at >= ${prev.from} AND paid_at < ${cur.to}
    `);
    return res.rows[0]!;
  },

  // A4 (leads novos) — journeys criadas no range. Toda journey entra como
  // 'lead' (default), então contagem de criadas = leads novos.
  newLeadsAggregate: async (
    tx: Tx,
    cur: PeriodRange,
    prev: PeriodRange,
  ): Promise<NewLeadsAggregateRow> => {
    const res = await tx.execute<NewLeadsAggregateRow>(sql`
      SELECT
        COUNT(*) FILTER (WHERE created_at >= ${cur.from} AND created_at < ${cur.to})::int AS cur_leads,
        COUNT(*) FILTER (WHERE created_at >= ${prev.from} AND created_at < ${prev.to})::int AS prev_leads
      FROM journeys
      WHERE created_at >= ${prev.from} AND created_at < ${cur.to}
    `);
    return res.rows[0]!;
  },

  // A5 (conversão lead→venda) — won / (won+lost) sobre journeys fechadas no
  // range (closed_at). Service calcula a taxa e o delta.
  leadToSaleAggregate: async (
    tx: Tx,
    cur: PeriodRange,
    prev: PeriodRange,
  ): Promise<LeadToSaleAggregateRow> => {
    const res = await tx.execute<LeadToSaleAggregateRow>(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'won' AND closed_at >= ${cur.from} AND closed_at < ${cur.to})::int AS cur_won,
        COUNT(*) FILTER (WHERE closed_at >= ${cur.from} AND closed_at < ${cur.to})::int AS cur_closed,
        COUNT(*) FILTER (WHERE status = 'won' AND closed_at >= ${prev.from} AND closed_at < ${prev.to})::int AS prev_won,
        COUNT(*) FILTER (WHERE closed_at >= ${prev.from} AND closed_at < ${prev.to})::int AS prev_closed
      FROM journeys
      WHERE status IN ('won', 'lost') AND closed_at IS NOT NULL
        AND closed_at >= ${prev.from} AND closed_at < ${cur.to}
    `);
    return res.rows[0]!;
  },

  // A3 (agendamentos hoje) — IGNORA o filtro global. CURRENT_DATE usa o tz do
  // servidor (mesma convenção do caixa). Breakdown por status do slot.
  todayAppointments: async (tx: Tx): Promise<TodayAppointmentsRow> => {
    const res = await tx.execute<TodayAppointmentsRow>(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'attended')::int AS attended,
        COUNT(*) FILTER (WHERE status = 'no_show')::int AS no_show,
        COUNT(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
        COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
        COUNT(*) FILTER (WHERE status = 'confirmed')::int AS confirmed
      FROM appointments
      WHERE scheduled_at::date = CURRENT_DATE
    `);
    return res.rows[0]!;
  },

  // ---- Sparklines (12 pontos, granularidade implícita = range/12) ----

  salesAmountSparkline: (tx: Tx, range: PeriodRange): Promise<number[]> => {
    const fromEpoch = range.from.getTime() / 1000;
    const toEpoch = range.to.getTime() / 1000;
    return sparkline(
      tx,
      sql`
        SELECT width_bucket(extract(epoch FROM closed_at), ${fromEpoch}, ${toEpoch}, 12) AS idx,
               SUM(total_amount::numeric) AS v
        FROM sales
        WHERE status <> 'cancelled'
          AND closed_at >= ${range.from} AND closed_at < ${range.to}
        GROUP BY 1
      `,
    );
  },

  receivedAmountSparkline: (tx: Tx, range: PeriodRange): Promise<number[]> => {
    const fromEpoch = range.from.getTime() / 1000;
    const toEpoch = range.to.getTime() / 1000;
    return sparkline(
      tx,
      sql`
        SELECT width_bucket(extract(epoch FROM paid_at), ${fromEpoch}, ${toEpoch}, 12) AS idx,
               SUM(amount::numeric) AS v
        FROM payments
        WHERE status = 'paid' AND paid_at IS NOT NULL
          AND paid_at >= ${range.from} AND paid_at < ${range.to}
        GROUP BY 1
      `,
    );
  },

  newLeadsSparkline: (tx: Tx, range: PeriodRange): Promise<number[]> => {
    const fromEpoch = range.from.getTime() / 1000;
    const toEpoch = range.to.getTime() / 1000;
    return sparkline(
      tx,
      sql`
        SELECT width_bucket(extract(epoch FROM created_at), ${fromEpoch}, ${toEpoch}, 12) AS idx,
               COUNT(*) AS v
        FROM journeys
        WHERE created_at >= ${range.from} AND created_at < ${range.to}
        GROUP BY 1
      `,
    );
  },

  averageTicketSparkline: (tx: Tx, range: PeriodRange): Promise<number[]> => {
    const fromEpoch = range.from.getTime() / 1000;
    const toEpoch = range.to.getTime() / 1000;
    return sparkline(
      tx,
      sql`
        SELECT width_bucket(extract(epoch FROM closed_at), ${fromEpoch}, ${toEpoch}, 12) AS idx,
               AVG(total_amount::numeric) AS v
        FROM sales
        WHERE status <> 'cancelled'
          AND closed_at >= ${range.from} AND closed_at < ${range.to}
        GROUP BY 1
      `,
    );
  },

  // ---- Bloco E (evolução comercial) ----

  // Buckets com as 3 séries (leads cadastrados, vendas qtd, vendas R$) na
  // granularidade adaptativa. generate_series garante buckets contíguos
  // (zeros onde não houve evento) pra a linha não ter buracos. Leads vêm de
  // journeys.created_at; vendas de sales.closed_at — agregadas separadamente
  // e costuradas por bucket. O front normaliza pra índice 100.
  evolutionBuckets: async (
    tx: Tx,
    range: PeriodRange,
    granularity: DashboardGranularity,
  ): Promise<EvolutionBucketRow[]> => {
    const { truncField, stepInterval } = bucketUnits(granularity);
    // Último instante do range (to é exclusivo) — trunca pro último bucket.
    const lastInstant = new Date(range.to.getTime() - 1);
    const res = await tx.execute<EvolutionBucketRow>(sql`
      WITH buckets AS (
        SELECT generate_series(
          date_trunc(${truncField}, ${range.from}::timestamp),
          date_trunc(${truncField}, ${lastInstant}::timestamp),
          ${stepInterval}::interval
        ) AS bucket_start
      ),
      leads AS (
        SELECT date_trunc(${truncField}, created_at) AS b, COUNT(*) AS n
        FROM journeys
        WHERE created_at >= ${range.from} AND created_at < ${range.to}
        GROUP BY 1
      ),
      sales_agg AS (
        SELECT date_trunc(${truncField}, closed_at) AS b,
               COUNT(*) AS n,
               SUM(total_amount::numeric) AS amt
        FROM sales
        WHERE status <> 'cancelled'
          AND closed_at >= ${range.from} AND closed_at < ${range.to}
        GROUP BY 1
      )
      SELECT
        to_char(b.bucket_start, 'YYYY-MM-DD') AS bucket_start,
        COALESCE(l.n, 0)::int AS leads,
        COALESCE(sa.n, 0)::int AS sales_count,
        COALESCE(sa.amt, 0)::text AS sales_amount
      FROM buckets b
      LEFT JOIN leads l ON l.b = b.bucket_start
      LEFT JOIN sales_agg sa ON sa.b = b.bucket_start
      ORDER BY b.bucket_start
    `);
    return res.rows;
  },

  // Ciclo médio lead→venda em dias: journey.created_at (lead) → closed_at
  // (venda fechada) pras journeys ganhas no range. Usa as próprias colunas da
  // journey — não precisa de journey_events. null quando não houve venda.
  leadToSaleCycleDays: async (
    tx: Tx,
    range: PeriodRange,
  ): Promise<number | null> => {
    const res = await tx.execute<{ cycle_days: string | null }>(sql`
      SELECT AVG(EXTRACT(EPOCH FROM (closed_at - created_at)) / 86400.0)::text AS cycle_days
      FROM journeys
      WHERE status = 'won' AND closed_at IS NOT NULL
        AND closed_at >= ${range.from} AND closed_at < ${range.to}
    `);
    const v = res.rows[0]?.cycle_days;
    return v == null ? null : Number(v);
  },

  // ---- Bloco B (funil de conversão) ----

  // Etapas 2/3/4 do funil (1=leads e 5=vendas reusam agregados dos cards).
  // Cada etapa filtra pelo timestamp do PRÓPRIO evento no range (não coorte
  // do lead) — modelagem do V1 (ver docs/dashboard-domain.md §B). Subqueries
  // escalares numa só ida ao banco; RLS aplica em cada tabela.
  funnelStageCounts: async (
    tx: Tx,
    range: PeriodRange,
  ): Promise<{
    eval_scheduled: number;
    eval_performed: number;
    quote_sent: number;
  }> => {
    const res = await tx.execute<{
      eval_scheduled: number;
      eval_performed: number;
      quote_sent: number;
    }>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM appointments
           WHERE kind = 'evaluation'
             AND created_at >= ${range.from} AND created_at < ${range.to}) AS eval_scheduled,
        (SELECT COUNT(*)::int FROM evaluations
           WHERE status = 'performed' AND performed_at IS NOT NULL
             AND performed_at >= ${range.from} AND performed_at < ${range.to}) AS eval_performed,
        (SELECT COUNT(*)::int FROM quotes
           WHERE status <> 'draft' AND sent_at IS NOT NULL
             AND sent_at >= ${range.from} AND sent_at < ${range.to}) AS quote_sent
    `);
    return res.rows[0]!;
  },

  // Tempos médios entre etapas (em dias) via journey_events — vocabulário
  // canônico (shared/journeys/eventTypes.ts): journey_created → evaluation_done
  // → quote_sent → sale_closed. Pivota o primeiro timestamp de cada tipo por
  // journey e tira a média do delta, filtrando pelo evento FINAL caindo no
  // range. null quando não há journeys qualificadas (AVG de FILTER vazio).
  funnelTransitions: async (
    tx: Tx,
    range: PeriodRange,
  ): Promise<{
    lead_to_eval: string | null;
    eval_to_quote: string | null;
    quote_to_sale: string | null;
  }> => {
    const res = await tx.execute<{
      lead_to_eval: string | null;
      eval_to_quote: string | null;
      quote_to_sale: string | null;
    }>(sql`
      WITH ev AS (
        SELECT journey_id,
          MIN(created_at) FILTER (WHERE event_type = 'journey_created') AS t_lead,
          MIN(created_at) FILTER (WHERE event_type = 'evaluation_done') AS t_eval,
          MIN(created_at) FILTER (WHERE event_type = 'quote_sent') AS t_quote,
          MIN(created_at) FILTER (WHERE event_type = 'sale_closed') AS t_sale
        FROM journey_events
        WHERE event_type IN ('journey_created', 'evaluation_done', 'quote_sent', 'sale_closed')
        GROUP BY journey_id
      )
      SELECT
        AVG(EXTRACT(EPOCH FROM (t_eval - t_lead)) / 86400.0)
          FILTER (WHERE t_lead IS NOT NULL AND t_eval IS NOT NULL AND t_eval >= t_lead
                    AND t_eval >= ${range.from} AND t_eval < ${range.to})::text AS lead_to_eval,
        AVG(EXTRACT(EPOCH FROM (t_quote - t_eval)) / 86400.0)
          FILTER (WHERE t_eval IS NOT NULL AND t_quote IS NOT NULL AND t_quote >= t_eval
                    AND t_quote >= ${range.from} AND t_quote < ${range.to})::text AS eval_to_quote,
        AVG(EXTRACT(EPOCH FROM (t_sale - t_quote)) / 86400.0)
          FILTER (WHERE t_quote IS NOT NULL AND t_sale IS NOT NULL AND t_sale >= t_quote
                    AND t_sale >= ${range.from} AND t_sale < ${range.to})::text AS quote_to_sale
      FROM ev
    `);
    return res.rows[0]!;
  },

  // ---- Bloco C (distribuição) ----

  // C2 — leads por origem (journeys.source) no range. Códigos em inglês; o
  // front traduz pra PT-BR na exibição.
  leadsBySource: async (
    tx: Tx,
    range: PeriodRange,
  ): Promise<Array<{ source: string; count: number }>> => {
    const res = await tx.execute<{ source: string; count: number }>(sql`
      SELECT source, COUNT(*)::int AS count
      FROM journeys
      WHERE created_at >= ${range.from} AND created_at < ${range.to}
      GROUP BY source
      ORDER BY count DESC
    `);
    return res.rows;
  },

  // C3 — top 5 motivos de perda (journeys.lost_reason) das journeys perdidas
  // no range (closed_at = momento da perda). null vira 'unknown'.
  lostReasons: async (
    tx: Tx,
    range: PeriodRange,
  ): Promise<Array<{ reason: string; count: number }>> => {
    const res = await tx.execute<{ reason: string; count: number }>(sql`
      SELECT COALESCE(lost_reason, 'unknown') AS reason, COUNT(*)::int AS count
      FROM journeys
      WHERE status = 'lost' AND closed_at IS NOT NULL
        AND closed_at >= ${range.from} AND closed_at < ${range.to}
      GROUP BY COALESCE(lost_reason, 'unknown')
      ORDER BY count DESC
      LIMIT 5
    `);
    return res.rows;
  },

  // C4 — mix de métodos de pagamento (payments pagos no range).
  paymentMethods: async (
    tx: Tx,
    range: PeriodRange,
  ): Promise<Array<{ method: string; count: number; amount: string }>> => {
    const res = await tx.execute<{
      method: string;
      count: number;
      amount: string;
    }>(sql`
      SELECT payment_method AS method,
             COUNT(*)::int AS count,
             COALESCE(SUM(amount::numeric), 0)::text AS amount
      FROM payments
      WHERE status = 'paid' AND paid_at IS NOT NULL
        AND paid_at >= ${range.from} AND paid_at < ${range.to}
      GROUP BY payment_method
      ORDER BY SUM(amount::numeric) DESC
    `);
    return res.rows;
  },

  // C5 — distribuição de leads por substage (snapshot do kanban). IGNORA o
  // filtro global: conta journeys atualmente em stage='lead' por substage.
  leadSubstages: async (
    tx: Tx,
  ): Promise<Array<{ substage: string; count: number }>> => {
    const res = await tx.execute<{ substage: string; count: number }>(sql`
      SELECT lead_substage AS substage, COUNT(*)::int AS count
      FROM journeys
      WHERE stage = 'lead' AND lead_substage IS NOT NULL
      GROUP BY lead_substage
      ORDER BY count DESC
    `);
    return res.rows;
  },

  // ---- Bloco D (operacional / alertas) — semântica fixa, IGNORA o filtro ----

  // D1 — parcelas a vencer (próx 7d) + inadimplentes (vencidas até 60d atrás).
  // Vencidas (is_overdue) sobem por due_date ASC. Janela fixa (impl. doc §8).
  operationalUpcomingPayments: async (
    tx: Tx,
  ): Promise<
    Array<{
      id: string;
      sale_id: string;
      client_name: string;
      amount: string;
      due_date: string;
      installment: string;
      is_overdue: boolean;
    }>
  > => {
    const res = await tx.execute<{
      id: string;
      sale_id: string;
      client_name: string;
      amount: string;
      due_date: string;
      installment: string;
      is_overdue: boolean;
    }>(sql`
      SELECT
        p.id,
        p.sale_id,
        c.name AS client_name,
        p.amount::text AS amount,
        to_char(p.due_date, 'YYYY-MM-DD') AS due_date,
        p.installment_number || '/' || p.total_installments AS installment,
        (p.due_date < CURRENT_DATE) AS is_overdue
      FROM payments p
      JOIN sales s ON s.id = p.sale_id
      JOIN clients c ON c.id = s.client_id
      WHERE p.status = 'pending'
        AND p.due_date >= CURRENT_DATE - INTERVAL '60 days'
        AND p.due_date <= CURRENT_DATE + INTERVAL '7 days'
      ORDER BY p.due_date ASC
      LIMIT 20
    `);
    return res.rows;
  },

  // D2 — avaliações agendadas pra hoje/amanhã (status não-terminal).
  operationalUpcomingEvaluations: async (
    tx: Tx,
  ): Promise<
    Array<{
      id: string;
      client_name: string;
      // `tx.execute` não parseia datas (driver Drizzle desliga o parser do pg
      // — quem converte é o query builder por coluna). Timestamp volta como
      // string; o Service faz `new Date(...).toISOString()`.
      scheduled_at: string;
      professional: string | null;
    }>
  > => {
    const res = await tx.execute<{
      id: string;
      client_name: string;
      scheduled_at: string;
      professional: string | null;
    }>(sql`
      SELECT
        a.id,
        c.name AS client_name,
        a.scheduled_at,
        u.name AS professional
      FROM appointments a
      JOIN clients c ON c.id = a.client_id
      LEFT JOIN users u ON u.id = a.professional_id
      WHERE a.kind = 'evaluation'
        AND a.scheduled_at >= NOW()
        AND a.scheduled_at < date_trunc('day', NOW()) + INTERVAL '2 days'
        AND a.status NOT IN ('cancelled', 'no_show', 'attended')
      ORDER BY a.scheduled_at ASC
      LIMIT 20
    `);
    return res.rows;
  },

  // D3 — conversas sem resposta há >2h. Última mensagem relevante (inbound ou
  // outbound, ignora internal_note) por conversa via DISTINCT ON; flag quando
  // essa última é inbound e mais velha que 2h (= cliente sem resposta).
  operationalUnansweredConversations: async (
    tx: Tx,
  ): Promise<
    Array<{
      conversation_id: string;
      client_name: string;
      // String (não Date) — ver nota em operationalUpcomingEvaluations.
      last_inbound_at: string;
      preview: string;
    }>
  > => {
    const res = await tx.execute<{
      conversation_id: string;
      client_name: string;
      last_inbound_at: string;
      preview: string;
    }>(sql`
      WITH last_msg AS (
        SELECT DISTINCT ON (m.conversation_id)
          m.conversation_id,
          m.body,
          m.direction,
          m.created_at
        FROM messages m
        WHERE m.deleted_at IS NULL
          AND m.direction IN ('inbound', 'outbound')
        ORDER BY m.conversation_id, m.created_at DESC
      )
      SELECT
        lm.conversation_id,
        c.name AS client_name,
        lm.created_at AS last_inbound_at,
        LEFT(COALESCE(lm.body, ''), 80) AS preview
      FROM last_msg lm
      JOIN conversations conv ON conv.id = lm.conversation_id
      JOIN clients c ON c.id = conv.client_id
      WHERE lm.direction = 'inbound'
        AND lm.created_at < NOW() - INTERVAL '2 hours'
      ORDER BY lm.created_at ASC
      LIMIT 20
    `);
    return res.rows;
  },
};
