import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { EquipmentsService } from './EquipmentsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateEquipmentInput,
  FindEquipmentsQuery,
  UpdateEquipmentInput,
} from './EquipmentsTypes.js';

export const EquipmentsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindEquipmentsQuery;
      const result = await EquipmentsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const equipment = await EquipmentsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(equipment);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateEquipmentInput;
      const equipment = await EquipmentsService.create(req.tenantId, input);
      res.status(StatusCodes.CREATED).json(equipment);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateEquipmentInput;
      const equipment = await EquipmentsService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(equipment);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await EquipmentsService.remove(req.tenantId, id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  deactivate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const equipment = await EquipmentsService.deactivate(req.tenantId, id);
      res.status(StatusCodes.OK).json(equipment);
    } catch (err) {
      next(err);
    }
  },

  activate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const equipment = await EquipmentsService.activate(req.tenantId, id);
      res.status(StatusCodes.OK).json(equipment);
    } catch (err) {
      next(err);
    }
  },
};
