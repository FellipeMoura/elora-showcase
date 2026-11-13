import type { RequestHandler } from 'express';
import { verifyToken, type TokenPayload } from '@elora/auth';
import { env } from '../../env.js';
import { AppError } from '../errors/AppError.js';
import { SESSION_COOKIE } from '../../modules/auth/AuthController.js';
import { requestContextStorage } from '../observability/requestContext.js';

function extractToken(req: Parameters<RequestHandler>[0]): string | null {
  // Cookie é a fonte primária — fluxo de browser.
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) return cookieToken;

  // Fallback pro header pra facilitar testes via curl/Postman e futuros
  // clientes não-browser (mobile, integrações).
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.substring(7);

  return null;
}

export const ensureAuthenticated: RequestHandler = (req, _res, next) => {
  const token = extractToken(req);
  if (!token) return next(new AppError('Não autenticado', 401));

  let payload: TokenPayload;
  try {
    payload = verifyToken(token, env.jwt.secret);
  } catch {
    return next(new AppError('Token inválido', 401));
  }

  // Defesa em profundidade: token tem tenantId, subdomínio também.
  // Se não baterem, é tentativa de uso cruzado — recusa.
  if (payload.tenantId !== req.tenantId) {
    return next(new AppError('Token não pertence a este tenant', 401));
  }

  req.userId = payload.userId;

  const ctx = requestContextStorage.getStore();
  if (ctx) ctx.userId = payload.userId;

  next();
};
