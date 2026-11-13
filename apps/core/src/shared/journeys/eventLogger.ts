import { eq, journeyEvents, journeys, type Tx } from '@elora/db';
import type { JourneyEventType } from './eventTypes.js';

// =====================================================================
// Helpers compartilhados pra registrar eventos e atividade em journeys.
// Usados por Services de módulos que mutam sub-entidades (forms, quotes,
// appointments, sessions) e precisam alimentar a timeline da journey
// associada (chat-domain.md §16.5, §10.1).
//
// Convenções:
//   - Recebem `tx` já transacional (caller usa withTenant).
//   - Não fazem look-up da journey ativa — caller passa journeyId.
//     Pra resolver "journey ativa do cliente", usar JourneysQuery
//     direto no caller.
// =====================================================================

export interface RecordJourneyEventParams {
  tenantId: string;
  journeyId: string;
  eventType: JourneyEventType;
  payload?: Record<string, unknown>;
  actorUserId?: string | null;
}

export async function recordJourneyEvent(
  tx: Tx,
  params: RecordJourneyEventParams
): Promise<void> {
  await tx.insert(journeyEvents).values({
    tenantId: params.tenantId,
    journeyId: params.journeyId,
    eventType: params.eventType,
    payload: (params.payload ?? {}) as Record<string, unknown>,
    actorUserId: params.actorUserId ?? null,
  });
}

// Atualiza `journeys.last_activity_at = now()`. Chamado em toda ação de
// staff que conta como atividade (chat-domain.md §10.1). Inbound do
// cliente NÃO chama isso — só ações de staff.
export async function touchJourneyActivity(tx: Tx, journeyId: string): Promise<void> {
  await tx
    .update(journeys)
    .set({ lastActivityAt: new Date() })
    .where(eq(journeys.id, journeyId));
}
