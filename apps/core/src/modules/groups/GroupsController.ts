import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { GroupsService } from './GroupsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  AddMemberInput,
  CreateGroupInput,
  FindGroupsQuery,
  UpdateGroupInput,
} from './GroupsTypes.js';

// CRUD opera no catálogo GLOBAL — gate de super-admin nas rotas write/delete
// fica em groupsRoutes.ts (requirePlatformAccess). Membership ops continuam
// tenant-scoped (precisam de req.tenantId).
export const GroupsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as FindGroupsQuery;
      const result = await GroupsService.find(query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const group = await GroupsService.findById(id);
      res.status(StatusCodes.OK).json(group);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = req.body as CreateGroupInput;
      const group = await GroupsService.create(input);
      res.status(StatusCodes.CREATED).json(group);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const input = req.body as UpdateGroupInput;
      const group = await GroupsService.update(id, input);
      res.status(StatusCodes.OK).json(group);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      await GroupsService.remove(id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  deactivate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const group = await GroupsService.deactivate(id);
      res.status(StatusCodes.OK).json(group);
    } catch (err) {
      next(err);
    }
  },

  activate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const group = await GroupsService.activate(id);
      res.status(StatusCodes.OK).json(group);
    } catch (err) {
      next(err);
    }
  },

  listMembers: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const members = await GroupsService.listMembers(req.tenantId, id);
      res.status(StatusCodes.OK).json({ items: members });
    } catch (err) {
      next(err);
    }
  },

  addMember: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const { userId } = req.body as AddMemberInput;
      await GroupsService.addMember(req.tenantId, id, userId);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  removeMember: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id, userId } = req.params as { id: string; userId: string };
      await GroupsService.removeMember(req.tenantId, id, userId);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },
};
