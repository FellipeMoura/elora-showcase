import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ClientsService } from './ClientsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CheckClientQuery,
  CreateClientInput,
  FindClientsQuery,
  UpdateClientInput,
} from './ClientsTypes.js';

export const ClientsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindClientsQuery;
      const result = await ClientsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  checkByPhone: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { phoneE164 } = req.query as unknown as CheckClientQuery;
      const result = await ClientsService.checkByPhone(req.tenantId, phoneE164);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const client = await ClientsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(client);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateClientInput;
      const client = await ClientsService.create(req.tenantId, input);
      res.status(StatusCodes.CREATED).json(client);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateClientInput;
      const client = await ClientsService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(client);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await ClientsService.remove(req.tenantId, id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  deactivate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const client = await ClientsService.deactivate(req.tenantId, id);
      res.status(StatusCodes.OK).json(client);
    } catch (err) {
      next(err);
    }
  },

  activate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const client = await ClientsService.activate(req.tenantId, id);
      res.status(StatusCodes.OK).json(client);
    } catch (err) {
      next(err);
    }
  },
};
