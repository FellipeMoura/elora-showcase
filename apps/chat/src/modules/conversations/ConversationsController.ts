import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ConversationsService } from './ConversationsService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  FindConversationsQuery,
  FindOrCreateConversationInput,
} from './ConversationsTypes.js';

export const ConversationsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindConversationsQuery;
      const result = await ConversationsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const conversation = await ConversationsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(conversation);
    } catch (err) {
      next(err);
    }
  },

  // Marca conversation como lida (zera unreadCount). Sem body — apenas o
  // path identifica a conversa. Retorna 204 sem corpo.
  markSeen: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await ConversationsService.markSeen(req.tenantId, id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  // Idempotente: cria conversation se cliente ainda não tem uma, retorna a
  // existente caso contrário. Usado pelo frontend pra abrir chat com cliente
  // que nunca conversou (mensagem proativa) e pelo webhook normalizer no
  // inbound (passo 7) — embora o webhook chame direto o service.
  findOrCreate: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { clientId, whatsappChannelId } =
        req.body as FindOrCreateConversationInput;
      const conversation =
        await ConversationsService.findOrCreateForClientChannel(
          req.tenantId,
          clientId,
          whatsappChannelId,
        );
      res.status(StatusCodes.OK).json(conversation);
    } catch (err) {
      next(err);
    }
  },
};
