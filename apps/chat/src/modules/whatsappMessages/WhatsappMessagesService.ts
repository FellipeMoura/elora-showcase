import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { WhatsappMessagesQuery } from './WhatsappMessagesQuery.js';
import type { WhatsappMessage } from './WhatsappMessagesTypes.js';

type Direction = 'inbound' | 'outbound';

interface CreateInboundInput {
  whatsappConversationId: string;
  externalId: string;
  payloadType: string;
  payload: Record<string, unknown>;
  sentAt: Date;
}

interface CreateOutboundInput {
  whatsappConversationId: string;
  externalId?: string;
  payloadType: string;
  payload: Record<string, unknown>;
  status?: string;
  sentAt?: Date;
}

export const WhatsappMessagesService = {
  findById: async (tenantId: string, id: string): Promise<WhatsappMessage> => {
    return withTenant(db, tenantId, async (tx) => {
      const msg = await WhatsappMessagesQuery.findById(tx, id);
      if (!msg) throw new AppError('Mensagem WhatsApp não encontrada', 404);
      return msg;
    });
  },

  findByExternalId: async (
    tenantId: string,
    externalId: string
  ): Promise<WhatsappMessage | undefined> => {
    return withTenant(db, tenantId, async (tx) => {
      return WhatsappMessagesQuery.findByExternalId(tx, externalId);
    });
  },

  // Persiste mensagem inbound vinda do webhook normalizer (passo 7).
  recordInbound: async (
    tenantId: string,
    input: CreateInboundInput
  ): Promise<WhatsappMessage> => {
    return withTenant(db, tenantId, async (tx) => {
      // Idempotência: se já existe por externalId, retorna existente.
      // Webhooks são frequentemente retried pelo provider.
      const existing = await WhatsappMessagesQuery.findByExternalId(tx, input.externalId);
      if (existing) return existing;

      return WhatsappMessagesQuery.create(tx, {
        tenantId,
        whatsappConversationId: input.whatsappConversationId,
        externalId: input.externalId,
        direction: 'inbound',
        payloadType: input.payloadType,
        payload: input.payload,
        sentAt: input.sentAt,
      });
    });
  },

  // Persiste mensagem outbound antes/depois do adapter mandar (passo 8).
  // externalId pode ser null inicialmente — provider retorna no callback.
  recordOutbound: async (
    tenantId: string,
    input: CreateOutboundInput
  ): Promise<WhatsappMessage> => {
    return withTenant(db, tenantId, async (tx) => {
      return WhatsappMessagesQuery.create(tx, {
        tenantId,
        whatsappConversationId: input.whatsappConversationId,
        externalId: input.externalId,
        direction: 'outbound' as Direction,
        payloadType: input.payloadType,
        payload: input.payload,
        status: input.status,
        sentAt: input.sentAt,
      });
    });
  },

  // Webhook de status do provider (sent → delivered → read, ou failed).
  // Match por externalId. Se não encontrar, mensagem não passou por nós —
  // log e ignora.
  updateStatusByExternalId: async (
    tenantId: string,
    externalId: string,
    status: string,
    errorMessage?: string
  ): Promise<WhatsappMessage | undefined> => {
    return withTenant(db, tenantId, async (tx) => {
      return WhatsappMessagesQuery.updateStatusByExternalId(tx, externalId, {
        status,
        statusUpdatedAt: new Date(),
        errorMessage,
      });
    });
  },
};
