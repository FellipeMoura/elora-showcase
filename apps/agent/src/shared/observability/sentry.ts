import * as Sentry from '@sentry/node';
import type { Express } from 'express';
import { env, isProd } from '../../env.js';
import { logger } from './logger.js';

export function initSentry(): void {
  if (!env.sentry.dsn) {
    if (isProd) logger.warn('SENTRY_DSN não configurado em produção');
    return;
  }

  Sentry.init({
    dsn: env.sentry.dsn,
    environment: env.nodeEnv,
    release: env.appVersion,
    tracesSampleRate: env.sentry.tracesSampleRate,
  });

  logger.info('Sentry inicializado');
}

export function setupSentryErrorHandler(app: Express): void {
  if (!env.sentry.dsn) return;
  Sentry.setupExpressErrorHandler(app);
}
