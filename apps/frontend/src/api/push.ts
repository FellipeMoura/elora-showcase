import { coreApi } from './client'

// Endpoints de assinatura Web Push (apps/core/src/modules/pushSubscriptions).

export async function fetchVapidPublicKey(): Promise<string> {
  const res = await coreApi.get<{ publicKey: string }>('/push/vapid-public-key')
  return res.data.publicKey
}

export async function registerPushSubscription(sub: PushSubscriptionJSON): Promise<void> {
  await coreApi.post('/push/subscriptions', sub)
}

export async function unregisterPushSubscription(endpoint: string): Promise<void> {
  await coreApi.delete('/push/subscriptions', { data: { endpoint } })
}
