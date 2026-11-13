import { env } from '../../env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/observability/logger.js';
import { signAgentJwt } from './jwt.js';
import { tenantResolver } from './tenantResolver.js';
import type {
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

// =====================================================================
// HttpCoreClient — impl HTTP da interface CoreClient.
//
// Endereçamento:
//   - core: baseURL = env.coreBaseUrl (ex: http://localhost:5501)
//   - chat: baseURL = env.chatBaseUrl (ex: http://localhost:5502)
//
// Roteamento por tenant: tenantContextMiddleware do core/chat lê Origin
// ANTES de Host (ver apps/core/src/shared/middleware/tenantContext.ts).
// Setamos `Origin: http://<slug>.<internalHostBase>` — Host header é
// proibido em fetch (spec WHATWG), tentativa silenciosa de sobrescrever
// vira no-op. Origin funciona porque é livre pra clients setarem.
//
// Em dev: Origin = http://clinica.localhost; em prod: clinica.elora.app.br.
//
// JWT: assinado por call. Cheap (~1ms); poderíamos cachear por ~50s e
// reusar, mas mantemos simples. Quando virar gargalo (medindo), cache em
// LRU pequeno indexado por tenantId.
//
// Erros: 401/403 viram AppError 500 — auth bug do agent é problema
// CRÍTICO (não tem como "tentar de novo"). 404 vira AppError 404. 5xx
// vira AppError 502 (gateway). 409 fica 409 (caller decide retry).
// Outros 4xx ficam com status original.
// =====================================================================

const AGENT_HEADER = 'X-Agent-Request';

interface DoRequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  baseUrl: string;
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  tenant: TenantInfo;
}

function buildUrl(baseUrl: string, path: string, query?: DoRequestOptions['query']): URL {
  const url = new URL(path, baseUrl);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function buildOriginHeader(tenant: TenantInfo): string {
  // Origin é uma URL — só esquema + autoridade, sem path. Porta omitida
  // porque o tenantContextMiddleware do core só consome o hostname.
  return `http://${tenant.slug}.${env.internalHostBase}`;
}

async function doRequest<T>(opts: DoRequestOptions): Promise<T> {
  const url = buildUrl(opts.baseUrl, opts.path, opts.query);
  const origin = buildOriginHeader(opts.tenant);
  const jwt = signAgentJwt({
    tenantId: opts.tenant.id,
    userId: opts.tenant.agentUserId,
    username: opts.tenant.agentUsername,
  });

  const headers: Record<string, string> = {
    Authorization: `Bearer ${jwt}`,
    Origin: origin,
    [AGENT_HEADER]: 'true',
    Accept: 'application/json',
  };
  let bodyText: string | undefined;
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    bodyText = JSON.stringify(opts.body);
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: opts.method,
      headers,
      body: bodyText,
    });
  } catch (err) {
    const ms = Date.now() - startedAt;
    logger.error(
      {
        method: opts.method,
        url: url.toString(),
        origin,
        tenantId: opts.tenant.id,
        ms,
        err: err instanceof Error ? err.message : String(err),
      },
      '[coreClient] erro de rede',
    );
    throw new AppError('Erro de rede ao chamar core/chat', 502);
  }

  const ms = Date.now() - startedAt;

  if (response.ok) {
    logger.debug(
      {
        method: opts.method,
        path: opts.path,
        origin,
        tenantId: opts.tenant.id,
        status: response.status,
        ms,
      },
      '[coreClient] ok',
    );
    // 204 No Content / response sem body
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  // Erro — tenta extrair corpo pra log estruturado.
  let bodyForLog: unknown;
  try {
    bodyForLog = await response.json();
  } catch {
    try {
      bodyForLog = await response.text();
    } catch {
      bodyForLog = null;
    }
  }

  logger.error(
    {
      method: opts.method,
      url: url.toString(),
      origin,
      tenantId: opts.tenant.id,
      status: response.status,
      ms,
      body: bodyForLog,
    },
    '[coreClient] resposta de erro',
  );

  // Map de status → AppError. Mantém status original pra 4xx, exceto
  // auth-related (vira 500 porque é bug do nosso lado).
  if (response.status === 401 || response.status === 403) {
    throw new AppError(
      `Auth do agent rejeitada pelo core (${response.status}) — JWT/permissions errados`,
      500,
      bodyForLog,
    );
  }
  if (response.status === 404) {
    throw new AppError('Recurso não encontrado no core', 404, bodyForLog);
  }
  if (response.status >= 500) {
    throw new AppError(`Core respondeu ${response.status}`, 502, bodyForLog);
  }
  throw new AppError(`Core respondeu ${response.status}`, response.status, bodyForLog);
}

// =====================================================================
// Impl
// =====================================================================

async function getTenantInfo(tenantId: string): Promise<TenantInfo> {
  return tenantResolver.byTenantId(tenantId);
}

function invalidateTenant(tenantId: string): void {
  tenantResolver.invalidate(tenantId);
}

