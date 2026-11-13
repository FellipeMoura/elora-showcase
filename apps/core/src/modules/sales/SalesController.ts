import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { SalesService } from './SalesService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  FindSalesQuery,
  MarkPaymentPaidInput,
  UpdatePaymentInput,
} from './SalesTypes.js';

export const SalesController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindSalesQuery;
      const result = await SalesService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const result = await SalesService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  markPaymentPaid: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id, paymentId } = req.params as { id: string; paymentId: string };
      const input = req.body as MarkPaymentPaidInput;
      const result = await SalesService.markPaymentPaid(
        req.tenantId,
        id,
        paymentId,
        input
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  updatePayment: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id, paymentId } = req.params as { id: string; paymentId: string };
      const input = req.body as UpdatePaymentInput;
      const result = await SalesService.updatePayment(
        req.tenantId,
        id,
        paymentId,
        input
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },
};
