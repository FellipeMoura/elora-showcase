import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '../../shared/errors/AppError.js';
import { ReportsService } from './ReportsService.js';

export const ReportsController = {
  // GET /reports — lista visíveis ao user autenticado.
  listVisible: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Não autenticado', 401);
      const items = await ReportsService.listVisible(req.tenantId, req.userId);
      res.status(StatusCodes.OK).json({ items });
    } catch (err) {
      next(err);
    }
  },

  // GET /reports/:slug — metadata. Só retorna se user enxerga o relatório.
  getDetail: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Não autenticado', 401);
      const { slug } = req.params as { slug: string };
      const report = await ReportsService.getDetail(
        slug,
        req.tenantId,
        req.userId
      );
      res.status(StatusCodes.OK).json(report);
    } catch (err) {
      next(err);
    }
  },

  // POST /reports/:slug/run — executa. Body = params do relatório (shape
  // varia por slug; validação fica no Service via paramsSchema do handler).
  run: async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      if (!req.userId) throw new AppError('Não autenticado', 401);
      const { slug } = req.params as { slug: string };
      const result = await ReportsService.run(
        slug,
        req.body,
        req.tenantId,
        req.userId
      );
      res.status(StatusCodes.OK).json({
        meta: {
          generatedAt: new Date().toISOString(),
          tenantId: req.tenantId,
          userId: req.userId,
          slug: result.slug,
        },
        data: result.data,
      });
    } catch (err) {
      next(err);
    }
  },
};
