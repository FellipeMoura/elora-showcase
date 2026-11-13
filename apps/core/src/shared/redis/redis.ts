import { Redis } from 'ioredis';
import { env } from '../../env.js';
import { logger } from '../observability/logger.js';

// ioredis exige cliente DEDICADO pra modo SUBSCRIBE — depois de SUBSCRIBE
// nenhum comando normal (incluindo PUBLISH) pode rodar nesse cliente. Por
// isso mantemos duas instâncias: `redisSubscriber` consome eventos vindos
// do apps/chat, `redisPublisher` é usado quando o core também precisa
// publicar (ex.: `lead.created` quando journey lead nasce via helper
// `createExternalLead`).
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

export const redisPublisher = new Redis({
  host: env.redis.host,
  port: env.redis.port,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

redisPublisher.on('error', (err: Error) => {
  logger.error({ err: err.message }, 'Redis publisher erro de conexão');
});

redisPublisher.on('ready', () => {
  logger.info('Redis publisher conectado');
});
