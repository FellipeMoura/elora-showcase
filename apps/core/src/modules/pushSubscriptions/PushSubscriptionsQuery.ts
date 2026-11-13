import { and, eq, inArray, pushSubscriptions, sql, type Tx } from '@elora/db';
import type { PushSubscriptionRow } from './PushSubscriptionsTypes.js';

interface UpsertInput {
  tenantId: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

export const PushSubscriptionsQuery = {
  // Mesmo aparelho re-assinando (ou trocando de usuário no tenant): a linha
  // existente muda de dono e de chaves, nunca duplica.
  upsert: async (tx: Tx, input: UpsertInput): Promise<void> => {
    await tx
      .insert(pushSubscriptions)
      .values(input)
      .onConflictDoUpdate({
        target: [pushSubscriptions.tenantId, pushSubscriptions.endpoint],
        set: {
          userId: input.userId,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent,
          failureCount: 0,
          updatedAt: new Date(),
        },
      });
  },

  deleteByEndpoint: async (tx: Tx, userId: string, endpoint: string): Promise<void> => {
    await tx
      .delete(pushSubscriptions)
      .where(
        and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint))
      );
  },

  findByUserIds: async (tx: Tx, userIds: string[]): Promise<PushSubscriptionRow[]> => {
    if (userIds.length === 0) return [];
    return tx
      .select()
      .from(pushSubscriptions)
      .where(inArray(pushSubscriptions.userId, userIds));
  },

  markSuccess: async (tx: Tx, ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    await tx
      .update(pushSubscriptions)
      .set({ lastSuccessAt: new Date(), failureCount: 0 })
      .where(inArray(pushSubscriptions.id, ids));
  },

  incrementFailure: async (tx: Tx, ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    await tx
      .update(pushSubscriptions)
      .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
      .where(inArray(pushSubscriptions.id, ids));
  },

  deleteByIds: async (tx: Tx, ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    await tx.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, ids));
  },
};
