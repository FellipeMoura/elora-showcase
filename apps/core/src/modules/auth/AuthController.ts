import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AuthService } from './AuthService.js';
import { AppError } from '../../shared/errors/AppError.js';
import { env, isProd } from '../../env.js';
import type { LoginInput } from './AuthTypes.js';

// Nome do cookie de sessão. Em prod, COOKIE_DOMAIN='.elora.app.br' faz o
// cookie viajar pra todos os subdominios — necessario porque o frontend
// (main.elora.app.br) chama backend (api.elora.app.br / chat.elora.app.br).
// Em dev (sem COOKIE_DOMAIN), o cookie fica scoped no host atual.
export const SESSION_COOKIE = 'elora_token';

export const AuthController = {
  login: async (
    req: Request<unknown, unknown, LoginInput>,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const result = await AuthService.login(req.tenantId, req.body);

      res.cookie(SESSION_COOKIE, result.token, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        expires: result.expiresAt,
        path: '/',
        ...(env.cookieDomain ? { domain: env.cookieDomain } : {}),
      });

      res.status(StatusCodes.OK).json({ user: result.user });
    } catch (err) {
      next(err);
    }
  },

  me: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Não autenticado', 401);
      const result = await AuthService.me(req.tenantId, req.userId);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  logout: async (_req: Request, res: Response): Promise<void> => {
    // Cookie httpOnly só pode ser limpo pelo servidor — não basta o cliente
    // tentar apagar. Path precisa bater com o do set.
    // Path E domain precisam bater com o que foi setado, senao browser nao
    // remove o cookie (silencia: 200 mas cookie continua valido).
    res.clearCookie(SESSION_COOKIE, {
      path: '/',
      ...(env.cookieDomain ? { domain: env.cookieDomain } : {}),
    });
    res.status(StatusCodes.NO_CONTENT).send();
  },
};
