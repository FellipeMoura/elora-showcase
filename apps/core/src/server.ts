// Tem que ser o PRIMEIRO import do app: o side-effect `extendZodWithOpenApi(z)`
// precisa rodar antes de qualquer schema `*Types.ts` que chame `.openapi(...)`.
// Imports são processados pela ordem do grafo de dependências, então pôr aqui
// no topo garante que o prototype do Zod esteja estendido antes de tudo.
import './shared/openapi/registry.js';

import { initSentry, setupSentryErrorHandler } from './shared/observability/sentry.js';

initSentry();

import { createServer as createHttpServer } from 'node:http';
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
import { redisSubscriber } from './shared/redis/redis.js';
import {
  initSocketServer,
  shutdownSocketServer,
  startRedisSubscriber,
  stopRedisSubscriber,
} from './shared/realtime/index.js';
import { syncReportsRegistry } from './modules/reports/syncRegistry.js';
import { startJobs, stopJobs } from './shared/jobs/index.js';

const app = express();
// Desabilita ETag global. Express liga por default em todo JSON, mas pra
// API isso causa 304 com body vazio em requests idênticos (ex:
// `/contracts/variables/resolve?clientId=X`) — axios entrega `data: ''` e
// react-query guarda payload corrompido. Cache de dados é responsabilidade
// do client (react-query), não da camada HTTP.
app.disable('etag');

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
    // One-liner: "GET /menus/visible → 200 (4ms)". Mensagem fica útil
    // mesmo quando `ignore` do pino-pretty esconde req/res.
    customSuccessMessage: (req, res, responseTime) =>
      `${req.method} ${req.url} → ${res.statusCode} (${Math.round(responseTime)}ms)`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${req.url} → ${res.statusCode} (${err.name})`,
    // Em modo enxuto, omite serialização de req/res — a mensagem custom já
    // tem method/url/status. LOG_VERBOSE=true mantém o default do pino-http.
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
app.use(express.json({ limit: '10mb' }));
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

// HTTP server explícito (não app.listen direto) pra socket.io poder
// fazer upgrade no mesmo port. Express é o request handler.
const httpServer = createHttpServer(app);
const io = initSocketServer(httpServer);

const server = httpServer.listen(env.port, () => {
  logger.info(`Core ouvindo em http://localhost:${env.port} (HTTP + Socket.IO)`);
  // Subscriber Redis começa depois do server escutar — assim quando o
  // primeiro evento chegar, há sockets prontos pra receber.
  void startRedisSubscriber(io);
  // Sync do catálogo de relatórios (registry em código → tabela reports).
  // Não bloqueia o boot: erro interno só loga e segue (relatórios ficam
  // indisponíveis até a próxima inicialização bem-sucedida).
  void syncReportsRegistry();
  // Scheduler BullMQ — worker dispatcha jobs do registry em shared/jobs.
  // `void` porque o boot do HTTP não depende disso.
  void startJobs();
});

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`${signal} recebido, encerrando...`);
  server.close(async () => {
    // Ordem: para de aceitar novos sockets/jobs → para subscriber → fecha pool.
    await shutdownSocketServer();
    await stopRedisSubscriber();
    await stopJobs();
    redisSubscriber.disconnect();
    await pool.end();
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
