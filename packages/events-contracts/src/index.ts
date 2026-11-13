// =====================================================================
// Eventos canônicos publicados pelo apps/chat via Redis pub/sub e
// consumidos pelo apps/core (que repassa pros sockets dos clientes).
//
// Mudança de evento = mudança aqui = ambos os apps atualizam no mesmo PR.
// Versionar via novos campos opcionais quando possível (chat publica novos
// campos antes do core ler — backwards-compat segura).
// =====================================================================

export const EVENT_CHANNELS = {
  whatsappMessageReceived: 'wa.message.received',
  whatsappMessageSent: 'wa.message.sent',
  whatsappStatusUpdated: 'wa.status.updated',
  // Publicado quando whatsapp_channels.connection_state muda. Core repassa
  // pra sala tenant:{tenantId} via socket — UI mostra indicador de estado
  // do canal sem polling. Eventos com mesmo state são deduplicados no chat
  // (UPDATE só atualiza se state mudou).
  whatsappChannelConnectionChanged: 'wa.channel.connection_changed',
  // Mensagem foi revogada (soft delete). Dispara tanto quando staff aciona
  // DELETE /messages/:id (origin='staff') quanto quando cliente apaga pelo
  // próprio app (origin='client'). Core repassa pra sala da conversa pra
  // UI marcar a bolha como apagada em tempo real. Edição NÃO publica evento
  // por decisão de projeto — automações não re-disparam em edit.
  whatsappMessageRevoked: 'wa.message.revoked',
  // Lead novo entrou via canal NÃO-WhatsApp (form, sheets, manual, recycling,
  // imported, other). Publisher é o apps/core (helper `createExternalLead`),
  // não o apps/chat — esse evento atravessa a outra direção do pub/sub. Core
  // repassa pra sala tenant:{id}; frontend usa pra invalidar caches de leads
  // (badge + board) e disparar toast condicional (exceto `manual` e
  // `imported` — esses só atualizam estado, sem barulho). WhatsApp NÃO emite
  // esse evento porque o pipeline inbound já publica `wa.message.received`,
  // que o frontend usa pra invalidar leads também.
  leadCreated: 'lead.created',
  // Bolha outbound recém-inserida em `messages` com delivery_status='pending'
  // — a UI vai mostrar imediatamente com spinner. A sessão que disparou o POST
  // recebe a row via HTTP response; este evento é pra que OUTRAS abas/devices
  // do mesmo staff (ou outros operadores na clínica) também vejam a bolha
  // aparecer em tempo real. Vai sair antes do envio real ao WhatsApp; o
  // resultado final chega via `wa.message.status_changed`.
  messageCreated: 'message.created',
  // Transição de delivery_status de uma mensagem outbound — emitido pelo
  // OutboundDeliveryWorker quando o resultado do envio é conhecido. Cobre
  // todas as transições terminais (pending → sent | failed | rejected). A
  // distinção `failed` vs `rejected` vai em `deliveryStatus`, e o motivo
  // específico em `failureReason` (mapeado pra ação contextual no UI).
  //
  // Nota: `wa.message.sent` continua sendo emitido APENAS quando status='sent'
  // (mantém compat com listeners de cascata journey/lead). Quem só quer saber
  // de sucesso pode continuar escutando `wa.message.sent`; quem quer reagir
  // a qualquer transição (UI da bolha) escuta este.
  whatsappMessageStatusChanged: 'wa.message.status_changed',
  // Transição de status de um contrato — emitido pelo apps/core quando o
  // webhook do provider de assinatura (ZapSign) reporta evento normalizado
  // (`viewed`, `signed`, `declined`, `expired`). Publisher é o apps/core,
  // não o chat. Frontend usa pra invalidar listas de contratos em tempo real
  // e disparar toast/notif em transições de alto valor (signed/declined).
  // Cancelamento manual (`cancelled`) NÃO emite por aqui em V1 — quem aciona
  // já recebe feedback pela própria mutation; outras abas/operadores
  // dependem do invalidate vir por refetch normal (TTL 30s do useContracts).
  contractStatusChanged: 'contract.status_changed',
  // Cliente assinou presença em sessão(ões) de procedimento via link público.
  // Publisher é o apps/core (AttendanceService.sign). Frontend usa pra
  // invalidar caches de appointments + procedureSessions e mostrar toast
  // "Presença registrada" na agenda. Sessões cobertas vão pra status='signed';
  // appointments vão pra status='attended'.
  procedureSessionAttendanceRecorded: 'procedure_session_attendance.recorded',
  // Aplicadora encerrou a evolução clínica de uma sessão (`signed` → `done`,
  // com `evolutionNotes` registrada). Publisher é o apps/core
  // (ProcedureSessionsService.evolve). Frontend usa pra invalidar caches de
  // procedureSessions + treatments + journeys + appointments (a session pode
  // ter sido a última do treatment — `treatmentCompleted` sinaliza esse caso
  // pra mostrar toast extra). Outros operadores na página /evolutions veem
  // o item sumir da lista em tempo real.
  procedureSessionEvolved: 'procedure_session.evolved',
  // Tags da conversa foram (re)aplicadas. Publisher é o apps/agent quando o
  // AgentRunner termina a classificação OU o apps/core no futuro quando UI
  // permitir humano atribuir tag manualmente. Frontend invalida cache da
  // conversa e atualiza chips visíveis sem refetch da lista inteira.
  conversationTagsUpdated: 'conversation.tags_updated',
} as const;

