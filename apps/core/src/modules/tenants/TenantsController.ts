import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '../../shared/errors/AppError.js';
import { TenantsService } from './TenantsService.js';
import type {
  CreateTenantInput,
  UpdateTenantInput,
} from './TenantsTypes.js';

// Multer com memoryStorage anexa `req.file` com o Buffer já carregado.
// Reusa o mesmo padrão do chat (uploadMedia) — 20MB de teto lá é
// generoso; pra logo, 5MB é mais do que suficiente e mora no route file.
type MulterFile = Express.Multer.File;

// Endpoints de super-admin — protegidos por `requirePlatformAccess` na
// camada de rota. `tenants` é tabela global sem RLS, então o service usa
// `db` direto (não `withTenant`).
export const TenantsController = {
  list: async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const items = await TenantsService.list();
      res.status(StatusCodes.OK).json({ items });
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const tenant = await TenantsService.findById(id);
      res.status(StatusCodes.OK).json(tenant);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const input = req.body as CreateTenantInput;
      const tenant = await TenantsService.create(input);
      res.status(StatusCodes.CREATED).json(tenant);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const input = req.body as UpdateTenantInput;
      const tenant = await TenantsService.update(id, input);
      res.status(StatusCodes.OK).json(tenant);
    } catch (err) {
      next(err);
    }
  },

  uploadLogo: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const file = (req as Request & { file?: MulterFile }).file;
      if (!file) {
        throw new AppError('Arquivo obrigatório no campo "file"', 400);
      }
      const result = await TenantsService.uploadLogo(id, {
        buffer: file.buffer,
        mimeType: file.mimetype,
      });
      res.status(StatusCodes.CREATED).json(result);
    } catch (err) {
      next(err);
    }
  },

  deleteLogo: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const tenant = await TenantsService.deleteLogo(id);
      res.status(StatusCodes.OK).json(tenant);
    } catch (err) {
      next(err);
    }
  },

  getLogoUrl: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { id } = req.params as { id: string };
      const result = await TenantsService.getLogoUrl(id);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },
};
