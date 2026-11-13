export { createDb, type Db, type DbConfig, type DbHandle, type Tx } from './createDb.js';
export { withTenant } from './tenantContext.js';
export { searchInColumns } from './queryHelpers.js';
export {
  LEAD_SUBSTAGES,
  computeLeadSubstage,
  recomputeLeadSubstage,
  setLeadSubstageManual,
  isLeadSubstage,
  type LeadSubstage,
  type RecomputeLeadSubstageOptions,
} from './leadSubstage.js';
export {
  REOPEN_WINDOW_DAYS,
  tryReopenJourneyForClient,
  type ReopenResult,
} from './journeyReopen.js';
export {
  // tenancy
  groups,
  menuGroups,
  menus,
  menuTenants,
  reportGroups,
  reportTenants,
  reports,
  roleCodeEnum,
  tenants,
  units,
  userGroups,
  userUnits,
  users,
  // chat domain — catálogo e clientes
  equipments,
  procedures,
  clients,
  // chat domain — fichas/anamneses
  formTemplates,
  formQuestions,
  clientForms,
  formAnswers,
  formQuestionTypeEnum,
  clientFormStatusEnum,
  // chat domain — conversations e journeys
  conversations,
  journeys,
  journeyEvents,
  journeyStageEnum,
  journeySourceEnum,
  journeyStatusEnum,
  leadSubstageEnum,
  // chat domain — agendas unificadas (appointments polimórfico + evaluations)
  appointments,
  evaluations,
  appointmentStatusEnum,
  appointmentKindEnum,
  evaluationStatusEnum,
  evaluationKindEnum,
  // chat domain — orçamentos
  quotes,
  quoteItems,
  quoteOriginEnum,
  quoteStatusEnum,
  // chat domain — vendas e parcelas
  sales,
  saleItems,
  payments,
  saleStatusEnum,
  paymentStatusEnum,
  paymentMethodEnum,
  // chat domain — tratamentos e sessões
  treatments,
  procedureSessions,
  treatmentProcedures,
  treatmentStatusEnum,
  procedureSessionStatusEnum,
  // chat domain — presença assinada de sessões
  procedureSessionAttendances,
  procedureSessionAttendanceSessions,
  procedureSessionSigningTokens,
  // chat domain — mensagens e templates
  messages,
  // notificações Web Push do chat (apps/core)
  pushSubscriptions,
  messageTemplates,
  messageDirectionEnum,
  messageKindEnum,
  messageMediaTypeEnum,
  messageDeletionOriginEnum,
  messageDeliveryStatusEnum,
  messageFailureReasonEnum,
  messageTemplateKindEnum,
  // automações
  automations,
  automationTriggerTypeEnum,
  // disponibilidade do profissional
  professionalSchedules,
  scheduleExceptions,
  weekdayEnum,
  scheduleExceptionKindEnum,
  // chat domain — contratos digitais (assinatura via ZapSign)
  contracts,
  contractTemplates,
  consentTemplateProcedures,
  contractKindEnum,
  contractStatusEnum,
  // whatsapp transport
  whatsappChannels,
  whatsappContacts,
  whatsappConversations,
  whatsappMessages,
  whatsappTemplates,
  whatsappProviderTypeEnum,
  whatsappMessageDirectionEnum,
  // agente de IA (V1, 2026-06) — ver docs/ai-agent-implementation.md
  agentTurns,
  agentTriggerTypeEnum,
  conversationTags,
  conversationTagAssignments,
} from './schema.js';

export type {
  ClientAddress,
  UserPreferences,
  BusinessHours,
  AgentToolCallRecord,
} from './schema.js';

// Helpers do Drizzle re-exportados — apps importam tudo de @elora/db.
export {
  and,
  asc,
  between,
  desc,
  eq,
  exists,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  lte,
  ne,
  not,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
export type {
  AnyColumn,
  InferInsertModel,
  InferSelectModel,
  SQL,
} from 'drizzle-orm';
