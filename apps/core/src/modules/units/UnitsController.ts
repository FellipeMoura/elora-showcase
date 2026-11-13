import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UnitsService } from './UnitsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateUnitInput,
  FindUnitsQuery,
  UpdateUnitInput,
} from './UnitsTypes.js';

export const UnitsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindUnitsQuery;
      const result = await UnitsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const unit = await UnitsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(unit);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateUnitInput;
      const unit = await UnitsService.create(req.tenantId, input);
      res.status(StatusCodes.CREATED).json(unit);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateUnitInput;
      const unit = await UnitsService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(unit);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await UnitsService.remove(req.tenantId, id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  deactivate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const unit = await UnitsService.deactivate(req.tenantId, id);
      res.status(StatusCodes.OK).json(unit);
    } catch (err) {
      next(err);
    }
  },

  activate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const unit = await UnitsService.activate(req.tenantId, id);
      res.status(StatusCodes.OK).json(unit);
    } catch (err) {
      next(err);
    }
  },
};
