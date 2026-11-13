import { redis } from '../redis/redis.js';
import { logger } from '../observability/logger.js';
import type { EventChannel, EventPayloadByChannel } from './events.js';

// =====================================================================
// EventBus — wrapper fino sobre Redis pub/sub pra publicar eventos
// canônicos (chat → core). Não bloqueia o caller: erro de publish é
// logado mas não interrompe o fluxo de domínio (a mensagem já foi
// persistida no DB; perder o pub/sub = atraso de UI, não corrupção).
// =====================================================================
export const eventBus = {
  publish: async <C extends EventChannel>(
    channel: C,
    payload: EventPayloadByChannel[C]
  ): Promise<void> => {
    try {
      const json = JSON.stringify(payload);
      const subscribers = await redis.publish(channel, json);
      logger.debug(
        { channel, subscribers, tenantId: payload.tenantId },
        `[eventBus] publish ${channel}`
      );
    } catch (err) {
      // Pub/sub é best-effort. Loga e segue — domínio já está consistente.
      logger.error(
        { err: err instanceof Error ? err.message : String(err), channel },
        '[eventBus] falha ao publicar evento'
      );
    }
  },
};
