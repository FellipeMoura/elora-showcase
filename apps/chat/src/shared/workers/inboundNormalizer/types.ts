// Payload do job BullMQ pro inbound normalizer.
// É o que o webhook handler enfileira; o worker desserializa e processa.
// Mantemos rawPayload + tenantId + channelId (e nada mais) pra:
//   - permitir re-run do job sem depender de estado do request original
//   - replay manual em caso de bug (drop + reenqueue)
//   - debug forense (rawPayload está preservado)
export interface InboundJobData {
  tenantId: string;
  channelId: string;
  rawPayload: unknown;
  // Quando o webhook chegou. Usado se o evento normalizado não tiver
  // timestamp próprio (raro, mas alguns providers omitem).
  receivedAt: string;
}

export const INBOUND_QUEUE_NAME = 'whatsapp.inbound' as const;
