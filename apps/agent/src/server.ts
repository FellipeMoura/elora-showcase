import { initSentry, setupSentryErrorHandler } from './shared/observability/sentry.js';

initSentry();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './env.js';
import { publicRoutes } from './routes.js';
import { logger } from './shared/observability/logger.js';
import { requestContextMiddleware } from './shared/middleware/requestContext.js';
import { handleError } from './shared/middleware/handleError.js';
import { notFound } from './shared/middleware/notFound.js';
import { pool } from './shared/database/db.js';
import { redis, redisSubscriber } from './shared/redis/redis.js';
import { startTriggers, stopTriggers } from './modules/triggers/index.js';

const app = express();

app.use(requestContextMiddleware);
app.use(
  pinoHttp({
    logger: logger.raw,
    customLogLevel: (_req, res, err) => {
      if (err) return 'error';
      if (res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    customSuccessMessage: (req, res, responseTime) =>
      `${req.method} ${req.url} → ${res.statusCode} (${Math.round(responseTime)}ms)`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${req.url} → ${res.statusCode} (${err.name})`,
    ...(env.logVerbose
      ? {}
      : {
          serializers: {
            req: () => ({}),
            res: () => ({}),
          },
        }),
  }),
);

app.use(
  cors({
    origin: true,
    credentials: true,
    exposedHeaders: ['X-App-Version', 'X-Request-Id'],
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: '1mb' }));

app.use((_req, res, next) => {
  res.setHeader('X-App-Version', env.appVersion);
  next();
});

app.use(publicRoutes);
app.use(notFound);
setupSentryErrorHandler(app);
app.use(handleError);

const server = app.listen(env.port, async () => {
  logger.info(
    {
      port: env.port,
      globalKillSwitch: env.agent.globalKillSwitch,
      defaultModel: env.agent.defaultModel,
    },
    `Agent ouvindo em http://localhost:${env.port}`,
  );

  if (env.agent.globalKillSwitch) {
    logger.warn(
      'AGENT_GLOBAL_KILL_SWITCH=true — triggers enfileiram, worker recebe e drop sem ação (sem custo de IA). Útil pra validar pipeline antes do PR 5.',
    );
  }

  // PR 4: triggers sobem. InboundSubscriber + HumanReplyCanceller assinam
  // canais Redis, worker BullMQ consome agent-trigger queue (só loga até
  // PR 5 plugar o AgentRunner).
  await startTriggers();
});

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} recebido, encerrando...`);
  server.close(async () => {
    // Triggers primeiro pra parar de enfileirar; depois pool.end (drena
    // queries pendentes); por último disconnect dos redis clients.
    await stopTriggers();
    await pool.end();
    redis.disconnect();
    redisSubscriber.disconnect();
    logger.info('Encerramento concluído');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forçando saída após timeout de 10s');
    process.exit(1);
  }, 10_000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
