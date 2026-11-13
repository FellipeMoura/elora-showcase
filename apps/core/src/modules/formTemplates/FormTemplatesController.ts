import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { FormTemplatesService } from './FormTemplatesService.js';
import { AppError } from '../../shared/errors/AppError.js';
import type {
  CreateFormQuestionInput,
  CreateFormTemplateInput,
  FindFormTemplatesQuery,
  UpdateFormQuestionInput,
  UpdateFormTemplateInput,
} from './FormTemplatesTypes.js';

export const FormTemplatesController = {
  // Templates ---------------------------------------------------------

  find: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const query = req.query as unknown as FindFormTemplatesQuery;
      const result = await FormTemplatesService.findTemplates(req.tenantId, query);
      res.status(StatusCodes.OK).json(result);
    } catch (err) {
      next(err);
    }
  },

  getById: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const template = await FormTemplatesService.findTemplateById(req.tenantId, id);
      res.status(StatusCodes.OK).json(template);
    } catch (err) {
      next(err);
    }
  },

  create: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const input = req.body as CreateFormTemplateInput;
      const template = await FormTemplatesService.createTemplate(req.tenantId, input);
      res.status(StatusCodes.CREATED).json(template);
    } catch (err) {
      next(err);
    }
  },

  update: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as UpdateFormTemplateInput;
      const template = await FormTemplatesService.updateTemplate(req.tenantId, id, input);
      res.status(StatusCodes.OK).json(template);
    } catch (err) {
      next(err);
    }
  },

  remove: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      await FormTemplatesService.removeTemplate(req.tenantId, id);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },

  deactivate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const template = await FormTemplatesService.deactivateTemplate(req.tenantId, id);
      res.status(StatusCodes.OK).json(template);
    } catch (err) {
      next(err);
    }
  },

  activate: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const template = await FormTemplatesService.activateTemplate(req.tenantId, id);
      res.status(StatusCodes.OK).json(template);
    } catch (err) {
      next(err);
    }
  },

  // Questions ---------------------------------------------------------

  listQuestions: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const questions = await FormTemplatesService.findQuestionsByTemplate(req.tenantId, id);
      res.status(StatusCodes.OK).json({ items: questions });
    } catch (err) {
      next(err);
    }
  },

  createQuestion: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id } = req.params as { id: string };
      const input = req.body as CreateFormQuestionInput;
      const question = await FormTemplatesService.createQuestion(req.tenantId, id, input);
      res.status(StatusCodes.CREATED).json(question);
    } catch (err) {
      next(err);
    }
  },

  updateQuestion: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id, questionId } = req.params as { id: string; questionId: string };
      const input = req.body as UpdateFormQuestionInput;
      const question = await FormTemplatesService.updateQuestion(
        req.tenantId,
        id,
        questionId,
        input
      );
      res.status(StatusCodes.OK).json(question);
    } catch (err) {
      next(err);
    }
  },

  removeQuestion: async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.tenantId) throw new AppError('Tenant não inicializado', 500);
      const { id, questionId } = req.params as { id: string; questionId: string };
      await FormTemplatesService.removeQuestion(req.tenantId, id, questionId);
      res.status(StatusCodes.NO_CONTENT).send();
    } catch (err) {
      next(err);
    }
  },
};
