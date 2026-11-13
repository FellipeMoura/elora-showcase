import {
  and,
  eq,
  tenants,
  users,
  type BusinessHours,
  withTenant,
} from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/observability/logger.js';

// =====================================================================
// TenantResolver — cache em memória do que o CoreClient precisa pra
// montar requests (slug pro Host header, agent user pro JWT) e o que o
// AgentRunner precisa pro system prompt (persona, business hours).
//
// Lookup vai direto no DB — `tenants` não tem RLS; `users` tem mas
// fazemos via withTenant. Cache load-once por processo: dados aqui só
// mudam quando admin edita tenant config (UI do PR 8) ou re-roda seed.
// Invalidação manual via `invalidate(tenantId)` exposta — UI vai chamar
// por endpoint admin quando alterar config.
//
// Por que não Redis: cache local é suficiente (um processo de agent serve
// dezenas de tenants); evita round-trip extra na hot path do AgentRunner.
// Se virar dor com fan-out de N processos (escala horizontal real),
// promove pra Redis com TTL curto + pub/sub de invalidação.
// =====================================================================

export interface TenantInfo {
  id: string;
  slug: string;
  name: string;
  agentEnabled: boolean;
  agentIdleMinutes: number;
  agentPersona: string | null;
  businessHours: BusinessHours | null;
  // System agent user — necessário pra assinar o JWT que CoreClient envia.
  agentUserId: string;
  agentUsername: string;
}

const cache = new Map<string, TenantInfo>();

async function load(tenantId: string): Promise<TenantInfo> {
  // tenants table não tem RLS, mas users tem. withTenant cobre os dois
  // sem custo extra: a query do `tenants` ignora a policy (sem WHERE
  // tenant_id no JOIN) e a do `users` se beneficia.
  const result = await withTenant(db, tenantId, async (tx) => {
    const [tenantRow] = await tx
      .select({
        id: tenants.id,
        slug: tenants.slug,
        name: tenants.name,
        agentEnabled: tenants.agentEnabled,
        agentIdleMinutes: tenants.agentIdleMinutes,
        agentPersona: tenants.agentPersona,
        businessHours: tenants.businessHours,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenantRow) return null;

    const [agentRow] = await tx
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.isSystemAgent, true)))
      .limit(1);

    if (!agentRow) return { tenant: tenantRow, agent: null };

    return { tenant: tenantRow, agent: agentRow };
  });

  if (!result) {
    throw new AppError(`Tenant ${tenantId} não encontrado`, 404);
  }
  if (!result.agent) {
    // Invariante quebrada: todo tenant deve ter system agent user (criado
    // no seed/backfill). Diagnóstico cedo evita erro confuso de JWT depois.
    throw new AppError(
      `Tenant ${tenantId} sem system agent user — backfill incompleto`,
      500,
    );
  }

  const info: TenantInfo = {
    ...result.tenant,
    agentUserId: result.agent.id,
    agentUsername: result.agent.username,
  };

  logger.debug(
    {
      tenantId,
      slug: info.slug,
      agentEnabled: info.agentEnabled,
      hasBusinessHours: info.businessHours !== null,
    },
    '[tenantResolver] carregado',
  );

  return info;
}

export const tenantResolver = {
  /**
   * Retorna o TenantInfo cacheado. Primeira chamada por tenant bate no DB.
   */
  byTenantId: async (tenantId: string): Promise<TenantInfo> => {
    const cached = cache.get(tenantId);
    if (cached) return cached;
    const info = await load(tenantId);
    cache.set(tenantId, info);
    return info;
  },

  /**
   * Invalida cache pra um tenant. Chamada pelo endpoint admin quando UI
   * alterar tenant.agent_enabled / agent_idle_minutes / business_hours.
   */
  invalidate: (tenantId: string): void => {
    cache.delete(tenantId);
    logger.debug({ tenantId }, '[tenantResolver] cache invalidado');
  },

  /**
   * Limpa todo o cache. Útil em testes; produção raramente chama.
   */
  clear: (): void => {
    cache.clear();
  },
};
