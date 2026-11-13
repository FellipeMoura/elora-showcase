import type { RequestHandler } from 'express';
import { eq, tenants } from '@elora/db';
import { db } from '../database/db.js';
import { AppError } from '../errors/AppError.js';

// Slug do tenant da equipe Elora (modelo "super-admin tenant").
// Quem está logado neste tenant tem acesso aos endpoints de gerenciamento
// global — catálogo de menus, vínculos menu↔tenant, e futuras rotas de
// plataforma. Decisão registrada em CLAUDE.md / arquitetura.md.
export const PLATFORM_TENANT_SLUG = 'main';

// Sem cache: a tabela `tenants` é minúscula e o slug é unique-indexed
// (sub-ms por lookup). Cachear em memória já causou bug — após `pnpm seed`
// o UUID do tenant `platform` muda e o cache antigo invalida o login.
// Trade-off aceito: 1 query extra por request a rota platform-only
// (raras, admin-only) em troca de robustez frente a reseeds.

// Bloqueia com 403 se o tenant do request não for o `platform`.
// Aplicar em rotas que mexem com dados globais (catálogo de menus etc.).
// Precisa rodar DEPOIS de `ensureAuthenticated` — req.tenantId vem do JWT.
export const requirePlatformAccess: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.tenantId) {
      return next(new AppError('Tenant não inicializado', 500));
    }
    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, PLATFORM_TENANT_SLUG))
      .limit(1);
    if (!tenant) {
      return next(
        new AppError(
          `Tenant da plataforma (slug='${PLATFORM_TENANT_SLUG}') não existe — rode o seed`,
          500
        )
      );
    }
    if (req.tenantId !== tenant.id) {
      return next(new AppError('Acesso restrito à equipe da plataforma', 403));
    }
    next();
  } catch (err) {
    next(err);
  }
};
