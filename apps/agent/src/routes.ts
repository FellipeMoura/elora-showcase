import { Router, type Router as ExpressRouter } from 'express';
import { StatusCodes } from 'http-status-codes';
import { eq, sql, tenants } from '@elora/db';
import { db } from './shared/database/db.js';
import { redis } from './shared/redis/redis.js';
import { env } from './env.js';
import { pingAnthropic } from './shared/anthropic/client.js';
import { coreClient } from './shared/coreClient/index.js';

export const publicRoutes: ExpressRouter = Router();

// Health: liveness + dependências básicas. Postman/UptimeRobot batem aqui.
publicRoutes.get('/health', async (_req, res, next) => {
  try {
    await db.execute(sql`SELECT 1`);
    const redisPing = await redis.ping();
    res.status(StatusCodes.OK).json({
      status: 'ok',
      app: 'agent',
      version: env.appVersion,
      env: env.nodeEnv,
      redis: redisPing === 'PONG' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

// Kill-switch status — público (só leitura). Útil pra dashboard saber se
// agente está globalmente desligado sem precisar SSH no servidor.
publicRoutes.get('/agent/kill-switch', (_req, res) => {
  res.status(StatusCodes.OK).json({
    globalKillSwitch: env.agent.globalKillSwitch,
    defaultModel: env.agent.defaultModel,
    fastModel: env.agent.fastModel,
    maxToolIterations: env.agent.maxToolIterations,
  });
});

// Diagnostics: bate na Anthropic com prompt mínimo pra validar API key + rede.
// Custo: ~$0.0001 por call. Endpoint público (info-only): retorna ok/erro +
// latência + custo. Usado pelo PR 2 smoke test e por debug futuro.
//
// Se `?tenant=<slug>` for passado, ROTA TAMBÉM testa o CoreClient end-to-end:
// resolve slug → tenantId, carrega tenant info do DB (TenantResolver),
// assina JWT do system agent user e bate em GET /procedures no core.
// Validação completa do chain do PR 3.
publicRoutes.get('/agent/diagnostics', async (req, res, next) => {
  try {
    const ping = await pingAnthropic();

    const tenantSlug = typeof req.query.tenant === 'string' ? req.query.tenant : undefined;
    let coreCheck: unknown = undefined;
    if (tenantSlug) {
      coreCheck = await runCoreSmokeTest(tenantSlug);
    }

    const allOk =
      ping.ok &&
      (coreCheck === undefined ||
        (coreCheck as { ok: boolean }).ok === true);

    res.status(allOk ? StatusCodes.OK : StatusCodes.BAD_GATEWAY).json({
      app: 'agent',
      anthropic: ping,
      ...(coreCheck ? { core: coreCheck } : {}),
      globalKillSwitch: env.agent.globalKillSwitch,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
});

interface CoreSmokeTestResult {
  ok: boolean;
  tenantSlug: string;
  tenantId?: string;
  agentEnabled?: boolean;
  agentUserResolved?: boolean;
  proceduresFetched?: number;
  totalLatencyMs?: number;
  error?: string;
}

async function runCoreSmokeTest(slug: string): Promise<CoreSmokeTestResult> {
  const startedAt = Date.now();
  try {
    // 1) Slug → tenantId (tenants table não tem RLS, query direta).
    const [tenantRow] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    if (!tenantRow) {
      return { ok: false, tenantSlug: slug, error: `Tenant ${slug} não encontrado` };
    }

    // 2) Resolve tenant info (testa tenantResolver + invariante system agent).
    const info = await coreClient.getTenantInfo(tenantRow.id);

    // 3) Bate na rota /procedures do core via HTTP com JWT + Host header.
    // Valida o chain inteiro: signAgentJwt → fetch → tenantContextMiddleware
    // do core → ensureAuthenticated → loadUserRoles → requirePermission.
    const procedures = await coreClient.listProcedures(tenantRow.id);

    return {
      ok: true,
      tenantSlug: slug,
      tenantId: tenantRow.id,
      agentEnabled: info.agentEnabled,
      agentUserResolved: true,
      proceduresFetched: procedures.length,
      totalLatencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      tenantSlug: slug,
      totalLatencyMs: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
