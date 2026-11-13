import pino from 'pino';
import { env, isDev } from '../../env.js';
import { getRequestContext } from './requestContext.js';

// Ver comentário em apps/core/src/shared/observability/logger.ts — mesmo padrão.
const prettyOptions = isDev
  ? {
      colorize: true,
      translateTime: 'HH:MM:ss.l',
      ignore: env.logVerbose
        ? 'pid,hostname'
        : 'pid,hostname,req,res,responseTime,reqId,requestId',
      singleLine: !env.logVerbose,
    }
  : undefined;

const baseLogger = pino({
  level: isDev ? 'debug' : 'info',
  base: { app: 'chat', env: env.nodeEnv },
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  transport: prettyOptions
    ? { target: 'pino-pretty', options: prettyOptions }
    : undefined,
});

// Wrapper que injeta automaticamente o contexto da request (request_id, tenant_id, user_id) em cada log.
function withContext(method: 'info' | 'error' | 'warn' | 'debug') {
  return (objOrMsg: object | string, msg?: string) => {
    const ctx = getRequestContext();
    if (typeof objOrMsg === 'string') {
      baseLogger[method](ctx ?? {}, objOrMsg);
    } else {
      baseLogger[method]({ ...ctx, ...objOrMsg }, msg);
    }
  };
}

export const logger = {
  info: withContext('info'),
  error: withContext('error'),
  warn: withContext('warn'),
  debug: withContext('debug'),
  raw: baseLogger,
};
