// Tem que ser o PRIMEIRO import do app: o side-effect `extendZodWithOpenApi(z)`
// precisa rodar antes de qualquer schema `*Types.ts` que chame `.openapi(...)`.
// Imports são processados pela ordem do grafo de dependências, então pôr aqui
// no topo garante que o prototype do Zod esteja estendido antes de tudo.
import './shared/openapi/registry.js';

import { initSentry, setupSentryErrorHandler } from './shared/observability/sentry.js';

initSentry();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { pinoHttp } from 'pino-http';
import { env } from './env.js';
import { corsOptions } from './shared/http/cors.js';
import { publicRoutes, tenantRoutes } from './routes.js';
import { logger } from './shared/observability/logger.js';
import { requestContextMiddleware } from './shared/middleware/requestContext.js';
import { handleError } from './shared/middleware/handleError.js';
import { notFound } from './shared/middleware/notFound.js';
import { pool } from './shared/database/db.js';
import { redis } from './shared/redis/redis.js';
import {
  startInboundWorker,
  stopInboundWorker,
} from './shared/workers/inboundNormalizer/index.js';
import {
  startOutboundWorker,
  stopOutboundWorker,
} from './shared/workers/outboundDelivery/index.js';
import {
  startOutboundReconciler,
  stopOutboundReconciler,
} from './shared/workers/outboundDelivery/reconciler.js';

const app = express();

app.use(requestContextMiddleware);
app.use(
  pinoHttp({
    logger: logger.raw,
    customLogLevel: (req, res, err) => {
      if (err) return 'error';
      if (res.statusCode >= 500) return 'error';
      // Webhook retornando 410 = canal órfão / desativado. O Controller já
      // logou WARN dedupado no PRIMEIRO hit; pinoHttp aqui silencia o resto
      // pra evitar enchente de WARN em produção quando alguma instância
      // Evolution insiste em chamar um channelId que não existe mais.
      if (
        res.statusCode === 410 &&
        (req.url ?? '').startsWith('/webhook/')
      ) {
        return 'silent';
      }
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
  })
);

// Allowlist de origem (shared/http/cors.ts) — nunca `origin: true` com
// credentials, que deixaria qualquer site ler a API com o cookie da sessão.
app.use(cors(corsOptions));
app.use(cookieParser());
// `verify` preserva o body bruto em req.rawBody — necessário pros adapters
// de WhatsApp que validam HMAC sobre os bytes exatos recebidos (BSP/Meta).
// Custo é manter o Buffer em memória até o handler responder — ok pros
// payloads de webhook (<1MB normalmente).
app.use(
  express.json({
    limit: '10mb',
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((_req, res, next) => {
  res.setHeader('X-App-Version', env.appVersion);
  next();
});

app.use(publicRoutes);
app.use(tenantRoutes);
app.use(notFound);
setupSentryErrorHandler(app);
app.use(handleError);

const server = app.listen(env.port, () => {
  logger.info(`Chat ouvindo em http://localhost:${env.port}`);
  // Sobe os Workers BullMQ depois do HTTP estar listening. Mesma instância
  // de processo serve HTTP + workers — simplifica deploy. Quando crescer,
  // pode separar (worker em processo dedicado) sem mudar contrato.
  startInboundWorker();
  startOutboundWorker();
  // Reconciler: vasculha messages outbound 'pending' há mais que 5min e
  // marca como failed/worker_timeout — fecha o loop quando o worker travou
  // ou foi morto a meio caminho.
  startOutboundReconciler();
});

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} recebido, encerrando...`);
  server.close(async () => {
    // Workers primeiro: deixa jobs em voo terminarem antes do pool fechar.
    await stopOutboundReconciler();
    await stopOutboundWorker();
    await stopInboundWorker();
    await pool.end();
    redis.disconnect();
    logger.info('Encerramento concluído');
    process.exit(0);
  });
  setTimeout(() => {
    logger.error('Forçando saída após timeout de 10s');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