async function getClient(tenantId: string, clientId: string): Promise<CoreClientInfo> {
  const tenant = await tenantResolver.byTenantId(tenantId);
  const raw = await doRequest<Record<string, unknown>>({
    method: 'GET',
    baseUrl: env.coreBaseUrl,
    path: `/clients/${clientId}`,
    tenant,
  });
  return {
    id: String(raw.id ?? ''),
    tenantId: String(raw.tenantId ?? tenantId),
    name: String(raw.name ?? ''),
    phoneE164: typeof raw.phoneE164 === 'string' ? raw.phoneE164 : null,
    extra: raw,
  };
}

// Resposta paginada de /procedures — extraímos só os campos que tools
// consomem. `items` vem como array do core.
interface PaginatedRaw<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

async function listProcedures(
  tenantId: string,
  opts: { search?: string } = {},
): Promise<CoreProcedureInfo[]> {
  const tenant = await tenantResolver.byTenantId(tenantId);
  const raw = await doRequest<PaginatedRaw<Record<string, unknown>>>({
    method: 'GET',
    baseUrl: env.coreBaseUrl,
    path: '/procedures',
    query: {
      pageSize: 200, // catálogo típico cabe em uma página
      status: 'active',
      ...(opts.search ? { q: opts.search } : {}),
    },
    tenant,
  });
  return raw.items.map((p) => ({
    id: String(p.id ?? ''),
    name: String(p.name ?? ''),
    description: typeof p.description === 'string' ? p.description : null,
    // `defaultPrice` vem como string decimal "450.00" do Drizzle. Multiplica
    // por 100 e arredonda pra evitar lixo de float (0.001 → 0).
    priceCents:
      typeof p.defaultPrice === 'string' && p.defaultPrice.length > 0
        ? Math.round(Number(p.defaultPrice) * 100)
        : null,
    defaultSessions:
      typeof p.defaultSessions === 'number' ? p.defaultSessions : 1,
    active: Boolean(p.active ?? true),
    extra: p,
  }));
}

async function getFreeSlots(
  tenantId: string,
  params: FreeSlotsQuery,
): Promise<CoreFreeSlot[]> {
  const tenant = await tenantResolver.byTenantId(tenantId);
  const raw = await doRequest<{ items: Array<Record<string, unknown>> }>({
    method: 'GET',
    baseUrl: env.coreBaseUrl,
    path: '/availability/free-slots',
    query: {
      userId: params.userId,
      date: params.date,
      durationMinutes: params.durationMinutes,
    },
    tenant,
  });
  return raw.items.map((s) => ({
    startAt: String(s.startAt ?? ''),
    endAt: String(s.endAt ?? ''),
  }));
}

async function createAppointment(
  tenantId: string,
  input: CreateAppointmentInput,
): Promise<CoreAppointmentSummary> {
  const tenant = await tenantResolver.byTenantId(tenantId);
  // O AppointmentsController valida discriminated union — montamos um body
  // que cobre os dois kinds usando `extra` pra campos específicos.
  const body: Record<string, unknown> = {
    kind: input.kind,
    clientId: input.clientId,
    userId: input.userId,
    startAt: input.startAt,
    endAt: input.endAt,
    ...(input.notes ? { notes: input.notes } : {}),
    ...(input.extra ?? {}),
  };
  const raw = await doRequest<Record<string, unknown>>({
    method: 'POST',
    baseUrl: env.coreBaseUrl,
    path: '/appointments',
    body,
    tenant,
  });
  return {
    id: String(raw.id ?? ''),
    startAt: String(raw.startAt ?? ''),
    endAt: String(raw.endAt ?? ''),
    status: String(raw.status ?? ''),
  };
}

async function assignConversationTags(
  tenantId: string,
  input: AssignTagsInput,
): Promise<void> {
  const tenant = await tenantResolver.byTenantId(tenantId);
  await doRequest<unknown>({
    method: 'POST',
    baseUrl: env.coreBaseUrl,
    path: '/conversation-tags/assignments',
    body: {
      conversationId: input.conversationId,
      tagIds: input.tagIds,
      ...(input.agentTurnId ? { agentTurnId: input.agentTurnId } : {}),
    },
    tenant,
  });
}

async function sendMessage(
  tenantId: string,
  input: SendMessageInput,
): Promise<ChatMessageSummary> {
  const tenant = await tenantResolver.byTenantId(tenantId);
  const raw = await doRequest<Record<string, unknown>>({
    method: 'POST',
    baseUrl: env.chatBaseUrl,
    path: `/conversations/${input.conversationId}/messages`,
    body: {
      kind: 'text',
      body: input.body,
    },
    tenant,
  });
  return {
    id: String(raw.id ?? ''),
    conversationId: String(raw.conversationId ?? input.conversationId),
    body: typeof raw.body === 'string' ? raw.body : null,
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
  };
}

export const httpCoreClient: CoreClient = {
  getTenantInfo,
  invalidateTenant,
  getClient,
  listProcedures,
  getFreeSlots,
  createAppointment,
  assignConversationTags,
  sendMessage,
};
