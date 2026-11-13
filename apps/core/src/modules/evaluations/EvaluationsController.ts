import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { EvaluationsService } from './EvaluationsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateEvaluationInput,
  FindEvaluationsQuery,
  UpdateEvaluationInput,
} from './EvaluationsTypes.js';

export const EvaluationsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindEvaluationsQuery;
      const result = await EvaluationsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateEvaluationInput;
      const evaluation = await EvaluationsService.create(
        req.tenantId,
        input,
        req.userId ?? null,
      );
      res.status(StatusCodes.CREATED).json(evaluation);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const evaluation = await EvaluationsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(evaluation);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateEvaluationInput;
      const evaluation = await EvaluationsService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(evaluation);
    } catch (err) {
      next(err);
    }
  },

  cancel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const evaluation = await EvaluationsService.cancel(req.tenantId, id);
      res.status(StatusCodes.OK).json(evaluation);
    } catch (err) {
      next(err);
    }
  },
};
