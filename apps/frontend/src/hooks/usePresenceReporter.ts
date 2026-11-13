import { useEffect } from 'react'
import { getSocket } from '@/lib/socket'

// Sem interação por esse tempo, o usuário conta como ausente mesmo com a
// aba na frente (PC do escritório aberto o dia todo não pode calar o push
// do celular).
const IDLE_MS = 2 * 60 * 1000
const IDLE_CHECK_MS = 30 * 1000
const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const

// =====================================================================
// Avisa o core (socket `presence:active` / `presence:inactive`) se o
// Elora está "na frente" deste usuário: aba visível + janela com foco +
// interação recente. Quem está ativo em algum aparelho não recebe push —
// ver apps/core/src/shared/realtime/presence.ts.
//
// Só emite em mudança de estado; reemite na reconexão do socket (o core
// esquece a presença do socket que caiu).
// =====================================================================
export function usePresenceReporter(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return
    const socket = getSocket()
    if (!socket) return

    let lastActivity = Date.now()
    let reported: boolean | null = null

    const isActive = (): boolean =>
      document.visibilityState === 'visible' &&
      document.hasFocus() &&
      Date.now() - lastActivity < IDLE_MS

    const report = (force = false): void => {
      if (!socket.connected) {
        reported = null
        return
      }
      const active = isActive()
      if (!force && active === reported) return
      reported = active
      socket.emit(active ? 'presence:active' : 'presence:inactive')
    }

    const onActivity = (): void => {
      lastActivity = Date.now()
      if (reported !== true) report()
    }
    const onChange = (): void => report()
    const onConnect = (): void => report(true)

    for (const ev of ACTIVITY_EVENTS) window.addEventListener(ev, onActivity, { passive: true })
    window.addEventListener('focus', onChange)
    window.addEventListener('blur', onChange)
    document.addEventListener('visibilitychange', onChange)
    socket.on('connect', onConnect)
    const idleTimer = window.setInterval(onChange, IDLE_CHECK_MS)
    report(true)

    return () => {
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, onActivity)
      window.removeEventListener('focus', onChange)
      window.removeEventListener('blur', onChange)
      document.removeEventListener('visibilitychange', onChange)
      socket.off('connect', onConnect)
      window.clearInterval(idleTimer)
      if (socket.connected) socket.emit('presence:inactive')
    }
  }, [enabled])
}
