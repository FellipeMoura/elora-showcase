import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Tx } from './createDb.js';
import {
  appointments,
  journeyEvents,
  journeys,
  messages,
  quotes,
} from './schema.js';

// =====================================================================
// Lead substage — sub-etapa do funil de lead (chat-domain.md §5.1, ext.).
//
// Só faz sentido quando `journeys.stage = 'lead'`. Coluna `lead_substage`
// fica null nos demais stages. Mantida atualizada via recompute idempotente
// que inspeciona messages / appointments (kind=evaluation) / quotes e
// escolhe o substage máximo aplicável pela ordem de precedência:
//
//   quoted > rescheduled > no_show > scheduled > contact > template > new
//
// Cada service que muta entidade relevante chama `recomputeLeadSubstage`
// no fim da transação. Idempotente — se já está correto, no-op.
//
// Quando journey avança pra stage != lead, helper de transição limpa o
// substage (ver applyStageTransition).
// =====================================================================

export const LEAD_SUBSTAGES = [
  'new',
  'template',
  'contact',
  'scheduled',
  'no_show',
  'rescheduled',
  'quoted',
] as const;

export type LeadSubstage = (typeof LEAD_SUBSTAGES)[number];

const LEAD_SUBSTAGE_SET: ReadonlySet<LeadSubstage> = new Set(LEAD_SUBSTAGES);

export function isLeadSubstage(value: string): value is LeadSubstage {
  return LEAD_SUBSTAGE_SET.has(value as LeadSubstage);
}

// =====================================================================
// Compute — read-only. Retorna o substage que a journey DEVERIA ter agora
// baseado no estado de messages/appointments/quotes. Não escreve nada.
// =====================================================================

interface ComputeContext {
  tenantId: string;
  clientId: string;
}

export async function computeLeadSubstage(
  tx: Tx,
  journeyId: string,
  ctx: ComputeContext
): Promise<LeadSubstage> {
  // 1. quoted — quote ainda VIVO (sent ou accepted). Rejected/expired não
  // contam: orçamento recusado/vencido ≠ "está com orçamento na mão". Lead
  // pode ter histórico de rejected/expired e ainda assim cair pra 'contact'
  // se não tem nada ativo na mesa.
  const [quoteRow] = await tx
    .select({ id: quotes.id })
    .from(quotes)
    .where(
      and(
        eq(quotes.journeyId, journeyId),
        inArray(quotes.status, ['sent', 'accepted'])
      )
    )
    .limit(1);
  if (quoteRow) return 'quoted';

  // 2-4. appointments kind=evaluation desta journey. Olhamos em uma só query
  //      pra extrair: total, com no_show, futuros.
  const now = new Date();
  const apptRows = await tx
    .select({
      id: appointments.id,
      status: appointments.status,
      scheduledAt: appointments.scheduledAt,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.journeyId, journeyId),
        eq(appointments.kind, 'evaluation')
      )
    )
    .orderBy(desc(appointments.scheduledAt));

  if (apptRows.length > 0) {
    const futureActive = apptRows.find(
      (a) => a.scheduledAt > now && a.status !== 'cancelled' && a.status !== 'no_show'
    );
    const hasNoShow = apptRows.some((a) => a.status === 'no_show');
    const hasFutureAfterNoShow =
      hasNoShow &&
      apptRows.some(
        (a) =>
          a.scheduledAt > now &&
          a.status !== 'cancelled' &&
          a.status !== 'no_show'
      );

    // rescheduled — houve no_show E existe um novo agendamento futuro ativo.
    if (hasFutureAfterNoShow) return 'rescheduled';
    // no_show — houve no_show e não há reagendamento futuro ativo.
    if (hasNoShow) return 'no_show';
    // scheduled — existe ao menos um appointment futuro ativo.
    if (futureActive) return 'scheduled';
    // Caso degenerado: todos os appointments são passados sem no_show
    // (provavelmente cancelados). Não muda o substage por causa disso —
    // cai pra análise de messages abaixo.
  }

  // 5-7. messages — outbound staff vs inbound cliente.
  //      `direction='internal_note'` não conta (não atinge cliente).
  //      Soft-deleted (`deletedAt`) ainda conta — a interação aconteceu.
  //
  // Regra (semântica de "estabeleceu comunicação"):
  //   - 'contact'  = existe outbound E existe inbound (em qualquer ordem).
  //                  Houve troca bidirecional. Cliente que iniciou e recebeu
  //                  resposta cai aqui (não fica em template). Da mesma forma,
  //                  staff que mandou primeiro, cliente respondeu e staff
  //                  voltou a mandar continua em 'contact' — uma vez
  //                  estabelecida a comunicação, não regride pra template.
  //   - 'template' = existe outbound MAS nenhum inbound. Outreach frio
  //                  (Cloud=template literal, Baileys=texto livre) sem
  //                  resposta do cliente ainda.
  //   - 'new'      = não há outbound da staff. Pode ter inbound (lead novo
  //                  esperando primeira resposta) ou nada (caso degenerado).
  const [outboundRow] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, ctx.tenantId),
        eq(messages.journeyId, journeyId),
        eq(messages.direction, 'outbound')
      )
    )
    .limit(1);

  if (!outboundRow) return 'new';

  const [inboundRow] = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.tenantId, ctx.tenantId),
        eq(messages.journeyId, journeyId),
        eq(messages.direction, 'inbound')
      )
    )
    .limit(1);

  return inboundRow ? 'contact' : 'template';
}

