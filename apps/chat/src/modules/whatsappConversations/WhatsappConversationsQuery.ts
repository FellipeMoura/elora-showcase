import {
  and,
  eq,
  type Tx,
  whatsappConversations,
} from '@elora/db';
import type { WhatsappConversation } from './WhatsappConversationsTypes.js';

interface CreateInput {
  whatsappChannelId: string;
  whatsappContactId: string;
  conversationId?: string;
}

interface UpdatePatch {
  conversationId?: string | null;
  lastInboundAt?: Date;
  lastOutboundAt?: Date;
}

export const WhatsappConversationsQuery = {
  findById: async (
    tx: Tx,
    id: string
  ): Promise<WhatsappConversation | undefined> => {
    const [conv] = await tx
      .select()
      .from(whatsappConversations)
      .where(eq(whatsappConversations.id, id))
      .limit(1);
    return conv;
  },

  findByChannelAndContact: async (
    tx: Tx,
    channelId: string,
    contactId: string
  ): Promise<WhatsappConversation | undefined> => {
    const [conv] = await tx
      .select()
      .from(whatsappConversations)
      .where(
        and(
          eq(whatsappConversations.whatsappChannelId, channelId),
          eq(whatsappConversations.whatsappContactId, contactId),
        )
      )
      .limit(1);
    return conv;
  },

  findByDomainConversationId: async (
    tx: Tx,
    domainConversationId: string
  ): Promise<WhatsappConversation | undefined> => {
    const [conv] = await tx
      .select()
      .from(whatsappConversations)
      .where(eq(whatsappConversations.conversationId, domainConversationId))
      .limit(1);
    return conv;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<WhatsappConversation> => {
    const [conv] = await tx
      .insert(whatsappConversations)
      .values({
        tenantId,
        whatsappChannelId: input.whatsappChannelId,
        whatsappContactId: input.whatsappContactId,
        conversationId: input.conversationId,
      })
      // Colisão no unique (canal, contato) devolve a linha existente sem
      // erro — um catch de 23505 abortaria a transação do caller.
      .onConflictDoNothing({
        target: [whatsappConversations.whatsappChannelId, whatsappConversations.whatsappContactId],
      })
      .returning();
    if (conv) return conv;
    const existing = await WhatsappConversationsQuery.findByChannelAndContact(
      tx,
      input.whatsappChannelId,
      input.whatsappContactId
    );
    if (!existing) throw new Error('Falha ao inserir whatsapp_conversation');
    return existing;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch
  ): Promise<WhatsappConversation | undefined> => {
    const [conv] = await tx
      .update(whatsappConversations)
      .set(patch)
      .where(eq(whatsappConversations.id, id))
      .returning();
    return conv;
  },
};
