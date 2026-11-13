import { eq, type Tx, whatsappMessages } from '@elora/db';
import type { WhatsappMessage } from './WhatsappMessagesTypes.js';

type Direction = 'inbound' | 'outbound';

interface CreateInput {
  tenantId: string;
  whatsappConversationId: string;
  externalId?: string;
  direction: Direction;
  payloadType: string;
  payload?: Record<string, unknown>;
  status?: string;
  statusUpdatedAt?: Date;
  errorMessage?: string;
  sentAt?: Date;
}

interface UpdateStatusInput {
  status: string;
  statusUpdatedAt?: Date;
  errorMessage?: string;
}

interface FinalizeOutboxInput {
  externalId: string;
  payloadType: string;
  payload: Record<string, unknown>;
  status: string;
  sentAt: Date;
}

export const WhatsappMessagesQuery = {
  findById: async (tx: Tx, id: string): Promise<WhatsappMessage | undefined> => {
    const [msg] = await tx
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.id, id))
      .limit(1);
    return msg;
  },

  findByExternalId: async (
    tx: Tx,
    externalId: string
  ): Promise<WhatsappMessage | undefined> => {
    const [msg] = await tx
      .select()
      .from(whatsappMessages)
      .where(eq(whatsappMessages.externalId, externalId))
      .limit(1);
    return msg;
  },

  create: async (tx: Tx, input: CreateInput): Promise<WhatsappMessage> => {
    const [msg] = await tx
      .insert(whatsappMessages)
      .values(input)
      .returning();
    if (!msg) throw new Error('Falha ao inserir whatsapp_message');
    return msg;
  },

  updateStatusByExternalId: async (
    tx: Tx,
    externalId: string,
    patch: UpdateStatusInput
  ): Promise<WhatsappMessage | undefined> => {
    const [msg] = await tx
      .update(whatsappMessages)
      .set({
        status: patch.status,
        statusUpdatedAt: patch.statusUpdatedAt ?? new Date(),
        errorMessage: patch.errorMessage,
      })
      .where(eq(whatsappMessages.externalId, externalId))
      .returning();
    return msg;
  },

  // Fecha a row de outbox pré-inserida pelo OutboundDeliveryWorker antes de
  // chamar provider.send — preenche externalId + payload reais retornados
  // pelo adapter. Retorna a row atualizada; undefined se sumiu (cleanup
  // manual ou bug).
  finalizeOutbox: async (
    tx: Tx,
    id: string,
    patch: FinalizeOutboxInput,
  ): Promise<WhatsappMessage | undefined> => {
    const [msg] = await tx
      .update(whatsappMessages)
      .set({
        externalId: patch.externalId,
        payloadType: patch.payloadType,
        payload: patch.payload,
        status: patch.status,
        sentAt: patch.sentAt,
      })
      .where(eq(whatsappMessages.id, id))
      .returning();
    return msg;
  },

  // Marca outbox row como falha (adapter throw ou retorno failed). Preserva
  // a row pra auditoria — mais simples que DELETE, e o reconciler/UI usa o
  // status='failed' pra esconder das listagens normais.
  markOutboxFailed: async (
    tx: Tx,
    id: string,
    errorMessage: string,
  ): Promise<void> => {
    await tx
      .update(whatsappMessages)
      .set({
        status: 'failed',
        statusUpdatedAt: new Date(),
        errorMessage,
      })
      .where(eq(whatsappMessages.id, id));
  },
};
