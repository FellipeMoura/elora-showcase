// Sons de notificação gerados via Web Audio API. Sem dependência de assets
// estáticos — funciona em qualquer build, evita 404 em ambientes sem
// `public/sounds/`. Tons curtos, perfil discreto, suficiente pra alertar
// staff sem virar poluição sonora.
//
// `message`: 1 beep médio (~700Hz) — sinal de chegada.
// `lead`: 2 beeps ascendentes (660Hz → 880Hz) — sinal "festivo", lead novo
// merece destaque sonoro ligeiramente maior que mensagem comum.

let audioCtx: AudioContext | null = null

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null
  if (audioCtx) return audioCtx
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext
  if (!Ctor) return null
  try {
    audioCtx = new Ctor()
    return audioCtx
  } catch {
    return null
  }
}

interface ToneSpec {
  frequency: number
  durationMs: number
  startDelayMs: number
  // Pico do envelope. 0..1 — uso valor baixo (0.15) pra evitar sobressalto.
  peakGain: number
}

function playTones(tones: readonly ToneSpec[]): void {
  const ctx = getCtx()
  if (!ctx) return
  // Browsers exigem gesto do usuário antes do primeiro `resume`. Se ainda
  // estiver suspended (user nunca interagiu), o `.play` é silenciado — sem
  // lance de erro, sem console.warn de poluição.
  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => undefined)
  }

  const now = ctx.currentTime
  for (const tone of tones) {
    const start = now + tone.startDelayMs / 1000
    const end = start + tone.durationMs / 1000

    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(tone.frequency, start)

    const gain = ctx.createGain()
    // Envelope ADSR simplificado: ramp up rápido, hold, ramp down.
    // Evita click do corte abrupto.
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(tone.peakGain, start + 0.01)
    gain.gain.linearRampToValueAtTime(tone.peakGain, end - 0.03)
    gain.gain.linearRampToValueAtTime(0, end)

    osc.connect(gain).connect(ctx.destination)
    osc.start(start)
    osc.stop(end)
  }
}

export function playMessageSound(): void {
  playTones([{ frequency: 700, durationMs: 140, startDelayMs: 0, peakGain: 0.15 }])
}

export function playLeadSound(): void {
  playTones([
    { frequency: 660, durationMs: 110, startDelayMs: 0, peakGain: 0.16 },
    { frequency: 880, durationMs: 160, startDelayMs: 130, peakGain: 0.18 },
  ])
}
