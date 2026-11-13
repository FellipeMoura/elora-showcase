import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import { requestContextStorage } from '../observability/requestContext.js';

export const requestContextMiddleware: RequestHandler = (req, res, next) => {
  const requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  res.setHeader('x-request-id', requestId);

  requestContextStorage.run({ requestId }, () => {
    next();
  });
};
