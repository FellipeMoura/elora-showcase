import { pushSubscriptions, type InferSelectModel } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type PushSubscriptionRow = InferSelectModel<typeof pushSubscriptions>;

// Hosts dos serviços de push dos navegadores. O core faz POST na URL que o
// navegador devolveu em `pushManager.subscribe()` — sem allowlist, um
// usuário logado poderia cadastrar `http://127.0.0.1:5702/...` e usar o
// core pra bater em serviço interno (SSRF). Navegador novo com serviço
// próprio entra aqui.
const PUSH_SERVICE_HOST_SUFFIXES = [
  'fcm.googleapis.com', // Chrome, Edge (Android), Opera, Samsung Internet
  'push.services.mozilla.com', // Firefox
  'push.apple.com', // Safari macOS/iOS (web.push.apple.com)
  'notify.windows.com', // Edge desktop (WNS)
] as const;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  return PUSH_SERVICE_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`)
  );
}

// Formato de `PushSubscription.toJSON()` do navegador.
export const registerPushSubscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .max(2048)
      .refine(isAllowedPushEndpoint, 'Endpoint de push não suportado')
      .openapi({ example: 'https://fcm.googleapis.com/fcm/send/abc123' }),
    keys: z.object({
      p256dh: z.string().min(1).max(255),
      auth: z.string().min(1).max(255),
    }),
  })
  .openapi('RegisterPushSubscriptionInput');

export type RegisterPushSubscriptionInput = z.infer<typeof registerPushSubscriptionSchema>;

export const unregisterPushSubscriptionSchema = z
  .object({
    endpoint: z.string().max(2048),
  })
  .openapi('UnregisterPushSubscriptionInput');

export type UnregisterPushSubscriptionInput = z.infer<
  typeof unregisterPushSubscriptionSchema
>;

export const vapidPublicKeyResponseSchema = z
  .object({ publicKey: z.string() })
  .openapi('VapidPublicKey');

// Payload que vai (criptografado) pro Service Worker — contrato com
// apps/frontend/public/sw.js. Mudou aqui, muda lá no mesmo commit.
export interface ChatPushPayload {
  type: 'chat.message';
  title: string;
  body: string;
  // Notificações com a mesma tag se substituem (uma por conversa, como no
  // WhatsApp).
  tag: string;
  conversationId: string;
  url: string;
  isNewLead: boolean;
  timestamp: number;
}
