import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { WhatsappMessagesService } from './WhatsappMessagesService.js';
import { AppError } from '../../shared/errors/AppError.js';

// Endpoint admin pra debug — inspecionar payload bruto/status de uma mensagem
// WhatsApp específica. Sem list endpoint: volume é alto e a UI usa o domain
// messages como fonte canônica.
export const WhatsappMessagesController = {
  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const msg = await WhatsappMessagesService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(msg);
    } catch (err) {
      next(err);
    }
  },
};
