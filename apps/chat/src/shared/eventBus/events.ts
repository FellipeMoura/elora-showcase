// Tipos canônicos extraídos pra `@elora/events-contracts` (pacote
// workspace) pra serem compartilhados entre chat (publisher) e core
// (consumer) — ver arquitetura.md §13.9.
//
// Mantemos este arquivo apenas como re-export pra não quebrar imports
// existentes (`from './events.js'`). Quando refatorar os call sites pra
// importar direto de `@elora/events-contracts`, esse arquivo some.
export {
  EVENT_CHANNELS,
  type EventChannel,
  type EventPayloadByChannel,
  type WhatsappChannelConnectionChangedEvent,
  type WhatsappMessageReceivedEvent,
  type WhatsappMessageRevokedEvent,
  type WhatsappMessageSentEvent,
  type WhatsappStatusUpdatedEvent,
  SOCKET_ROOMS,
} from '@elora/events-contracts';
