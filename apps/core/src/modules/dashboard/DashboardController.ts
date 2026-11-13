import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '../../shared/errors/AppError.js';
import { DashboardService } from './DashboardService.js';
import type { DashboardSummaryQuery } from './DashboardTypes.js';

export const DashboardController = {
  summary: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { period, from, to } = req.query as unknown as DashboardSummaryQuery;
      const result = await DashboardService.runSummary(
        req.tenantId,
        period,
        from,
        to,
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },
};
