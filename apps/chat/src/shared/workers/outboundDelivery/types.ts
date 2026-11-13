// Payload do job BullMQ pro outbound delivery worker.
// O controller HTTP insere a row em `messages` (status='pending') e enfileira
// este job. O worker é quem chama Evolution, faz pre-flight, e atualiza o
// status final. Mantemos só `messageId` no payload porque tudo que o worker
// precisa pode ser carregado do DB — replay/debug fica trivial (basta o id).
export interface OutboundJobData {
  tenantId: string;
  conversationId: string;
  messageId: string;
}

export const OUTBOUND_QUEUE_NAME = 'outbound-messages' as const;

// Lock distribuído por conversation pra serializar envios dentro da mesma
// conv (preserva ordem). 60s cobre adapter Evolution travado; a chance de o
// lock expirar antes do release é baixa, e mesmo nesse caso a idempotência
// de whatsapp_messages por externalId evita duplicação real.
export const CONV_LOCK_TTL_SEC = 60;
export const CONV_LOCK_KEY_PREFIX = 'outbound:lock:conv:';
