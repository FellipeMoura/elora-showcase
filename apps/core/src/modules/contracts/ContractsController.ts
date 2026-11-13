import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '../../shared/errors/AppError.js';
import { ContractsService } from './ContractsService.js';
import type {
  CreateContractInput,
  FindContractsQuery,
} from './ContractsTypes.js';
import { getKnownVariableKeys } from './variableResolvers.js';

export const ContractsController = {
  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindContractsQuery;
      const result = await ContractsService.find(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const contract = await ContractsService.findById(req.tenantId, id);
      res.status(StatusCodes.OK).json(contract);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateContractInput;
      const contract = await ContractsService.create(
        req.tenantId,
        input,
        req.userId ?? null,
      );
      res.status(StatusCodes.CREATED).json(contract);
    } catch (err) {
      next(err);
    }
  },

  cancel: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const contract = await ContractsService.cancel(req.tenantId, id);
      res.status(StatusCodes.OK).json(contract);
    } catch (err) {
      next(err);
    }
  },

  copyLink: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const contract = await ContractsService.copyLink(req.tenantId, id);
      res.status(StatusCodes.OK).json(contract);
    } catch (err) {
      next(err);
    }
  },

  // Catálogo NÃO precisa de tenant — é estático. Usado pelo
  // ContractTemplateSheet pra marcar variáveis "conhecidas".
  listVariablesCatalog: (_req: Request, res: Response, next: NextFunction): void => {
    try {
      res.status(StatusCodes.OK).json(getKnownVariableKeys());
    } catch (err) {
      next(err);
    }
  },

  resolveVariables: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { clientId } = req.query as { clientId: string };
      const result = await ContractsService.resolveVariables(req.tenantId, clientId);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  // Bulk de termos de consentimento pendentes de uma venda (Fase 7).
  // 200 (não 201) porque pode criar 0 (tudo já ativo) e o corpo é um resumo
  // {created, skipped}, não um único recurso.
  generateConsentTermsForSale: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { saleId } = req.params as { saleId: string };
      const result = await ContractsService.generateConsentTermsForSale(
        req.tenantId,
        saleId,
        req.userId ?? null,
      );
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  downloadSignedPdf: async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const pdf = await ContractsService.downloadSignedPdf(req.tenantId, id);
      res.setHeader('Content-Type', pdf.mimeType);
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${pdf.filename}"`,
      );
      res.status(StatusCodes.OK).send(pdf.buffer);
    } catch (err) {
      next(err);
    }
  },
};
