import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AvailabilityService } from './AvailabilityService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateExceptionInput,
  CreateScheduleInput,
  FindExceptionsQuery,
  FindSchedulesQuery,
  FreeSlotsQuery,
  UpdateExceptionInput,
  UpdateScheduleInput,
} from './AvailabilityTypes.js';

export const AvailabilityController = {
  // Schedules --------------------------------------------------------

  findSchedules: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindSchedulesQuery;
      const items = await AvailabilityService.findSchedules(req.tenantId, query);
      res.status(StatusCodes.OK).json({ items });
    } catch (err) {
      next(err);
    }
  },

  createSchedule: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateScheduleInput;
      const schedule = await AvailabilityService.createSchedule(
        req.tenantId,
        input,
        req.userId ?? null,
        req.roleCodes ?? []
      );
      res.status(StatusCodes.CREATED).json(schedule);
    } catch (err) {
      next(err);
    }
  },

  updateSchedule: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateScheduleInput;
      const schedule = await AvailabilityService.updateSchedule(
        req.tenantId,
        id,
        input,
        req.userId ?? null,
        req.roleCodes ?? []
      );
      res.status(StatusCodes.OK).json(schedule);
    } catch (err) {
      next(err);
    }
  },

  deleteSchedule: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await AvailabilityService.deleteSchedule(
        req.tenantId,
        id,
        req.userId ?? null,
        req.roleCodes ?? []
      );
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  // Exceptions -------------------------------------------------------

  findExceptions: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindExceptionsQuery;
      const items = await AvailabilityService.findExceptions(req.tenantId, query);
      res.status(StatusCodes.OK).json({ items });
    } catch (err) {
      next(err);
    }
  },

  createException: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateExceptionInput;
      const exception = await AvailabilityService.createException(
        req.tenantId,
        input,
        req.userId ?? null,
        req.roleCodes ?? []
      );
      res.status(StatusCodes.CREATED).json(exception);
    } catch (err) {
      next(err);
    }
  },

  updateException: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateExceptionInput;
      const exception = await AvailabilityService.updateException(
        req.tenantId,
        id,
        input,
        req.userId ?? null,
        req.roleCodes ?? []
      );
      res.status(StatusCodes.OK).json(exception);
    } catch (err) {
      next(err);
    }
  },

  deleteException: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await AvailabilityService.deleteException(
        req.tenantId,
        id,
        req.userId ?? null,
        req.roleCodes ?? []
      );
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  // Free slots -------------------------------------------------------

  findFreeSlots: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FreeSlotsQuery;
      const items = await AvailabilityService.findFreeSlots(req.tenantId, query);
      res.status(StatusCodes.OK).json({ items });
    } catch (err) {
      next(err);
    }
  },
};
