import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { WhatsappChannelsService } from './WhatsappChannelsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateChannelInput,
  FindChannelsQuery,
  UpdateChannelInput,
} from './WhatsappChannelsTypes.js';

export const WhatsappChannelsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindChannelsQuery;
      const result = await WhatsappChannelsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const channel = await WhatsappChannelsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(channel);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateChannelInput;
      const channel = await WhatsappChannelsService.create(req.tenantId, input);
      res.status(StatusCodes.CREATED).json(channel);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateChannelInput;
      const channel = await WhatsappChannelsService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(channel);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await WhatsappChannelsService.remove(req.tenantId, id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  purgeConversations: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const result = await WhatsappChannelsService.purgeConversations(
        req.tenantId,
        id,
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  deactivate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const channel = await WhatsappChannelsService.deactivate(req.tenantId, id);
      res.status(StatusCodes.OK).json(channel);
    } catch (err) {
      next(err);
    }
  },

  activate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const channel = await WhatsappChannelsService.activate(req.tenantId, id);
      res.status(StatusCodes.OK).json(channel);
    } catch (err) {
      next(err);
    }
  },

  // Provisiona instância no Evolution e grava credenciais no canal.
  // Idempotente — chamadas repetidas retornam o mesmo canal sem reprovisionar.
  provision: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const channel = await WhatsappChannelsService.provision(req.tenantId, id);
      res.status(StatusCodes.OK).json(channel);
    } catch (err) {
      next(err);
    }
  },

  // Retorna QR base64 + pairingCode opcional pra o frontend renderizar.
  // Pode retornar base64=null se a instância já está conectada.
  getQrCode: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const qr = await WhatsappChannelsService.getQrCode(req.tenantId, id);
      res.status(StatusCodes.OK).json(qr);
    } catch (err) {
      next(err);
    }
  },

  getConnectionState: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const state = await WhatsappChannelsService.getConnectionState(
        req.tenantId,
        id,
      );
      res.status(StatusCodes.OK).json(state);
    } catch (err) {
      next(err);
    }
  },
};
