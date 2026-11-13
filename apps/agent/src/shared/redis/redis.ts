import { Redis } from 'ioredis';
import { env } from '../../env.js';
import { logger } from '../observability/logger.js';

// Cliente Redis principal (BullMQ workers, rate limit, cost cap).
// `maxRetriesPerRequest: null` é exigência do BullMQ — fila assume reconnect
// transparente. Mesma config do apps/chat.
export const redis = new Redis({
  host: env.redis.host,
  port: env.redis.port,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redis.on('error', (err: Error) => {
  logger.error({ err: err.message }, 'Redis erro de conexão');
});

redis.on('ready', () => {
  logger.info('Redis conectado');
});

// Cliente DEDICADO pra modo SUBSCRIBE — ioredis bloqueia comandos normais
// num cliente subscrito. Padrão espelha apps/core/src/shared/redis/redis.ts.
// Usado por modules/triggers/InboundSubscriber + HumanReplyCanceller.
export const redisSubscriber = new Redis({
  host: env.redis.host,
  port: env.redis.port,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redisSubscriber.on('error', (err: Error) => {
  logger.error({ err: err.message }, 'Redis subscriber erro de conexão');
});

redisSubscriber.on('ready', () => {
  logger.info('Redis subscriber conectado');
});
