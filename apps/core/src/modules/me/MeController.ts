import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { MeService } from './MeService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { MeUpdatePreferencesInput } from './MeTypes.js';

export const MeController = {
  getPreferences: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Não autenticado', 401);
      const prefs = await MeService.getPreferences(req.tenantId, req.userId);
      res.status(StatusCodes.OK).json(prefs);
    } catch (err) {
      next(err);
    }
  },

  updatePreferences: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Não autenticado', 401);
      const input = req.body as MeUpdatePreferencesInput;
      const prefs = await MeService.updatePreferences(req.tenantId, req.userId, input);
      res.status(StatusCodes.OK).json(prefs);
    } catch (err) {
      next(err);
    }
  },
};
