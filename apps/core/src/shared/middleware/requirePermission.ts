import type { RequestHandler } from 'express';
import { AppError } from '../errors/AppError.js';
import {
  hasPermission,
  type PermissionAction,
} from '../permissions/permissions.js';

// Bloqueia a request se o usuário não tem nenhum role autorizado pra ação.
// Precisa rodar DEPOIS de `loadUserRoles` — req.roleCodes precisa existir.

export const requirePermission = (action: PermissionAction): RequestHandler => {
  return (req, _res, next) => {
    if (!req.roleCodes) {
      // Erro de montagem do router (esqueceu loadUserRoles). Trata como 500
      // pra não disfarçar bug como "permissão negada".
      return next(new AppError('Roles não carregados na request', 500));
    }
    if (!hasPermission(req.roleCodes, action)) {
      return next(new AppError('Permissão negada', 403));
    }
    next();
  };
};
