import {
  and,
  asc,
  eq,
  groups,
  sql,
  tenants,
  userGroups,
  users,
} from '@elora/db';
import { env } from '../../env.js';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { PLATFORM_TENANT_SLUG } from '../../shared/middleware/requirePlatformAccess.js';
import { TenantLogoStorage } from '../../shared/storage/TenantLogoStorage.js';
import type {
  CreateTenantInput,
  LogoUrlResponse,
  Tenant,
  TenantSummary,
  UpdateTenantInput,
  UploadLogoResponse,
} from './TenantsTypes.js';

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

// `tenants` é tabela global sem RLS — consulta direta via `db`, sem
// withTenant. Acesso protegido em camada de rota (requirePlatformAccess).
export const TenantsService = {
  list: async (): Promise<TenantSummary[]> => {
    return db
      .select({ id: tenants.id, slug: tenants.slug, name: tenants.name })
      .from(tenants)
      .orderBy(asc(tenants.name));
  },

  findById: async (id: string): Promise<Tenant> => {
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);
    if (!tenant) throw new AppError('Tenant não encontrado', 404);
    return tenant;
  },

  // Cria tenant + provisiona login de admin numa única transação. O admin
  // do novo tenant reusa o passwordHash do admin do tenant `main` — mesma
  // senha, sem precisar de um segredo separado no fluxo de onboarding.
  create: async (input: CreateTenantInput): Promise<Tenant> => {
    return db.transaction(async (tx) => {
      // Tenant da plataforma + grupo global "admin" — ambas tabelas globais
      // (sem RLS), consultadas sem SET LOCAL.
      const [platformTenant] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.slug, PLATFORM_TENANT_SLUG))
        .limit(1);
      if (!platformTenant) {
        throw new AppError(
          `Tenant da plataforma (slug='${PLATFORM_TENANT_SLUG}') não existe — rode o seed`,
          500,
        );
      }

      const [adminGroup] = await tx
        .select({ id: groups.id })
        .from(groups)
        .where(eq(groups.roleCode, 'admin'))
        .limit(1);
      if (!adminGroup) {
        throw new AppError(
          'Grupo global "admin" não encontrado — rode o seed',
          500,
        );
      }

      // `users` tem RLS: seta o contexto pro tenant main pra ler o hash.
      // Filtra `isSystemAgent=false` pra não pegar o user técnico do
      // apps/agent. `orderBy(createdAt)` desempata pro admin original do
      // seed quando houver mais de um admin humano em main.
      await tx.execute(
        sql`SELECT set_config('app.current_tenant', ${platformTenant.id}, true)`,
      );
      const [platformAdmin] = await tx
        .select({ passwordHash: users.passwordHash })
        .from(users)
        .innerJoin(userGroups, eq(userGroups.userId, users.id))
        .where(
          and(
            eq(users.tenantId, platformTenant.id),
            eq(userGroups.groupId, adminGroup.id),
            eq(users.isSystemAgent, false),
          ),
        )
        .orderBy(asc(users.createdAt))
        .limit(1);
      if (!platformAdmin) {
        throw new AppError(
          `Admin do tenant '${PLATFORM_TENANT_SLUG}' não encontrado — rode o seed`,
          500,
        );
      }

      let created: Tenant;
      try {
        const [row] = await tx
          .insert(tenants)
          .values({
            slug: input.slug,
            name: input.name,
            legalName: input.legalName ?? null,
            tradeName: input.tradeName ?? null,
            document: input.document ?? null,
            representativeName: input.representativeName ?? null,
            logoUrl: input.logoUrl ?? null,
            skipEvaluation: input.skipEvaluation ?? false,
            // agent_* e business_hours: usam default do DB quando undefined;
            // null explícito (em businessHours/agentPersona) é respeitado.
            ...(input.agentEnabled !== undefined
              ? { agentEnabled: input.agentEnabled }
              : {}),
            ...(input.agentIdleMinutes !== undefined
              ? { agentIdleMinutes: input.agentIdleMinutes }
              : {}),
            ...(input.agentPersona !== undefined
              ? { agentPersona: input.agentPersona }
              : {}),
            ...(input.businessHours !== undefined
              ? { businessHours: input.businessHours }
              : {}),
          })
          .returning();
        if (!row) throw new AppError('Falha ao criar tenant', 500);
        created = row;
      } catch (err) {
        // 23505 = unique_violation. Slug é unique — colisão cai aqui.
        if (isPgError(err) && err.code === '23505') {
          throw new AppError('Já existe um tenant com este slug', 409);
        }
        throw err;
      }

      // Troca o contexto RLS pro tenant recém criado antes de inserir user
      // + membership (ambas tabelas com policy tenant_isolation).
      await tx.execute(
        sql`SELECT set_config('app.current_tenant', ${created.id}, true)`,
      );

      const [adminUser] = await tx
        .insert(users)
        .values({
          tenantId: created.id,
          // Username padrão do admin recém-criado — pode ser atualizado
          // depois via /users. Email fica null (opcional agora).
          username: 'admin',
          email: null,
          passwordHash: platformAdmin.passwordHash,
          name: `Admin ${created.name}`,
        })
        .returning();
      if (!adminUser) {
        throw new AppError('Falha ao criar admin do tenant', 500);
      }

      await tx.insert(userGroups).values({
        userId: adminUser.id,
        groupId: adminGroup.id,
        tenantId: created.id,
      });

      return created;
    });
  },

  update: async (id: string, input: UpdateTenantInput): Promise<Tenant> => {
    // Garante existência antes de tentar update — devolve 404 explícito em
    // vez de "0 linhas afetadas".
    await TenantsService.findById(id);

    const [updated] = await db
      .update(tenants)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
        ...(input.tradeName !== undefined ? { tradeName: input.tradeName } : {}),
        ...(input.document !== undefined ? { document: input.document } : {}),
        ...(input.representativeName !== undefined
          ? { representativeName: input.representativeName }
          : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
        ...(input.skipEvaluation !== undefined
          ? { skipEvaluation: input.skipEvaluation }
          : {}),
        ...(input.agentEnabled !== undefined
          ? { agentEnabled: input.agentEnabled }
          : {}),
        ...(input.agentIdleMinutes !== undefined
          ? { agentIdleMinutes: input.agentIdleMinutes }
          : {}),
        ...(input.agentPersona !== undefined
          ? { agentPersona: input.agentPersona }
          : {}),
        ...(input.businessHours !== undefined
          ? { businessHours: input.businessHours }
          : {}),
      })
      .where(eq(tenants.id, id))
      .returning();
    if (!updated) throw new AppError('Tenant não encontrado', 404);
    return updated;
  },

  // Sobe logo pro bucket + persiste objectKey em `tenants.logo_url`. Se
  // já existir um logo anterior no mesmo path (sobrescrita), MinIO
  // sobrepõe atomicamente — sem cleanup necessário. Se o logo antigo
  // tiver extensão diferente (png→webp), o objeto órfão fica no bucket
  // até rodar `deleteLogo` explícito; trade-off aceito pra manter o
  // upload sem transação distribuída.
  uploadLogo: async (
    id: string,
    file: { buffer: Buffer; mimeType: string },
  ): Promise<UploadLogoResponse> => {
    await TenantsService.findById(id);
    const result = await TenantLogoStorage.persistLogo(
      id,
      file.buffer,
      file.mimeType,
    );
    await db
      .update(tenants)
      .set({ logoUrl: result.objectKey })
      .where(eq(tenants.id, id));
    return result;
  },

  // Apaga objeto do bucket + zera coluna. Erros do storage viram
  // best-effort (deleteLogoQuiet) — o importante é o DB refletir "sem
  // logo" mesmo se o bucket ficar com órfão.
  deleteLogo: async (id: string): Promise<Tenant> => {
    const tenant = await TenantsService.findById(id);
    if (tenant.logoUrl) {
      await TenantLogoStorage.deleteLogoQuiet(tenant.logoUrl);
    }
    const [updated] = await db
      .update(tenants)
      .set({ logoUrl: null })
      .where(eq(tenants.id, id))
      .returning();
    if (!updated) throw new AppError('Tenant não encontrado', 404);
    return updated;
  },

  // Devolve presigned URL pro browser renderizar. Null quando tenant
  // não tem logo — UI cai pro placeholder. TTL vai no response pra UI
  // decidir se cacheia ou re-consulta.
  getLogoUrl: async (id: string): Promise<LogoUrlResponse> => {
    const tenant = await TenantsService.findById(id);
    if (!tenant.logoUrl) {
      return { url: null, expiresInSec: env.storage.mediaPresignedTtlSec };
    }
    const url = await TenantLogoStorage.getPresignedUrl(tenant.logoUrl);
    return { url, expiresInSec: env.storage.mediaPresignedTtlSec };
  },
};
