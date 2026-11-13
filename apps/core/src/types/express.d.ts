import type { RoleCode } from '../shared/permissions/permissions.js';

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
      userId?: string;
      // Roles do usuário, calculados a partir de seus grupos.
      // Populado pelo middleware loadUserRoles, lido por requirePermission
      // e por handlers que precisem filtrar dados (ex: árvore de menus).
      roleCodes?: RoleCode[];
    }
  }
}

export {};