// =====================================================================
// Recompute — mutation. Compara com persisted, atualiza se mudou, emite
// `journey_event: lead_substage_changed`. Idempotente e barato — se nada
// mudou, retorna sem escrever.
//
// Caller passa `reason` pra ajudar debug (ex: 'outbound_sent',
// 'appointment_no_show', 'quote_created', 'manual'). Vai pro payload do
// event.
//
// Só age quando `stage='lead'`. Em outros stages, retorna no-op
// (defensive — caller geralmente já checa).
// =====================================================================

export interface RecomputeLeadSubstageOptions {
  reason: string;
  actorUserId?: string | null;
}

export async function recomputeLeadSubstage(
  tx: Tx,
  journeyId: string,
  options: RecomputeLeadSubstageOptions
): Promise<LeadSubstage | null> {
  const [journey] = await tx
    .select({
      id: journeys.id,
      tenantId: journeys.tenantId,
      clientId: journeys.clientId,
      stage: journeys.stage,
      leadSubstage: journeys.leadSubstage,
    })
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .limit(1);

  if (!journey) return null;
  if (journey.stage !== 'lead') return null;

  const next = await computeLeadSubstage(tx, journeyId, {
    tenantId: journey.tenantId,
    clientId: journey.clientId,
  });

  if (journey.leadSubstage === next) return next;

  await tx
    .update(journeys)
    .set({ leadSubstage: next })
    .where(eq(journeys.id, journeyId));

  await tx.insert(journeyEvents).values({
    tenantId: journey.tenantId,
    journeyId: journey.id,
    eventType: 'lead_substage_changed',
    payload: {
      from: journey.leadSubstage,
      to: next,
      reason: options.reason,
    } as Record<string, unknown>,
    actorUserId: options.actorUserId ?? null,
  });

  return next;
}

// =====================================================================
// Override manual — admin tool. Persiste explicitamente o substage sem
// passar pelo compute. Registra event com reason='manual_override'.
// Cascata subsequente pode reescrever (sem flag de lock — comportamento
// intencional pra evitar drift permanente).
// =====================================================================

export async function setLeadSubstageManual(
  tx: Tx,
  journeyId: string,
  to: LeadSubstage,
  actorUserId?: string | null
): Promise<LeadSubstage | null> {
  const [journey] = await tx
    .select({
      id: journeys.id,
      tenantId: journeys.tenantId,
      stage: journeys.stage,
      leadSubstage: journeys.leadSubstage,
    })
    .from(journeys)
    .where(eq(journeys.id, journeyId))
    .limit(1);

  if (!journey) return null;
  if (journey.stage !== 'lead') return null;
  if (journey.leadSubstage === to) return to;

  await tx
    .update(journeys)
    .set({ leadSubstage: to })
    .where(eq(journeys.id, journeyId));

  await tx.insert(journeyEvents).values({
    tenantId: journey.tenantId,
    journeyId: journey.id,
    eventType: 'lead_substage_changed',
    payload: {
      from: journey.leadSubstage,
      to,
      reason: 'manual_override',
    } as Record<string, unknown>,
    actorUserId: actorUserId ?? null,
  });

  return to;
}

