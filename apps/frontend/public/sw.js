/* =====================================================================
 * Service Worker do Elora — SÓ notificações push do chat.
 *
 * Sem cache offline e sem handler de `fetch`, de propósito: o deploy
 * continua invalidando o app como hoje (useVersionCheck + index.html
 * no-cache), sem risco de SW servindo bundle velho.
 *
 * Contrato do payload: ChatPushPayload em
 * apps/core/src/modules/pushSubscriptions/PushSubscriptionsTypes.ts.
 * Mudou lá, muda aqui no mesmo commit.
 *
 * URL da API vem na query de registro (`/sw.js?api=...`) — arquivo em
 * public/ não passa pelo Vite, então não enxerga import.meta.env.
 * ===================================================================== */

const API_BASE = new URL(self.location.href).searchParams.get('api') || '/api'

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  event.waitUntil(showPush(event))
})

async function showPush(event) {
  let data = null
  try {
    data = event.data ? event.data.json() : null
  } catch {
    data = null
  }

  // Todo push TEM que mostrar notificação (Safari revoga a permissão de
  // quem recebe push silencioso). Payload inesperado vira genérico.
  if (!data || data.type !== 'chat.message') {
    return self.registration.showNotification('Elora', {
      body: 'Você tem uma nova mensagem',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
    })
  }

  return self.registration.showNotification(data.title, {
    body: data.body,
    // Mesma tag = substitui a anterior da conversa; renotify faz vibrar/tocar
    // de novo mesmo substituindo (comportamento do WhatsApp).
    tag: data.tag,
    renotify: true,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    timestamp: data.timestamp,
    data: { url: data.url, conversationId: data.conversationId },
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(openFromNotification(event.notification.data || {}))
})

async function openFromNotification(data) {
  const target = new URL(data.url || '/', self.location.origin).href
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

  // Já tem o Elora aberto: foca e pede pra abrir a conversa (sem recarregar).
  const existing = windows.find((c) => new URL(c.url).origin === self.location.origin)
  if (existing) {
    await existing.focus()
    if (data.conversationId) {
      existing.postMessage({ type: 'open-conversation', conversationId: data.conversationId })
    }
    return
  }
  await self.clients.openWindow(target)
}

// O navegador pode rotacionar a assinatura (expiração, troca de chave do
// serviço). Re-assina e avisa o core — o cookie de sessão vai junto.
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(resubscribe(event))
})

async function resubscribe(event) {
  let sub = event.newSubscription
  if (!sub) {
    let options = event.oldSubscription ? event.oldSubscription.options : null
    if (!options || !options.applicationServerKey) {
      const res = await fetch(`${API_BASE}/push/vapid-public-key`, { credentials: 'include' })
      if (!res.ok) return
      const { publicKey } = await res.json()
      options = { userVisibleOnly: true, applicationServerKey: base64UrlToUint8Array(publicKey) }
    }
    sub = await self.registration.pushManager.subscribe(options)
  }
  await fetch(`${API_BASE}/push/subscriptions`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sub.toJSON()),
  })
}

function base64UrlToUint8Array(value) {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
