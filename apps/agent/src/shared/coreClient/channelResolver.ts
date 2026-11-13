import { eq, whatsappChannels, withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { logger } from '../../shared/observability/logger.js';

// =====================================================================
// ChannelResolver — cache em memória do que o IdleTriggerScheduler precisa
// pra decidir cutoff temporal por canal. Hoje só `agent_starts_at`. Mesmo
// pattern do tenantResolver: load-once por processo. Invalidação manual
// quando UI permitir editar/resetar o timestamp.
// =====================================================================

export interface ChannelInfo {
  id: string;
  tenantId: string;
  agentStartsAt: Date;
}

const cache = new Map<string, ChannelInfo>();

async function load(tenantId: string, channelId: string): Promise<ChannelInfo> {
  const result = await withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({
        id: whatsappChannels.id,
        tenantId: whatsappChannels.tenantId,
        agentStartsAt: whatsappChannels.agentStartsAt,
      })
      .from(whatsappChannels)
      .where(eq(whatsappChannels.id, channelId))
      .limit(1);
    return row ?? null;
  });

  if (!result) {
    throw new AppError(`Canal WhatsApp ${channelId} não encontrado`, 404);
  }

  logger.debug(
    {
      tenantId,
      channelId,
      agentStartsAt: result.agentStartsAt.toISOString(),
    },
    '[channelResolver] carregado',
  );

  return result;
}

export const channelResolver = {
  /**
   * Retorna o ChannelInfo cacheado. Primeira chamada por canal bate no DB.
   */
  byChannelId: async (
    tenantId: string,
    channelId: string,
  ): Promise<ChannelInfo> => {
    const cached = cache.get(channelId);
    if (cached) return cached;
    const info = await load(tenantId, channelId);
    cache.set(channelId, info);
    return info;
  },

  /**
   * Invalida cache pra um canal. Chamada quando UI permitir resetar
   * `agent_starts_at` (ex.: botão "começar do zero" em config do canal).
   */
  invalidate: (channelId: string): void => {
    cache.delete(channelId);
    logger.debug({ channelId }, '[channelResolver] cache invalidado');
  },

  clear: (): void => {
    cache.clear();
  },
};
