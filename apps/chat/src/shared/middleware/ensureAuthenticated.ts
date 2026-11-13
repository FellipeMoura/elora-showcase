import type { RequestHandler } from 'express';
import { verifyToken, type TokenPayload } from '@elora/auth';
import { env } from '../../env.js';
import { AppError } from '../errors/AppError.js';
import { requestContextStorage } from '../observability/requestContext.js';

// Cookie de sessão é compartilhado com o core (mesmo host em prod via reverse
// proxy /chat/*). Hardcoded aqui pra evitar dependência circular com o core;
// quando virar dor, extrair pra @elora/auth.
const SESSION_COOKIE = 'elora_token';

function extractToken(req: Parameters<RequestHandler>[0]): string | null {
  const cookieToken = req.cookies?.[SESSION_COOKIE];
  if (typeof cookieToken === 'string' && cookieToken.length > 0) return cookieToken;

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

  if (payload.tenantId !== req.tenantId) {
    return next(new AppError('Token não pertence a este tenant', 401));
  }

  req.userId = payload.userId;

  const ctx = requestContextStorage.getStore();
  if (ctx) ctx.userId = payload.userId;

  next();
};
