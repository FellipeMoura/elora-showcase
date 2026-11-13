import webpush, { WebPushError } from 'web-push';
import { env } from '../../env.js';

// =====================================================================
// Wrapper fino sobre a lib `web-push` (protocolo Web Push + VAPID +
// criptografia RFC 8291). O serviço de push do navegador (FCM, Mozilla,
// Apple, WNS) guarda a mensagem enquanto o aparelho está offline, até o
// `ttlSec` — por isso não há retry nosso: falha 5xx conta em
// `failure_count` e a próxima mensagem tenta de novo.
// =====================================================================

const configured = Boolean(env.push.vapidPublicKey && env.push.vapidPrivateKey);

if (configured) {
  webpush.setVapidDetails(
    env.push.vapidSubject,
    env.push.vapidPublicKey!,
    env.push.vapidPrivateKey!
  );
}

export function isPushConfigured(): boolean {
  return configured;
}

export function vapidPublicKey(): string | null {
  return env.push.vapidPublicKey;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SendOptions {
  ttlSec: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
  // Mensagem pendente no serviço de push com o mesmo topic é substituída
  // (aparelho offline recebe só a última). Máx 32 chars base64url.
  topic?: string;
}

export type SendResult =
  | { kind: 'ok' }
  // 404/410: assinatura expirou ou o usuário revogou — apagar a linha.
  | { kind: 'gone'; statusCode: number }
  | { kind: 'failed'; statusCode: number | null; message: string };

const SEND_TIMEOUT_MS = 10_000;

export async function sendWebPush(
  target: PushTarget,
  payload: string,
  options: SendOptions
): Promise<SendResult> {
  try {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      payload,
      {
        TTL: options.ttlSec,
        urgency: options.urgency,
        topic: options.topic,
        timeout: SEND_TIMEOUT_MS,
      }
    );
    return { kind: 'ok' };
  } catch (err) {
    if (err instanceof WebPushError) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        return { kind: 'gone', statusCode: err.statusCode };
      }
      return { kind: 'failed', statusCode: err.statusCode, message: err.body || err.message };
    }
    return {
      kind: 'failed',
      statusCode: null,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
