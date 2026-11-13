import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { MessagesService } from './MessagesService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  EditMessageInput,
  FindMessagesQuery,
  PostInternalNoteInput,
  SendMessageInput,
} from './MessagesTypes.js';

// Multer com memoryStorage anexa `req.file` com Buffer já em memória —
// streaming pra MinIO é direto sem temp file. Express.Multer.File é o tipo
// estendido oficial.
type MulterFile = Express.Multer.File;

export const MessagesController = {
  list: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { conversationId } = req.params as { conversationId: string };
      const query = req.query as unknown as FindMessagesQuery;
      const result = await MessagesService.listForConversation(
        req.tenantId,
        conversationId,
        query
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  postNote: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Usuário não inicializado', 500);
      const { conversationId } = req.params as { conversationId: string };
      const input = req.body as PostInternalNoteInput;
      const message = await MessagesService.postInternalNote(
        req.tenantId,
        conversationId,
        input,
        req.userId
      );
      res.status(StatusCodes.CREATED).json(message);
    } catch (err) {
      next(err);
    }
  },

  send: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Usuário não inicializado', 500);
      const { conversationId } = req.params as { conversationId: string };
      const input = req.body as SendMessageInput;
      const message = await MessagesService.enqueueOutbound(
        req.tenantId,
        conversationId,
        input,
        req.userId
      );
      res.status(StatusCodes.CREATED).json(message);
    } catch (err) {
      next(err);
    }
  },

  uploadMedia: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { conversationId } = req.params as { conversationId: string };
      const file = (req as Request & { file?: MulterFile }).file;
      if (!file) {
        throw new AppError('Arquivo obrigatório no campo "file"', 400);
      }
      const result = await MessagesService.uploadOutboundMedia(
        req.tenantId,
        conversationId,
        {
          buffer: file.buffer,
          mimeType: file.mimetype,
          originalFilename: file.originalname,
        },
      );
      res.status(StatusCodes.CREATED).json(result);
    } catch (err) {
      next(err);
    }
  },

  getMediaUrl: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { messageId } = req.params as { messageId: string };
      const result = await MessagesService.getMediaUrl(req.tenantId, messageId);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  edit: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { messageId } = req.params as { messageId: string };
      const { body } = req.body as EditMessageInput;
      const updated = await MessagesService.editMessage(req.tenantId, messageId, body);
      res.status(StatusCodes.OK).json(updated);
    } catch (err) {
      next(err);
    }
  },

  revoke: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { messageId } = req.params as { messageId: string };
      const updated = await MessagesService.revokeMessage(req.tenantId, messageId);
      res.status(StatusCodes.OK).json(updated);
    } catch (err) {
      next(err);
    }
  },

  retry: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { messageId } = req.params as { messageId: string };
      const updated = await MessagesService.retryDelivery(req.tenantId, messageId);
      res.status(StatusCodes.OK).json(updated);
    } catch (err) {
      next(err);
    }
  },
};