export type EventChannel = (typeof EVENT_CHANNELS)[keyof typeof EVENT_CHANNELS];

// Payload comum dos eventos do WhatsApp: campos suficientes pra o core
// decidir a qual sala socket publicar (tenant:${id}, conversation:${id})
// SEM outra query no DB. Dados detalhados (body da msg, status novo) o
// frontend busca via HTTP quando a notificação chega — evita inchar o
// payload do pub/sub.

export interface WhatsappMessageReceivedEvent {
  tenantId: string;
  channelId: string;
  whatsappConversationId: string;
  conversationId: string;
  whatsappMessageId: string;
  messageId: string;
  clientId: string;
  receivedAt: string; // ISO 8601 — JSON-friendly
  // True quando este inbound nasceu junto com uma journey ativa nova (cliente
  // sem journey ativa prévia OU journey 'lost' reaberta por contato espontâneo
  // — ver `tryReopenJourneyForClient`). Frontend usa pra renderizar notificação
  // "Novo Lead via WhatsApp" mesclada (foto + preview) em vez de notificação
  // comum de mensagem. WhatsApp não emite `lead.created` separado pra evitar
  // duplicidade — esse flag é a fonte única.
  isNewLead: boolean;
}

export interface WhatsappMessageSentEvent {
  tenantId: string;
  channelId: string;
  whatsappConversationId: string;
  conversationId: string;
  whatsappMessageId: string;
  messageId: string;
  clientId: string;
  // Null quando a mensagem foi enviada direto pelo celular pareado
  // (`authoredOnDevice=true`). Capturada pelo webhook MESSAGES_UPSERT
  // com `fromMe=true` e externalId desconhecido.
  authorUserId: string | null;
  authoredOnDevice: boolean;
  sentAt: string;
}

export interface WhatsappStatusUpdatedEvent {
  tenantId: string;
  channelId: string;
  // Conversa domain da mensagem — o core usa pra rotear (sem ele o evento
  // não é publicado).
  conversationId: string;
  whatsappMessageId: string;
  externalId: string;
  status: string;
  updatedAt: string;
}

export interface WhatsappChannelConnectionChangedEvent {
  tenantId: string;
  channelId: string;
  // Valores esperados: 'open' | 'connecting' | 'closed' | 'unknown'. String
  // crua pra não forçar enum no contrato (provider futuro pode adicionar
  // estados; cliente trata 'unknown' como fallback).
  state: string;
  changedAt: string;
}

export interface WhatsappMessageRevokedEvent {
  tenantId: string;
  channelId: string;
  conversationId: string;
  messageId: string;
  // 'staff' = clínica clicou em apagar; 'client' = cliente apagou no app
  // dele. UI usa pra escolher o texto da notificação ("Você apagou esta
  // mensagem" vs "Esta mensagem foi apagada"). 'system' fica reservado pra
  // remoções automáticas futuras (compliance, retention) — não emitido V1.
  origin: 'staff' | 'client' | 'system';
  deletedAt: string;
}

// Lead criado via canal non-WhatsApp. `source` cobre as origens manuais e
// integradas (form, sheets, manual, recycling, imported, other) — o frontend
// usa esse campo pra decidir se exibe toast (form/sheets/recycling/other =
// sim; manual/imported = não, mas o invalidate de cache roda igual). WhatsApp
// não emite por aqui: inbound do pipeline já notifica via wa.message.received.
export interface LeadCreatedEvent {
  tenantId: string;
  journeyId: string;
  clientId: string;
  clientName: string;
  source:
    | 'form'
    | 'sheets'
    | 'manual'
    | 'recycling'
    | 'imported'
    | 'other';
  createdAt: string;
}

// Bolha pending inserida em messages antes do envio real ao WhatsApp.
// `channelId` opcional porque mensagens 'internal_note' não passam por canal
// — V1 só emite pra outbound (sempre tem channel resolvido via contato).
export interface MessageCreatedEvent {
  tenantId: string;
  channelId: string;
  conversationId: string;
  messageId: string;
  clientId: string;
  // Null se foi disparada via integração (futuro: automações server-side).
  authorUserId: string | null;
  createdAt: string;
}

// Transição de delivery_status. `failureReason` só preenchido quando
// status ∈ ('failed','rejected'). `failureDetail` fica fora do payload — UI
// busca via HTTP (GET /messages/:id) se quiser exibir detalhe rico no tooltip.
export interface WhatsappMessageStatusChangedEvent {
  tenantId: string;
  channelId: string;
  conversationId: string;
  messageId: string;
  deliveryStatus: 'pending' | 'sent' | 'failed' | 'rejected';
  failureReason:
    | 'no_opt_in'
    | 'not_on_whatsapp'
    | 'channel_disconnected'
    | 'window_24h_expired'
    | 'invalid_template'
    | 'rate_limited'
    | 'provider_error'
    | 'worker_timeout'
    | 'unknown'
    | null;
  updatedAt: string;
}

