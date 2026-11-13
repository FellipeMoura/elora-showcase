import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '../../shared/errors/AppError.js';
import { ContractTemplatesService } from './ContractTemplatesService.js';
import type {
  CreateContractTemplateInput,
  FindContractTemplatesQuery,
  UpdateContractTemplateInput,
} from './ContractTemplatesTypes.js';

export const ContractTemplatesController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindContractTemplatesQuery;
      const result = await ContractTemplatesService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const template = await ContractTemplatesService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(template);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateContractTemplateInput;
      const template = await ContractTemplatesService.create(req.tenantId, input);
      res.status(StatusCodes.CREATED).json(template);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateContractTemplateInput;
      const template = await ContractTemplatesService.update(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(template);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await ContractTemplatesService.remove(req.tenantId, id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  // =====================================================================
  // Vínculo template × procedimento (Fase 7). Devolvem a lista atualizada.
  // =====================================================================

  listProcedures: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const procedures = await ContractTemplatesService.listProcedures(req.tenantId, id);
      res.status(StatusCodes.OK).json(procedures);
    } catch (err) {
      next(err);
    }
  },

  linkProcedure: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const { procedureId } = req.body as { procedureId: string };
      const procedures = await ContractTemplatesService.linkProcedure(
        req.tenantId,
        id,
        procedureId,
      );
      res.status(StatusCodes.OK).json(procedures);
    } catch (err) {
      next(err);
    }
  },

  unlinkProcedure: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id, procedureId } = req.params as { id: string; procedureId: string };
      const procedures = await ContractTemplatesService.unlinkProcedure(
        req.tenantId,
        id,
        procedureId,
      );
      res.status(StatusCodes.OK).json(procedures);
    } catch (err) {
      next(err);
    }
  },

  // =====================================================================
  // ZapSign helpers (sem tenant scope — provider é singleton da plataforma).
  // =====================================================================

  getZapsignPanelInfo: (_req: Request, res: Response, next: NextFunction): void => {
    try {
      const info = ContractTemplatesService.getZapsignPanelInfo();
      res.status(StatusCodes.OK).json(info);
    } catch (err) {
      next(err);
    }
  },

  inspectZapsignTemplate: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const { zapsignTemplateId } = req.params as { zapsignTemplateId: string };
      const info = await ContractTemplatesService.inspectZapsignTemplate(
        zapsignTemplateId,
      );
      res.status(StatusCodes.OK).json(info);
    } catch (err) {
      next(err);
    }
  },

  listZapsignTemplates: async (
    _req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const list = await ContractTemplatesService.listZapsignTemplates();
      res.status(StatusCodes.OK).json(list);
    } catch (err) {
      next(err);
    }
  },
};
