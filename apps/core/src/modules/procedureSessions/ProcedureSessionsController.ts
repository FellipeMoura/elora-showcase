import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ProcedureSessionsService } from './ProcedureSessionsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  EvolveProcedureSessionInput,
  FindProcedureSessionsQuery,
  UpdateProcedureSessionInput,
} from './ProcedureSessionsTypes.js';

export const ProcedureSessionsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindProcedureSessionsQuery;
      const result = await ProcedureSessionsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const session = await ProcedureSessionsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(session);
    } catch (err) {
      next(err);
    }
  },

  updateNotes: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateProcedureSessionInput;
      const session = await ProcedureSessionsService.updateNotes(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(session);
    } catch (err) {
      next(err);
    }
  },

  cancel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const session = await ProcedureSessionsService.cancel(
        req.tenantId,
        id,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(session);
    } catch (err) {
      next(err);
    }
  },

  evolve: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Usuário não autenticado', 401);
      const { id } = req.params as { id: string };
      const input = req.body as EvolveProcedureSessionInput;
      const session = await ProcedureSessionsService.evolve(
        req.tenantId,
        id,
        req.userId,
        input
      );
      res.status(StatusCodes.OK).json(session);
    } catch (err) {
      next(err);
    }
  },

  markDoneManual: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const session = await ProcedureSessionsService.markDoneManual(
        req.tenantId,
        id,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(session);
    } catch (err) {
      next(err);
    }
  },
};
