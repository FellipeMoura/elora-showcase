import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { TreatmentsService } from './TreatmentsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CloseManuallyInput,
  FindTreatmentsQuery,
  UpdateTreatmentInput,
} from './TreatmentsTypes.js';

export const TreatmentsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindTreatmentsQuery;
      const result = await TreatmentsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const result = await TreatmentsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateTreatmentInput;
      const treatment = await TreatmentsService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(treatment);
    } catch (err) {
      next(err);
    }
  },

  closeManually: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as CloseManuallyInput;
      const treatment = await TreatmentsService.closeManually(
        req.tenantId,
        id,
        input,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(treatment);
    } catch (err) {
      next(err);
    }
  },

  reopen: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const treatment = await TreatmentsService.reopen(
        req.tenantId,
        id,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(treatment);
    } catch (err) {
      next(err);
    }
  },
};
