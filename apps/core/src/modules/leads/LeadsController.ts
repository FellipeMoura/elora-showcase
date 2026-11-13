import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '../../shared/errors/AppError.js';
import { isValidLostReason } from '../../shared/journeys/stageTransition.js';
import { LeadsService } from './LeadsService.js';
import type {
  CreateLeadInput,
  FindLeadsQuery,
  MarkLeadLostInput,
  UpdateLeadSubstageInput,
} from './LeadsTypes.js';

export const LeadsController = {
  // GET /leads/board
  board: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindLeadsQuery;
      const result = await LeadsService.findBoard(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  // GET /leads
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindLeadsQuery;
      const result = await LeadsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  // GET /leads/counts
  counts: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindLeadsQuery;
      const result = await LeadsService.counts(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  // GET /leads/:id
  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const lead = await LeadsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(lead);
    } catch (err) {
      next(err);
    }
  },

  // POST /leads
  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateLeadInput;
      const lead = await LeadsService.create(req.tenantId, input, req.userId ?? null);
      res.status(StatusCodes.CREATED).json(lead);
    } catch (err) {
      next(err);
    }
  },

  // PUT /leads/:id/substage
  setSubstage: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const { substage } = req.body as UpdateLeadSubstageInput;
      const lead = await LeadsService.setSubstageManual(
        req.tenantId,
        id,
        substage,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(lead);
    } catch (err) {
      next(err);
    }
  },

  // POST /leads/:id/recompute-substage
  recomputeSubstage: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const lead = await LeadsService.recomputeSubstage(
        req.tenantId,
        id,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(lead);
    } catch (err) {
      next(err);
    }
  },

  // POST /leads/:id/recycle — recepcionista retoma cliente perdido
  recycle: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const lead = await LeadsService.recycle(req.tenantId, id, req.userId ?? null);
      res.status(StatusCodes.CREATED).json(lead);
    } catch (err) {
      next(err);
    }
  },

  // POST /leads/:id/mark-lost
  markLost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const { reason } = req.body as MarkLeadLostInput;
      if (!isValidLostReason(reason)) {
        throw new AppError('Lost reason inválido', 400);
      }
      const lead = await LeadsService.markLost(
        req.tenantId,
        id,
        reason,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(lead);
    } catch (err) {
      next(err);
    }
  },
};
