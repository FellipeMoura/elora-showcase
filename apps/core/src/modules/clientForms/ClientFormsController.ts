import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ClientFormsService } from './ClientFormsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateClientFormInput,
  UpsertAnswersInput,
} from './ClientFormsTypes.js';

export const ClientFormsController = {
  listByClient: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { clientId } = req.params as { clientId: string };
      const items = await ClientFormsService.findByClient(req.tenantId, clientId);
      res.status(StatusCodes.OK).json({ items });
    } catch (err) {
      next(err);
    }
  },

  listByEvaluation: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { evaluationId } = req.params as { evaluationId: string };
      const items = await ClientFormsService.findByEvaluation(
        req.tenantId,
        evaluationId,
      );
      res.status(StatusCodes.OK).json({ items });
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { evaluationId } = req.params as { evaluationId: string };
      const input = req.body as CreateClientFormInput;
      const form = await ClientFormsService.create(req.tenantId, evaluationId, input);
      res.status(StatusCodes.CREATED).json(form);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const result = await ClientFormsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  upsertAnswers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpsertAnswersInput;
      const items = await ClientFormsService.upsertAnswers(req.tenantId, id, input);
      res.status(StatusCodes.OK).json({ items });
    } catch (err) {
      next(err);
    }
  },

  complete: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const form = await ClientFormsService.complete(
        req.tenantId,
        id,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(form);
    } catch (err) {
      next(err);
    }
  },

  archive: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const form = await ClientFormsService.archive(req.tenantId, id);
      res.status(StatusCodes.OK).json(form);
    } catch (err) {
      next(err);
    }
  },

  reopen: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const form = await ClientFormsService.reopen(req.tenantId, id);
      res.status(StatusCodes.OK).json(form);
    } catch (err) {
      next(err);
    }
  },
};
