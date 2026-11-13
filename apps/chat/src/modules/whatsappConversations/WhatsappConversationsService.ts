import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { WhatsappConversationsQuery } from './WhatsappConversationsQuery.js';
import type {
  WhatsappConversation,
  WindowStatus,
} from './WhatsappConversationsTypes.js';

const WINDOW_HOURS = 24;
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000;

// Sem Controller/Routes: módulo é usado internamente por webhook normalizer
// (passo 7) e outbound sender (passo 8). Caso precise expor admin no
// futuro, adicionar HTTP layer aqui.
export const WhatsappConversationsService = {
  findById: async (tenantId: string, id: string): Promise<WhatsappConversation> => {
    return withTenant(db, tenantId, async (tx) => {
      const conv = await WhatsappConversationsQuery.findById(tx, id);
      if (!conv) throw new AppError('whatsapp_conversation não encontrada', 404);
      return conv;
    });
  },

  // Idempotente. Corrida no unique (channel, contact) resolvida por ON CONFLICT.
  findOrCreate: async (
    tenantId: string,
    channelId: string,
    contactId: string,
    domainConversationId?: string
  ): Promise<WhatsappConversation> => {
    return withTenant(db, tenantId, async (tx) => {
      const existing = await WhatsappConversationsQuery.findByChannelAndContact(
        tx,
        channelId,
        contactId
      );
      if (existing) {
        // Se cheguei aqui com domainConversationId mas existing.conversationId
        // está null, oportuno linkar agora.
        if (domainConversationId && !existing.conversationId) {
          const linked = await WhatsappConversationsQuery.update(tx, existing.id, {
            conversationId: domainConversationId,
          });
          return linked ?? existing;
        }
        return existing;
      }

      // Idempotente por (canal, contato) via ON CONFLICT no Query.create.
      return WhatsappConversationsQuery.create(tx, tenantId, {
        whatsappChannelId: channelId,
        whatsappContactId: contactId,
        conversationId: domainConversationId,
      });
    });
  },

  linkToDomainConversation: async (
    tenantId: string,
    id: string,
    domainConversationId: string
  ): Promise<WhatsappConversation> => {
    return withTenant(db, tenantId, async (tx) => {
      const updated = await WhatsappConversationsQuery.update(tx, id, {
        conversationId: domainConversationId,
      });
      if (!updated) throw new AppError('whatsapp_conversation não encontrada', 404);
      return updated;
    });
  },

  touchInbound: async (tenantId: string, id: string): Promise<void> => {
    await withTenant(db, tenantId, async (tx) => {
      await WhatsappConversationsQuery.update(tx, id, { lastInboundAt: new Date() });
    });
  },

  touchOutbound: async (tenantId: string, id: string): Promise<void> => {
    await withTenant(db, tenantId, async (tx) => {
      await WhatsappConversationsQuery.update(tx, id, { lastOutboundAt: new Date() });
    });
  },

  // Janela 24h: avalia se o canal pode mandar texto livre ou só template.
  // Implementa a regra arquitetura.md §7.3 + chat-domain.md §9 nível 3.
  windowStatus: async (tenantId: string, id: string): Promise<WindowStatus> => {
    const conv = await WhatsappConversationsService.findById(tenantId, id);
    const lastInbound = conv.lastInboundAt;

    if (!lastInbound) {
      return { withinInboundWindow: false, lastInboundAt: null, hoursUntilExpiry: null };
    }

    const elapsed = Date.now() - lastInbound.getTime();
    const within = elapsed < WINDOW_MS;
    const hoursLeft = within ? (WINDOW_MS - elapsed) / (60 * 60 * 1000) : 0;

    return {
      withinInboundWindow: within,
      lastInboundAt: lastInbound,
      hoursUntilExpiry: within ? Math.round(hoursLeft * 10) / 10 : 0,
    };
  },
};
