import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { QuotesService } from './QuotesService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CloseSaleInput,
  CreateQuoteInput,
  CreateQuoteItemInput,
  FindQuotesQuery,
  UpdateQuoteInput,
  UpdateQuoteItemInput,
} from './QuotesTypes.js';

export const QuotesController = {
  // Quotes -----------------------------------------------------------

  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindQuotesQuery;
      const result = await QuotesService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const result = await QuotesService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateQuoteInput;
      const quote = await QuotesService.create(req.tenantId, input, req.userId ?? null);
      res.status(StatusCodes.CREATED).json(quote);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateQuoteInput;
      const quote = await QuotesService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(quote);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await QuotesService.remove(req.tenantId, id, req.userId ?? null);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  // Items ------------------------------------------------------------

  listItems: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const items = await QuotesService.findItems(req.tenantId, id);
      res.status(StatusCodes.OK).json({ items });
    } catch (err) {
      next(err);
    }
  },

  createItem: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as CreateQuoteItemInput;
      const result = await QuotesService.createItem(req.tenantId, id, input);
      res.status(StatusCodes.CREATED).json(result);
    } catch (err) {
      next(err);
    }
  },

  updateItem: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id, itemId } = req.params as { id: string; itemId: string };
      const input = req.body as UpdateQuoteItemInput;
      const result = await QuotesService.updateItem(req.tenantId, id, itemId, input);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  removeItem: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id, itemId } = req.params as { id: string; itemId: string };
      const result = await QuotesService.removeItem(req.tenantId, id, itemId);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  // Transições -------------------------------------------------------

  send: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const quote = await QuotesService.send(req.tenantId, id, req.userId ?? null);
      res.status(StatusCodes.OK).json(quote);
    } catch (err) {
      next(err);
    }
  },

  closeSale: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as CloseSaleInput;
      const result = await QuotesService.closeSale(
        req.tenantId,
        id,
        input,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  revertToDraft: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const quote = await QuotesService.revertToDraft(
        req.tenantId,
        id,
        req.userId ?? null
      );
      res.status(StatusCodes.OK).json(quote);
    } catch (err) {
      next(err);
    }
  },

  reject: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const quote = await QuotesService.reject(req.tenantId, id, req.userId ?? null);
      res.status(StatusCodes.OK).json(quote);
    } catch (err) {
      next(err);
    }
  },

  expire: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const quote = await QuotesService.expire(req.tenantId, id);
      res.status(StatusCodes.OK).json(quote);
    } catch (err) {
      next(err);
    }
  },
};
