import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { isPushConfigured, vapidPublicKey } from '../../shared/push/webPushClient.js';
import { PushSubscriptionsQuery } from './PushSubscriptionsQuery.js';
import type {
  RegisterPushSubscriptionInput,
  UnregisterPushSubscriptionInput,
} from './PushSubscriptionsTypes.js';

function assertConfigured(): void {
  if (!isPushConfigured()) {
    throw new AppError('Notificações push não configuradas neste ambiente', 501);
  }
}

export const PushSubscriptionsService = {
  getPublicKey: (): string => {
    assertConfigured();
    return vapidPublicKey()!;
  },

  register: async (
    tenantId: string,
    userId: string,
    input: RegisterPushSubscriptionInput,
    userAgent: string | null
  ): Promise<void> => {
    assertConfigured();
    await withTenant(db, tenantId, (tx) =>
      PushSubscriptionsQuery.upsert(tx, {
        tenantId,
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        userAgent: userAgent ? userAgent.slice(0, 512) : null,
      })
    );
  },

  // Idempotente: endpoint desconhecido (ou de outro usuário) não é erro —
  // o front chama no logout sem saber se a linha ainda existe.
  unregister: async (
    tenantId: string,
    userId: string,
    input: UnregisterPushSubscriptionInput
  ): Promise<void> => {
    await withTenant(db, tenantId, (tx) =>
      PushSubscriptionsQuery.deleteByEndpoint(tx, userId, input.endpoint)
    );
  },
};
