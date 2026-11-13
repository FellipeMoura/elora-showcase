// Re-export do singleton padrão. Boot do app e tools importam daqui pra
// não conhecer a impl HTTP — facilita troca por mock em testes.
export { httpCoreClient as coreClient } from './HttpCoreClient.js';
export type {
  AssignTagsInput,
  ChatMessageSummary,
  CoreAppointmentSummary,
  CoreClient,
  CoreClientInfo,
  CoreFreeSlot,
  CoreProcedureInfo,
  CreateAppointmentInput,
  FreeSlotsQuery,
  SendMessageInput,
  TenantInfo,
} from './CoreClient.js';
export { tenantResolver } from './tenantResolver.js';
export { channelResolver, type ChannelInfo } from './channelResolver.js';
