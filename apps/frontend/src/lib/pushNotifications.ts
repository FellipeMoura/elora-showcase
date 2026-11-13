import { env } from '@/config/env'
import {
  fetchVapidPublicKey,
  registerPushSubscription,
  unregisterPushSubscription,
} from '@/api/push'

// =====================================================================
// Notificações do sistema (Web Push) — o lado do navegador.
//
// Assinatura é POR APARELHO e opt-in explícito (botão em Preferências):
// nunca assina sozinho, nem depois de re-login no mesmo aparelho (pode ser
// outra pessoa usando). Logout remove a assinatura antes de derrubar a
// sessão (ver useLogout).
//
// iPhone/iPad: Web Push só existe com o app aberto pelo ícone da Tela de
// Início (iOS 16.4+). No Safari comum, `PushManager` nem aparece.
// =====================================================================

export type PushSupport =
  | 'supported'
  // iOS no Safari (fora do modo standalone) — precisa instalar antes.
  | 'ios-needs-install'
  | 'unsupported'

export type PushState =
  | 'unsupported'
  | 'ios-needs-install'
  // Permissão bloqueada no navegador — só o usuário desfaz, nas configs.
  | 'denied'
  | 'enabled'
  | 'disabled'

function isIos(): boolean {
  const ua = navigator.userAgent
  // iPadOS 13+ se apresenta como Mac — o touch denuncia.
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

export function pushSupport(): PushSupport {
  const hasApis =
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (hasApis) return 'supported'
  if (isIos() && !isStandalone()) return 'ios-needs-install'
  return 'unsupported'
}

// Registro do SW no boot (barato, idempotente). A URL da API vai na query
// porque o sw.js está em public/ e não passa pelo Vite.
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register(
      `/sw.js?api=${encodeURIComponent(env.api.core)}`,
      { scope: '/' },
    )
  } catch (err) {
    console.warn('[push] falha ao registrar service worker', err)
    return null
  }
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration('/')) ?? (await registerServiceWorker())
}

async function getCurrentSubscription(): Promise<PushSubscription | null> {
  const reg = await getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

export async function getPushState(): Promise<PushState> {
  const support = pushSupport()
  if (support !== 'supported') return support
  if (Notification.permission === 'denied') return 'denied'
  if (Notification.permission !== 'granted') return 'disabled'
  return (await getCurrentSubscription()) ? 'enabled' : 'disabled'
}

function base64UrlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = (value + '='.repeat((4 - (value.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// Tem que ser chamado direto do clique (iOS/Safari exigem gesto do usuário
// pro pedido de permissão).
export async function enablePush(): Promise<PushState> {
  const support = pushSupport()
  if (support !== 'supported') return support
  const permission = await Notification.requestPermission()
  if (permission === 'denied') return 'denied'
  if (permission !== 'granted') return 'disabled'

  const reg = await getRegistration()
  if (!reg) throw new Error('Service worker indisponível')
  // `ready` garante SW ativo antes do subscribe (primeiro acesso).
  await navigator.serviceWorker.ready

  const publicKey = await fetchVapidPublicKey()
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(publicKey),
    })
  }
  await registerPushSubscription(sub.toJSON())
  return 'enabled'
}

export async function disablePush(): Promise<PushState> {
  const sub = await getCurrentSubscription()
  if (sub) {
    // Backend primeiro: se o unsubscribe local falhar, ao menos o core
    // já parou de mandar.
    await unregisterPushSubscription(sub.endpoint).catch(() => undefined)
    await sub.unsubscribe().catch(() => undefined)
  }
  return getPushState()
}

// Logout: tira o aparelho do usuário que está saindo. Best-effort — nunca
// pode impedir o logout.
export async function disablePushOnLogout(): Promise<void> {
  try {
    if (pushSupport() !== 'supported') return
    await disablePush()
  } catch {
    // ignora
  }
}

// Boot autenticado: assinatura que já existe neste aparelho é reenviada
// (upsert) — mantém o dono certo e recupera linha apagada no servidor.
export async function syncPushSubscription(): Promise<void> {
  try {
    if (pushSupport() !== 'supported' || Notification.permission !== 'granted') return
    const sub = await getCurrentSubscription()
    if (sub) await registerPushSubscription(sub.toJSON())
  } catch {
    // ignora — próxima carga tenta de novo
  }
}
