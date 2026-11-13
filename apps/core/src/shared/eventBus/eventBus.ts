import type {
  EventChannel,
  EventPayloadByChannel,
} from '@elora/events-contracts';
import { logger } from '../observability/logger.js';
import { redisPublisher } from '../redis/redis.js';

// =====================================================================
// EventBus — wrapper fino sobre Redis pub/sub pra o core PUBLICAR eventos
// canônicos. Espelha o eventBus do apps/chat: mesma assinatura, mesma
// estratégia "best-effort" (erro de publish é logado mas não interrompe o
// fluxo de domínio — a entidade já está consistente no DB).
//
// Quem consome o que o core publica? O próprio core, via redisSubscriber:
// o subscriber roda no mesmo processo, recebe a mensagem e repassa pros
// sockets conectados (pattern fan-out). Isso evita acoplamento direto
// "publicar = io.to().emit()" e mantém o caminho do evento simétrico ao
// do chat → core.
// =====================================================================
export const eventBus = {
  publish: async <C extends EventChannel>(
    channel: C,
    payload: EventPayloadByChannel[C]
  ): Promise<void> => {
    try {
      const json = JSON.stringify(payload);
      const subscribers = await redisPublisher.publish(channel, json);
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
