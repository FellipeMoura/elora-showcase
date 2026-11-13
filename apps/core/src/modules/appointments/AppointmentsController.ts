import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppointmentsService } from './AppointmentsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateAppointmentInput,
  FindAppointmentsQuery,
  UpdateAppointmentInput,
} from './AppointmentsTypes.js';

export const AppointmentsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindAppointmentsQuery;
      const result = await AppointmentsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const appointment = await AppointmentsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(appointment);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateAppointmentInput;
      const appointment = await AppointmentsService.create(
        req.tenantId,
        input,
        req.userId ?? null
      );
      res.status(StatusCodes.CREATED).json(appointment);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateAppointmentInput;
      const appointment = await AppointmentsService.update(
        req.tenantId,
        id,
        input,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(appointment);
    } catch (err) {
      next(err);
    }
  },

  confirm: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const appointment = await AppointmentsService.confirm(
        req.tenantId,
        id,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(appointment);
    } catch (err) {
      next(err);
    }
  },

  attend: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const appointment = await AppointmentsService.attend(
        req.tenantId,
        id,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(appointment);
    } catch (err) {
      next(err);
    }
  },

  noShow: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const appointment = await AppointmentsService.noShow(
        req.tenantId,
        id,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(appointment);
    } catch (err) {
      next(err);
    }
  },

  cancel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const appointment = await AppointmentsService.cancel(
        req.tenantId,
        id,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(appointment);
    } catch (err) {
      next(err);
    }
  },
};
