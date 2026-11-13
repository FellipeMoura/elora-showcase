import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { WhatsappContactsService } from './WhatsappContactsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CheckNumberQuery,
  FindContactsQuery,
  UpdateContactInput,
} from './WhatsappContactsTypes.js';

export const WhatsappContactsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindContactsQuery;
      const result = await WhatsappContactsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const contact = await WhatsappContactsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(contact);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateContactInput;
      const contact = await WhatsappContactsService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(contact);
    } catch (err) {
      next(err);
    }
  },

  refreshProfilePicture: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const contact = await WhatsappContactsService.refreshProfilePicture(
        req.tenantId,
        id,
      );
      res.status(StatusCodes.OK).json(contact);
    } catch (err) {
      next(err);
    }
  },

  checkNumber: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { phoneE164 } = req.query as unknown as CheckNumberQuery;
      const result = await WhatsappContactsService.checkNumber(
        req.tenantId,
        phoneE164,
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getProfilePictureUrl: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const result = await WhatsappContactsService.getProfilePictureUrl(
        req.tenantId,
        id,
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },
};
