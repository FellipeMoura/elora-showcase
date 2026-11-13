import { Redis } from 'ioredis';
import { env } from '../../env.js';
import { logger } from '../observability/logger.js';

// Cliente Redis compartilhado. Usado por BullMQ workers e pelo eventBus
// (publica eventos canônicos consumidos pelo core via socket.io).
// `maxRetriesPerRequest: null` é exigência do BullMQ (driver não pode
// estourar exception em retry — fila assume reconnect transparente).
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
