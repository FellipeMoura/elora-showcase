import type { ErrorRequestHandler } from 'express';
import { StatusCodes } from 'http-status-codes';
import { AppError } from '../errors/AppError.js';
import { logger } from '../observability/logger.js';

export const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    logger.warn({ err: err.message, statusCode: err.statusCode }, 'AppError');
    res.status(err.statusCode).json({
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    });
    return;
  }

  logger.error({ err: err instanceof Error ? err.stack : err }, 'Erro não tratado');
  res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
    message: 'Erro interno do servidor',
  });
};