// Status do ciclo de assinatura emitidos pelo webhook do provider. Mapeia
// 1-1 com `contract_status` da migration `0026`, exceto `draft`/`sent`/
// `cancelled`: `draft` é estado reservado pra fluxo futuro; `sent` é estado
// inicial (a criação dispara invalidate via mutation onSuccess, não evento);
// `cancelled` é acionado manualmente (ver comentário no canal).
export interface ContractStatusChangedEvent {
  tenantId: string;
  contractId: string;
  clientId: string;
  // Snapshot pra UI montar toast sem fetch extra. `clientName` e
  // `contractTitle` já são lidos pelo serviço dentro da mesma tx que faz o
  // update — incluir aqui evita roundtrip do frontend pra pintar a notif.
  clientName: string;
  contractTitle: string;
  status: 'viewed' | 'signed' | 'declined' | 'expired';
  changedAt: string;
}

// Presença assinada de sessão(ões) de procedimento. `signedSessionIds` carrega
// todas as sessões cobertas pela mesma assinatura — uma assinatura pode cobrir
// N sessões do mesmo cliente no mesmo dia. Frontend invalida cache de
// appointments + procedureSessions e exibe toast.
export interface ProcedureSessionAttendanceRecordedEvent {
  tenantId: string;
  attendanceId: string;
  clientId: string;
  attendanceDate: string;
  signedSessionIds: string[];
  signedAt: string;
}

// Evolução clínica encerrada — sessão saiu de `signed` pra `done`. Carrega
// `treatmentCompleted` pra UI saber se foi a última sessão do treatment (toast
// extra "Tratamento concluído"). Sem snapshot da nota: o payload pub/sub
// fica leve; UI re-fetcha session via HTTP quando quiser exibir.
export interface ProcedureSessionEvolvedEvent {
  tenantId: string;
  sessionId: string;
  clientId: string;
  evolvedAt: string;
  evolvedByUserId: string;
  treatmentCompleted: boolean;
}

// Snapshot leve das tags ativas atualmente na conversa — UI usa pra repintar
// os chips sem refetch. `source` distingue agente (classificação automática
// numa rodada) de humano (atribuição manual via UI, futuro). `tagIds` é o
// conjunto resultante completo (replace, não diff).
export interface ConversationTagsUpdatedEvent {
  tenantId: string;
  conversationId: string;
  tagIds: string[];
  source: 'agent' | 'human';
  // Quando source='agent', referência ao turn responsável — útil pra audit.
  agentTurnId: string | null;
  updatedAt: string;
}

export type EventPayloadByChannel = {
  [EVENT_CHANNELS.whatsappMessageReceived]: WhatsappMessageReceivedEvent;
  [EVENT_CHANNELS.whatsappMessageSent]: WhatsappMessageSentEvent;
  [EVENT_CHANNELS.whatsappStatusUpdated]: WhatsappStatusUpdatedEvent;
  [EVENT_CHANNELS.whatsappChannelConnectionChanged]: WhatsappChannelConnectionChangedEvent;
  [EVENT_CHANNELS.whatsappMessageRevoked]: WhatsappMessageRevokedEvent;
  [EVENT_CHANNELS.leadCreated]: LeadCreatedEvent;
  [EVENT_CHANNELS.messageCreated]: MessageCreatedEvent;
  [EVENT_CHANNELS.whatsappMessageStatusChanged]: WhatsappMessageStatusChangedEvent;
  [EVENT_CHANNELS.contractStatusChanged]: ContractStatusChangedEvent;
  [EVENT_CHANNELS.procedureSessionAttendanceRecorded]: ProcedureSessionAttendanceRecordedEvent;
  [EVENT_CHANNELS.procedureSessionEvolved]: ProcedureSessionEvolvedEvent;
  [EVENT_CHANNELS.conversationTagsUpdated]: ConversationTagsUpdatedEvent;
};

// Nomes canônicos das salas socket.io. Importante: TODAS são prefixadas
// pelo tenantId. Isolamento entre tenants vira impossível por construção:
// o socket só consegue subscrever em salas do próprio tenant (tenantId é
// pego do JWT verificado, não do input do cliente), e o publisher só emite
// pra sala do tenant correto (tenantId vem do payload do evento).
export const SOCKET_ROOMS = {
  tenant: (tenantId: string): string => `tenant:${tenantId}`,
  // Usuários com `chat:use` — todos os eventos de chat. Não há sala por
  // conversa: o cliente não escolhe sala, então conhecer o UUID de uma
  // conversa não dá acesso aos eventos dela.
  chat: (tenantId: string): string => `tenant:${tenantId}:chat`,
} as const;
