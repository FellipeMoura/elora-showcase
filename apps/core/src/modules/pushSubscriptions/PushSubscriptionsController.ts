import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '../../shared/errors/AppError.js';
import { PushSubscriptionsService } from './PushSubscriptionsService.js';
import type {
  RegisterPushSubscriptionInput,
  UnregisterPushSubscriptionInput,
} from './PushSubscriptionsTypes.js';

export const PushSubscriptionsController = {
  getPublicKey: async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const publicKey = PushSubscriptionsService.getPublicKey();
      res.status(StatusCodes.OK).json({ publicKey });
    } catch (err) {
      next(err);
    }
  },

  register: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Não autenticado', 401);
      const input = req.body as RegisterPushSubscriptionInput;
      await PushSubscriptionsService.register(
        req.tenantId,
        req.userId,
        input,
        req.get('user-agent') ?? null
      );
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  unregister: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Não autenticado', 401);
      const input = req.body as UnregisterPushSubscriptionInput;
      await PushSubscriptionsService.unregister(req.tenantId, req.userId, input);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },
};
