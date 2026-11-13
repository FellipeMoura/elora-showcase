import type { RequestHandler } from 'express';
import { eq, groups, userGroups, withTenant } from '@elora/db';
import { db } from '../database/db.js';
import { AppError } from '../errors/AppError.js';
import type { RoleCode } from '../permissions/permissions.js';

// Carrega os role_codes dos grupos do usuário e anexa em `req.roleCodes`.
// Roda depois de `ensureAuthenticated` em routers que precisam autorização.
// Faz uma única query por request — aceitável dado o volume típico (poucos
// grupos por usuário). Se virar gargalo, dá pra cachear em Redis com
// invalidação on user_groups changes.
//
// `groups` é global (sem RLS), mas `user_groups` ainda tem RLS por tenant —
// então o JOIN precisa rodar dentro de withTenant pra filtrar só os vínculos
// do tenant atual (impede um user logado no tenant X ver vínculos do mesmo
// userId em outro tenant, se houver — modelo permite mesmo email × tenants).

export const loadUserRoles: RequestHandler = async (req, _res, next) => {
  try {
    if (!req.tenantId || !req.userId) {
      return next(new AppError('Não autenticado', 401));
    }

    const rows = await withTenant(db, req.tenantId, async (tx) => {
      return tx
        .select({ roleCode: groups.roleCode })
        .from(userGroups)
        .innerJoin(groups, eq(userGroups.groupId, groups.id))
        .where(eq(userGroups.userId, req.userId!));
    });

    // dedup — usuário em 2 grupos com mesmo role conta uma vez.
    const unique = Array.from(new Set(rows.map((r) => r.roleCode))) as RoleCode[];
    req.roleCodes = unique;

    next();
  } catch (err) {
    next(err);
  }
};
