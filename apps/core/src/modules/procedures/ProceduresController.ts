import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ProceduresService } from './ProceduresService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateProcedureInput,
  FindProceduresQuery,
  UpdateProcedureInput,
} from './ProceduresTypes.js';

export const ProceduresController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindProceduresQuery;
      const result = await ProceduresService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const procedure = await ProceduresService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(procedure);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateProcedureInput;
      const procedure = await ProceduresService.create(req.tenantId, input);
      res.status(StatusCodes.CREATED).json(procedure);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateProcedureInput;
      const procedure = await ProceduresService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(procedure);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await ProceduresService.remove(req.tenantId, id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  deactivate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const procedure = await ProceduresService.deactivate(req.tenantId, id);
      res.status(StatusCodes.OK).json(procedure);
    } catch (err) {
      next(err);
    }
  },

  activate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const procedure = await ProceduresService.activate(req.tenantId, id);
      res.status(StatusCodes.OK).json(procedure);
    } catch (err) {
      next(err);
    }
  },
};
