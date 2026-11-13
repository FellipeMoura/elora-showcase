import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ConversationTagsService } from './ConversationTagsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateConversationTagInput,
  FindConversationTagsQuery,
  ReplaceConversationTagsInput,
  UpdateConversationTagInput,
} from './ConversationTagsTypes.js';

export const ConversationTagsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindConversationTagsQuery;
      const result = await ConversationTagsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const tag = await ConversationTagsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(tag);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateConversationTagInput;
      const tag = await ConversationTagsService.create(req.tenantId, input);
      res.status(StatusCodes.CREATED).json(tag);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateConversationTagInput;
      const tag = await ConversationTagsService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(tag);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await ConversationTagsService.remove(req.tenantId, id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  deactivate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const tag = await ConversationTagsService.deactivate(req.tenantId, id);
      res.status(StatusCodes.OK).json(tag);
    } catch (err) {
      next(err);
    }
  },

  activate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const tag = await ConversationTagsService.activate(req.tenantId, id);
      res.status(StatusCodes.OK).json(tag);
    } catch (err) {
      next(err);
    }
  },

  replaceAssignments: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as ReplaceConversationTagsInput;
      const result = await ConversationTagsService.replaceConversationTags(
        req.tenantId,
        input,
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },
};
