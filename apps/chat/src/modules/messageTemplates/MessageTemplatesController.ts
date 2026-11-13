import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { MessageTemplatesService } from './MessageTemplatesService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateTemplateInput,
  FindTemplatesQuery,
  UpdateTemplateInput,
} from './MessageTemplatesTypes.js';

export const MessageTemplatesController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindTemplatesQuery;
      const result = await MessageTemplatesService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const template = await MessageTemplatesService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(template);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateTemplateInput;
      const template = await MessageTemplatesService.create(req.tenantId, input);
      res.status(StatusCodes.CREATED).json(template);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateTemplateInput;
      const template = await MessageTemplatesService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(template);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await MessageTemplatesService.remove(req.tenantId, id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  deactivate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const template = await MessageTemplatesService.deactivate(req.tenantId, id);
      res.status(StatusCodes.OK).json(template);
    } catch (err) {
      next(err);
    }
  },

  activate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const template = await MessageTemplatesService.activate(req.tenantId, id);
      res.status(StatusCodes.OK).json(template);
    } catch (err) {
      next(err);
    }
  },
};
