import { Redis } from 'ioredis';
import { env } from '../../env.js';
import { logger } from '../observability/logger.js';

// Cliente Redis DEDICADO pro BullMQ scheduler do core.
//
// O `redisSubscriber`/`redisPublisher` existentes em `shared/redis/redis.ts`
// são pra pub/sub puro (eventos canônicos do chat). BullMQ exige um cliente
// próprio com `maxRetriesPerRequest: null` — sem isso, comandos blocking
// (`BRPOPLPUSH`, etc.) podem estourar exception em retry e derrubar o worker.
//
// Por que cliente dedicado em vez de reusar o publisher: BullMQ acrescenta
// listeners pesados de stream/events em todo cliente compartilhado, e nosso
// publisher tem fluxo crítico (lead.created, message.*). Isolar evita um
// gargalo de fila degradar o caminho de eventos.
export const jobsRedis = new Redis({
  host: env.redis.host,
  port: env.redis.port,
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

jobsRedis.on('error', (err: Error) => {
  logger.error({ err: err.message }, '[jobs] Redis erro de conexão');
});

jobsRedis.on('ready', () => {
  logger.info('[jobs] Redis conectado');
});
