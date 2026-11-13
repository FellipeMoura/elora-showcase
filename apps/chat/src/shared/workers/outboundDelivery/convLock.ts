import type { Redis } from 'ioredis';
import { redis } from '../../redis/redis.js';
import { CONV_LOCK_KEY_PREFIX, CONV_LOCK_TTL_SEC } from './types.js';

// Lua script atômico pra release seguro: só deleta a key se o value ainda
// bate. Sem isso, um lock que expirou por TTL e foi adquirido por outro job
// poderia ser liberado por engano pelo job antigo terminando tarde.
const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface AcquiredLock {
  release: () => Promise<void>;
}

// Tenta adquirir um lock pra `conversationId`. Retorna o handle se conseguiu,
// `null` se outro job já tem o lock. NÃO faz polling — caller decide se quer
// re-enfileirar o job (preserva worker slot) ou esperar.
export async function tryAcquireConvLock(
  conversationId: string,
  ownerId: string,
  client: Redis = redis,
): Promise<AcquiredLock | null> {
  const key = `${CONV_LOCK_KEY_PREFIX}${conversationId}`;
  const result = await client.set(key, ownerId, 'EX', CONV_LOCK_TTL_SEC, 'NX');
  if (result !== 'OK') return null;
  return {
    release: async () => {
      await client.eval(RELEASE_SCRIPT, 1, key, ownerId);
    },
  };
}
