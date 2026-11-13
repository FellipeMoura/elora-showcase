export { EvolutionAdapter, type EvolutionConfig } from './EvolutionAdapter.js';
export {
  evolutionAdmin,
  type EvolutionAdmin,
  type ConnectionStateResult,
  type CreateInstanceParams,
  type CreateInstanceResult,
  type QrCodeResult,
} from './EvolutionAdmin.js';
export type { IWhatsAppProvider } from './IWhatsAppProvider.js';
export { MockAdapter } from './MockAdapter.js';
export { createWhatsappProvider } from './providerFactory.js';
export type {
  InboundIgnoredEvent,
  InboundMessageEvent,
  InboundStatusEvent,
  MediaPayload,
  MessageRef,
  MessageStatus,
  NormalizedInboundEvent,
  OutboundMedia,
  OutboundTemplate,
  OutboundText,
  WebhookRequest,
} from './types.js';
export {
  mediaPayloadSchema,
  outboundMediaSchema,
  outboundTemplateSchema,
  outboundTextSchema,
} from './types.js';
