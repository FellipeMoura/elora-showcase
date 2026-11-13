// =====================================================================
// CoreClient — fronteira entre apps/agent e o que ele precisa de
// apps/core + apps/chat. Tudo via HTTP, com JWT de system agent user
// + Host header sintético do slug do tenant.
//
// Pattern espelha o `CoreGateway` do apps/chat (interface + impl), mas
// HTTP-only desde o V1 (agent não compartilha process com o DB do core
// pra justificar import direto de services).
//
// Tipos de resposta: shapes mínimos com o que os tools (PR 5-7) realmente
// usam. Quando a duplicação ficar custosa, formaliza em `@elora/agent-
// contracts` e re-exporta dos dois lados.
// =====================================================================

import type { TenantInfo } from './tenantResolver.js';

export type { TenantInfo };

// ---------- Clients (apps/core) ----------
export interface CoreClientInfo {
  id: string;
  tenantId: string;
  name: string;
  phoneE164: string | null;
  // Outros campos do client (cadastro, endereço, etc) ficam em `extra`
  // até virarem necessários — evita rebuild do typing a cada campo novo.
  extra: Record<string, unknown>;
}

// ---------- Procedures (apps/core) ----------
export interface CoreProcedureInfo {
  id: string;
  name: string;
  description: string | null;
  /** Cents pra padronizar matemática; converte pro display formatado no caller. */
  priceCents: number | null;
  /** Nº de sessões típicas pro tratamento. Default 1 quando procedimento é único. */
  defaultSessions: number;
  active: boolean;
  // Demais flags (requires_evaluation, etc.) seguem tipo unknown até tools usarem.
  extra: Record<string, unknown>;
}

// ---------- Availability (apps/core) ----------
export interface FreeSlotsQuery {
  userId: string;
  date: string; // YYYY-MM-DD
  durationMinutes: number;
}
export interface CoreFreeSlot {
  startAt: string; // ISO
  endAt: string;
}

// ---------- Appointments (apps/core) ----------
// Shape minimal pra criação via agente. discriminação por kind feita pelo
// caller (tool). Mantemos genérico; AppointmentsController valida com Zod.
export interface CreateAppointmentInput {
  kind: 'evaluation' | 'procedure';
  clientId: string;
  userId: string;
  startAt: string;
  endAt: string;
  notes?: string;
  // Procedure-only / evaluation-only fields ficam em `extra` até PR 7.
  extra?: Record<string, unknown>;
}
export interface CoreAppointmentSummary {
  id: string;
  startAt: string;
  endAt: string;
  status: string;
}

// ---------- Conversation tags (apps/core) ----------
export interface AssignTagsInput {
  conversationId: string;
  tagIds: string[];
  agentTurnId?: string;
}

// ---------- Messages (apps/chat) ----------
export interface SendMessageInput {
  conversationId: string;
  body: string;
}
export interface ChatMessageSummary {
  id: string;
  conversationId: string;
  body: string | null;
  createdAt: string;
}

// =====================================================================
// Interface
// =====================================================================

export interface CoreClient {
  // ---------- Tenant ----------
  /** Retorna a config do tenant (cache local). */
  getTenantInfo(tenantId: string): Promise<TenantInfo>;
  /** Invalida o cache pra um tenant (chamado pelo endpoint admin). */
  invalidateTenant(tenantId: string): void;

  // ---------- Read-only (existem hoje no core) ----------
  getClient(tenantId: string, clientId: string): Promise<CoreClientInfo>;
  listProcedures(
    tenantId: string,
    opts?: { search?: string },
  ): Promise<CoreProcedureInfo[]>;
  getFreeSlots(
    tenantId: string,
    params: FreeSlotsQuery,
  ): Promise<CoreFreeSlot[]>;

  // ---------- Write (existem hoje no core) ----------
  createAppointment(
    tenantId: string,
    input: CreateAppointmentInput,
  ): Promise<CoreAppointmentSummary>;

  // ---------- NÃO IMPLEMENTADAS NO V1 (endpoint do core ainda não existe) ----------
  /** PR 5 vai criar `POST /conversation-tags/assignments` no core. */
  assignConversationTags(tenantId: string, input: AssignTagsInput): Promise<void>;

  // ---------- Chat (apps/chat, baseURL diferente) ----------
  /** Cria outbound. PR 6 wire na tool. */
  sendMessage(
    tenantId: string,
    input: SendMessageInput,
  ): Promise<ChatMessageSummary>;
}
