import type { Request, RequestHandler } from 'express';
import { eq, tenants } from '@elora/db';
import { db } from '../database/db.js';
import { AppError } from '../errors/AppError.js';
import { requestContextStorage } from '../observability/requestContext.js';

// Subdomínios técnicos do dominio (NUNCA tenants). Em prod o backend roda em
// `chat.elora.app.br`, então sem essa allowlist o Host header faria extractSlug
// retornar 'chat' e procurar tenant inexistente → 404 em todas as requests.
const TECHNICAL_SUBDOMAINS = new Set(['api', 'chat', 'evolution', 'www']);

function extractSlugFromHost(host: string): string | null {
  const hostname = host.split(':')[0] ?? '';
  if (!hostname) return null;

  // localhost puro = sem tenant. Em dev usa-se "<slug>.localhost" (browsers
  // resolvem *.localhost pra 127.0.0.1 nativamente, RFC 6761).
  if (hostname === 'localhost' || hostname === '127.0.0.1') return null;

  const parts = hostname.split('.');
  if (parts.length < 2) return null;

  const slug = parts[0] ?? null;
  if (slug && TECHNICAL_SUBDOMAINS.has(slug)) return null;
  return slug;
}

// Em prod, requests vem do browser hospedado em `<slug>.elora.app.br` pra
// `chat.elora.app.br/...` — cross-origin, browser SEMPRE manda header Origin
// com o frontend (`https://<slug>.elora.app.br`). Extraimos o slug dali.
//
// Em dev, frontend e backend rodam no mesmo `<slug>.localhost:porta` — Origin
// e Host tem o mesmo hostname, ambos funcionam (Origin tem precedencia).
function extractSlugFromRequest(req: Request): string | null {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) {
    try {
      const url = new URL(origin);
      const slugFromOrigin = extractSlugFromHost(url.host);
      if (slugFromOrigin) return slugFromOrigin;
    } catch {
      // Origin malformado — segue pro fallback de Host.
    }
  }

  return extractSlugFromHost(req.headers.host ?? '');
}

export const tenantContextMiddleware: RequestHandler = async (req, _res, next) => {
  try {
    const slug = extractSlugFromRequest(req);
    if (!slug) {
      return next(new AppError('Tenant não identificado pelo host', 400));
    }

    // tenants não tem RLS — lookup acontece sem contexto.
    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, slug))
      .limit(1);

    if (!tenant) {
      return next(new AppError('Tenant não encontrado', 404));
    }

    req.tenantId = tenant.id;

    const ctx = requestContextStorage.getStore();
    if (ctx) ctx.tenantId = tenant.id;

    next();
  } catch (err) {
    next(err);
  }
};
