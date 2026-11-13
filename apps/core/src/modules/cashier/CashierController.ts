import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { CashierService } from './CashierService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CashierSummaryQuery,
  FindCashierEntriesQuery,
} from './CashierTypes.js';

export const CashierController = {
  entries: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindCashierEntriesQuery;
      const result = await CashierService.findEntries(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  summary: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as CashierSummaryQuery;
      const result = await CashierService.summary(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },
};
