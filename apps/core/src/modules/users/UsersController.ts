import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { UsersService } from './UsersService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateUserInput,
  FindUsersQuery,
  SetUserGroupsInput,
  UpdateUserInput,
} from './UsersTypes.js';

export const UsersController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      // Query validada pelo validateQuery middleware.
      const query = req.query as unknown as FindUsersQuery;
      const result = await UsersService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateUserInput;
      const user = await UsersService.create(req.tenantId, input);
      res.status(StatusCodes.CREATED).json(user);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateUserInput;
      const user = await UsersService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(user);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await UsersService.remove(req.tenantId, id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  deactivate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const user = await UsersService.deactivate(req.tenantId, id);
      res.status(StatusCodes.OK).json(user);
    } catch (err) {
      next(err);
    }
  },

  activate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const user = await UsersService.activate(req.tenantId, id);
      res.status(StatusCodes.OK).json(user);
    } catch (err) {
      next(err);
    }
  },

  setGroups: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const { groupIds } = req.body as SetUserGroupsInput;
      const user = await UsersService.setGroups(req.tenantId, id, groupIds);
      res.status(StatusCodes.OK).json(user);
    } catch (err) {
      next(err);
    }
  },
};
