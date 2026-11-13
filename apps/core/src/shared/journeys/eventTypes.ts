// =====================================================================
// Vocabulário canônico de `journey_events.event_type` (chat-domain.md §16.5).
//
// O schema mantém varchar livre, mas o app emite apenas estes valores.
// Adicionar evento novo aqui = atualizar §16.5 do doc no mesmo PR.
// =====================================================================

export const JOURNEY_EVENT_TYPES = [
  // Ciclo da journey
  'journey_created',
  'stage_transitioned',
  'lead_substage_changed',
  'marked_won',
  'marked_lost',
  // Reabertura excepcional (chat-domain.md §5.6 ext.): cliente perdeu contato
  // por <60d e mandou inbound espontâneo. Journey lost mais recente vira active
  // de novo, preserva `lostReason` como flag visual de "reaberta".
  'reopened_from_inbound',
  // Sub-entidades — gravadas como parte do timeline da journey
  'evaluation_created',
  'evaluation_scheduled',
  'evaluation_done',
  'form_completed',
  'quote_created',
  'quote_sent',
  // Reversão `sent → draft`. Permite editar items/condições depois do envio
  // sem precisar criar um quote novo. Quote volta a draft e perde sentAt.
  'quote_reverted_to_draft',
  'sale_closed',
  'quote_rejected',
  // Hard-delete de quote em status='draft' pela UI. Necessário pra fechar o
  // par com `quote_created` no timeline — sem ele, o evento de criação fica
  // órfão (referencia um quote.id que sumiu).
  'quote_deleted',
  'treatment_started',
  'treatment_completed',
  'treatment_abandoned',
  'treatment_manually_closed',
  // Recycling
  'recycled_from',
] as const;

export type JourneyEventType = (typeof JOURNEY_EVENT_TYPES)[number];

// Conjunto pra runtime check em endpoints que aceitam event_type vindo do
// cliente (raro — só em queries de filtro). Insert de events sempre passa
// pelos helpers, que recebem JourneyEventType tipado.
export const JOURNEY_EVENT_TYPE_SET: ReadonlySet<JourneyEventType> = new Set(
  JOURNEY_EVENT_TYPES
);

export function isJourneyEventType(value: string): value is JourneyEventType {
  return JOURNEY_EVENT_TYPE_SET.has(value as JourneyEventType);
}
