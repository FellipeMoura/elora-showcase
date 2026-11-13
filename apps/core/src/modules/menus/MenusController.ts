import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { MenusService } from './MenusService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  AttachGroupInput,
  AttachTenantInput,
  CreateMenuInput,
  FindMenusQuery,
  SetMenuGroupsInput,
  SetMenuTenantsInput,
  UpdateMenuInput,
} from './MenusTypes.js';

export const MenusController = {
  // CRUD do catálogo global — não usa req.tenantId.
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const query = req.query as unknown as FindMenusQuery;
      const result = await MenusService.find(query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  // Árvore completa — visão de admin (inclui inativos), global.
  getTree: async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const tree = await MenusService.getTree();
      res.status(StatusCodes.OK).json({ items: tree });
    } catch (err) {
      next(err);
    }
  },

  // Árvore visível ao usuário logado — usa tenantId (filtra por menu_tenants)
  // e userId (filtra por menu_groups via user_groups).
  getVisibleTree: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Não autenticado', 401);
      const tree = await MenusService.getVisibleTree(req.tenantId, req.userId);
      res.status(StatusCodes.OK).json({ items: tree });
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const menu = await MenusService.findById(id);
      res.status(StatusCodes.OK).json(menu);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = req.body as CreateMenuInput;
      const menu = await MenusService.create(input);
      res.status(StatusCodes.CREATED).json(menu);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const input = req.body as UpdateMenuInput;
      const menu = await MenusService.update(id, input);
      res.status(StatusCodes.OK).json(menu);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      await MenusService.remove(id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  deactivate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const menu = await MenusService.deactivate(id);
      res.status(StatusCodes.OK).json(menu);
    } catch (err) {
      next(err);
    }
  },

  activate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const menu = await MenusService.activate(id);
      res.status(StatusCodes.OK).json(menu);
    } catch (err) {
      next(err);
    }
  },

  // ---- Vínculo menu ↔ tenant ----

  listTenants: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const items = await MenusService.listTenants(id);
      res.status(StatusCodes.OK).json({ items });
    } catch (err) {
      next(err);
    }
  },

  attachTenant: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const { tenantId } = req.body as AttachTenantInput;
      await MenusService.attachTenant(id, tenantId);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  detachTenant: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, tenantId } = req.params as { id: string; tenantId: string };
      await MenusService.detachTenant(id, tenantId);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  setTenants: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const { tenantIds } = req.body as SetMenuTenantsInput;
      await MenusService.setTenants(id, tenantIds);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  // ---- Visibilidade por grupo (GLOBAL — gate em routes) ----

  listGroups: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const groups = await MenusService.listGroups(id);
      res.status(StatusCodes.OK).json({ items: groups });
    } catch (err) {
      next(err);
    }
  },

  attachGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const { groupId } = req.body as AttachGroupInput;
      await MenusService.attachGroup(id, groupId);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  detachGroup: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id, groupId } = req.params as { id: string; groupId: string };
      await MenusService.detachGroup(id, groupId);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  setGroups: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const { groupIds } = req.body as SetMenuGroupsInput;
      await MenusService.setGroups(id, groupIds);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },
};
