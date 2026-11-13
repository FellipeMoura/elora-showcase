import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  requestId: string;
  tenantId?: string;
  userId?: string;
}

// Cada request HTTP cria um contexto isolado neste storage.
// Logs e queries puxam o contexto sem precisar receber por parâmetro.
export const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}
