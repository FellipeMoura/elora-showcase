import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '../../shared/errors/AppError.js';
import { AttendanceService } from './AttendanceService.js';
import type {
  SignAttendanceInput,
  VerifyAttendanceInput,
} from './AttendanceTypes.js';

function getRequestOrigin(req: Request): string | null {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.length > 0) return origin;
  // Fallback: monta a partir de protocolo + host. Em dev, frontend e backend
  // compartilham subdomínio do tenant; em prod só vale se request for
  // same-origin (rara em chamada de UI, comum em testes via curl).
  const host = req.headers.host;
  if (typeof host === 'string' && host.length > 0) {
    const proto = req.protocol === 'https' ? 'https' : 'http';
    return `${proto}://${host}`;
  }
  return null;
}

function getClientIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) {
    return xff.split(',')[0]?.trim() ?? null;
  }
  return req.socket?.remoteAddress ?? null;
}

export const AttendanceController = {
  generateLink: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const result = await AttendanceService.generateLink(
        req.tenantId,
        id,
        req.userId ?? null,
        getRequestOrigin(req)
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getForAppointment: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const result = await AttendanceService.findForAppointment(
        req.tenantId,
        id
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  // Públicas — sem tenantContextMiddleware.

  publicPreview: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { token } = req.params as { token: string };
      const result = await AttendanceService.getPublicPreview(token);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  publicVerify: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { token } = req.params as { token: string };
      const input = req.body as VerifyAttendanceInput;
      const result = await AttendanceService.verify(token, input);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  publicSign: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const { token } = req.params as { token: string };
      const verifyToken = (req.headers['x-verify-token'] as string | undefined) ?? '';
      if (!verifyToken) {
        throw new AppError('Header X-Verify-Token ausente', 401);
      }
      const input = req.body as SignAttendanceInput;
      const result = await AttendanceService.sign(token, verifyToken, input, {
        ip: getClientIp(req),
        userAgent:
          typeof req.headers['user-agent'] === 'string'
            ? req.headers['user-agent']
            : null,
      });
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },
};
