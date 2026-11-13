import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
  // Conversation alvo da rodada quando o context vem de um job de agente
  // (worker BullMQ inicia o storage; trigger metadata propaga aqui).
  conversationId?: string;
  // Identificador do agent_turn em curso. Setado pelo AgentRunner pra que
  // toda chamada de tool/log/sentry referencie o turno correto.
  agentTurnId?: string;
}

export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
