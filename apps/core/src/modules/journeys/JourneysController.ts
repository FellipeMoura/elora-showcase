import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { JourneysService } from './JourneysService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateJourneyInput,
  FindJourneyEventsQuery,
  FindJourneysQuery,
  MarkLostInput,
} from './JourneysTypes.js';

export const JourneysController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindJourneysQuery;
      const result = await JourneysService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const journey = await JourneysService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(journey);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateJourneyInput;
      const journey = await JourneysService.create(req.tenantId, input);
      res.status(StatusCodes.CREATED).json(journey);
    } catch (err) {
      next(err);
    }
  },

  markWon: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const journey = await JourneysService.markWon(
        req.tenantId,
        id,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(journey);
    } catch (err) {
      next(err);
    }
  },

  markLost: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const { reason } = req.body as MarkLostInput;
      const journey = await JourneysService.markLost(
        req.tenantId,
        id,
        reason,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(journey);
    } catch (err) {
      next(err);
    }
  },

  findEvents: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const query = req.query as unknown as FindJourneyEventsQuery;
      const result = await JourneysService.findEvents(req.tenantId, id, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },
};
