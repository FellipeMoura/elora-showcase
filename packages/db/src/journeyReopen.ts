import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from './createDb.js';
import { journeyEvents, journeys } from './schema.js';
import type { InferSelectModel } from 'drizzle-orm';

// =====================================================================
// Reabertura excepcional de journey por inbound espontâneo (chat-domain.md
// §5.6 ext.).
//
// Regra: cliente perdeu contato (`status='lost'`) mas volta a mandar inbound
// dentro de uma janela de REOPEN_WINDOW_DAYS dias → reabre a journey perdida
// mais recente em vez de criar nova. Inferência: cliente está retomando o
// contexto anterior, não começando do zero.
//
// Diferenciação com `source='recycling'`:
//   - inbound espontâneo (cliente toma iniciativa)  → reabre journey original
//   - empresa retoma (recepcionista decide ofertar) → cria journey nova com
//     source='recycling' (endpoint /leads/:id/recycle do core)
//
// O que muda na reabertura:
//   status:         'lost' → 'active'
//   closedAt:       set → null
//   lostReason:     PRESERVADO (vira flag UI "lead reaberto")
//   lastActivityAt: NOW()
//   leadSubstage:   NÃO setado aqui — cascata do MessagesService recompute
//                   logo em seguida (inbound já registrado pelo caller).
//
// `won` NUNCA reabre — selo final de sucesso. Cliente que terminou tratamento
// e volta abre journey nova (1 cliente : N journeys, princípio do schema).
// =====================================================================

export const REOPEN_WINDOW_DAYS = 60;

type Journey = InferSelectModel<typeof journeys>;

export interface ReopenResult {
  journey: Journey;
  previousLostReason: string | null;
  daysClosed: number;
}

// Procura a journey mais recente do cliente em status='lost' fechada há menos
// de REOPEN_WINDOW_DAYS. Se achar, reabre e retorna; senão retorna null.
//
// Caller é responsável por verificar primeiro se cliente JÁ tem journey
// active — se tiver, nem chama esse helper.
export async function tryReopenJourneyForClient(
  tx: Tx,
  clientId: string,
  actorUserId?: string | null
): Promise<ReopenResult | null> {
  const cutoff = new Date(Date.now() - REOPEN_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [candidate] = await tx
    .select()
    .from(journeys)
    .where(
      and(
        eq(journeys.clientId, clientId),
        eq(journeys.status, 'lost'),
        sql`${journeys.closedAt} IS NOT NULL`,
        sql`${journeys.closedAt} >= ${cutoff.toISOString()}`
      )
    )
    .orderBy(sql`${journeys.closedAt} DESC`)
    .limit(1);

  if (!candidate) return null;

  const previousLostReason = candidate.lostReason;
  const closedAt = candidate.closedAt;
  const daysClosed = closedAt
    ? Math.floor((Date.now() - closedAt.getTime()) / (24 * 60 * 60 * 1000))
    : 0;

  const now = new Date();
  const [reopened] = await tx
    .update(journeys)
    .set({
      status: 'active',
      closedAt: null,
      // lostReason PRESERVADO (flag de "reaberta" na UI).
      lastActivityAt: now,
    })
    .where(eq(journeys.id, candidate.id))
    .returning();

  if (!reopened) throw new Error('Falha ao reabrir jornada');

  await tx.insert(journeyEvents).values({
    tenantId: candidate.tenantId,
    journeyId: candidate.id,
    eventType: 'reopened_from_inbound',
    payload: {
      previousLostReason,
      previousClosedAt: closedAt?.toISOString() ?? null,
      daysClosed,
    } as Record<string, unknown>,
    actorUserId: actorUserId ?? null,
  });

  return {
    journey: reopened,
    previousLostReason,
    daysClosed,
  };
}
