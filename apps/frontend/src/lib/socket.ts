import { io, type Socket } from 'socket.io-client'
import { env } from '@/config/env'

// =====================================================================
// Cliente Socket.IO único do app.
//
// Conexão é **lazy**: nada acontece até `connectSocket()` ser chamado
// (tipicamente do useChatRealtime quando o useMe resolve com sucesso).
// Sem isso, abrir /login dispararia conexão antes de auth — gera 401
// desnecessário no handshake.
//
// Reconexão automática built-in do socket.io-client (backoff exponencial).
// Auth via cookie httpOnly `elora_token` — `withCredentials: true` faz o
// browser anexar no handshake (mesmo padrão do axios).
// =====================================================================

let socket: Socket | null = null

export type SocketStatus = 'idle' | 'connecting' | 'connected' | 'error'

const listeners = new Set<(status: SocketStatus) => void>()
let currentStatus: SocketStatus = 'idle'

function setStatus(s: SocketStatus): void {
  currentStatus = s
  for (const l of listeners) l(s)
}

export function getSocketStatus(): SocketStatus {
  return currentStatus
}

export function subscribeSocketStatus(
  l: (s: SocketStatus) => void,
): () => void {
  listeners.add(l)
  return () => listeners.delete(l) as unknown as void
}

export function getSocket(): Socket | null {
  return socket
}

export function connectSocket(): Socket {
  if (socket && socket.connected) {
    return socket
  }
  if (socket && socket.active) {
    return socket
  }

  setStatus('connecting')

  // path default `/socket.io` — o server core monta no mesmo HTTP server.
  // `withCredentials: true` envia cookie httpOnly `elora_token`.
  socket = io(env.api.core, {
    withCredentials: true,
    // Polling fallback fica habilitado por default. Em dev cross-origin,
    // o websocket upgrade pode falhar em alguns proxies — manter polling
    // como fallback evita travar a UX.
    transports: ['websocket', 'polling'],
  })

  socket.on('connect', () => {
    setStatus('connected')
  })
  socket.on('disconnect', () => {
    setStatus('idle')
  })
  socket.on('connect_error', () => {
    setStatus('error')
  })

  return socket
}

export function disconnectSocket(): void {
  if (!socket) {
    return
  }
  socket.removeAllListeners()
  socket.disconnect()
  socket = null
  setStatus('idle')
}
