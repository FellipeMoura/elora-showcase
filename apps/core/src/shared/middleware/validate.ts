import type { RequestHandler } from 'express';
import type { ZodIssue, ZodTypeAny } from 'zod';
import { AppError } from '../errors/AppError.js';

function buildDetails(issues: ZodIssue[]): { path: string; message: string }[] {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export const validateBody = (schema: ZodTypeAny): RequestHandler => {
  return async (req, _res, next) => {
    const result = await schema.safeParseAsync(req.body);
    if (!result.success) {
      return next(new AppError('Dados inválidos', 400, buildDetails(result.error.issues)));
    }
    req.body = result.data;
    next();
  };
};

export const validateQuery = (schema: ZodTypeAny): RequestHandler => {
  return async (req, _res, next) => {
    const result = await schema.safeParseAsync(req.query);
    if (!result.success) {
      return next(new AppError('Query inválida', 400, buildDetails(result.error.issues)));
    }
    req.query = result.data;
    next();
  };
};

export const validateParams = (schema: ZodTypeAny): RequestHandler => {
  return async (req, _res, next) => {
    const result = await schema.safeParseAsync(req.params);
    if (!result.success) {
      return next(
        new AppError('Parâmetros inválidos', 400, buildDetails(result.error.issues))
      );
    }
    req.params = result.data;
    next();
  };
};
