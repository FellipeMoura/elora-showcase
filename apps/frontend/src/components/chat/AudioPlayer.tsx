import { Pause, Play } from 'lucide-react'
import { useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface AudioPlayerProps {
  url: string
  className?: string
}

// Player de áudio custom — usado tanto em mensagens já enviadas (dentro de
// MediaPreview) quanto na barra de revisão pré-envio do composer (áudio
// recém-gravado). Substitui o `<audio controls>` nativo porque:
//   - Pseudo-elementos `::-webkit-media-controls-*` são instáveis entre
//     versões de Chrome.
//   - Tema do widget nativo não respeita color-scheme do site
//     consistentemente — fica com contraste ruim sobre `bg-chat-bubble`.
//
// Layout estilo WhatsApp Web: play/pause + barra de progresso + countdown
// (tempo restante). Sem volume nem speed control — raramente usados em
// áudio de mensagem.
export function AudioPlayer({
  url,
  className,
}: AudioPlayerProps): React.ReactElement {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)

  const toggle = (): void => {
    const a = audioRef.current
    if (!a) return
    if (a.paused) {
      void a.play()
    } else {
      a.pause()
    }
  }

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const a = audioRef.current
    if (!a) return
    const next = Number(e.target.value)
    a.currentTime = next
    setCurrentTime(next)
  }

  // Tempo mostrado: countdown (duration - currentTime) quando há duração;
  // currentTime quando não (áudios sem metadata).
  const timeLabel =
    duration > 0
      ? formatAudioTime(duration - currentTime)
      : formatAudioTime(currentTime)

  return (
    <div
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-full bg-black/5 px-2 py-1.5 dark:bg-black/25',
        className,
      )}
    >
      <audio
        ref={audioRef}
        src={url}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false)
          setCurrentTime(0)
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setDuration(d)
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration
          if (Number.isFinite(d) && d > 0) setDuration(d)
        }}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        className="hidden"
      />
      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? 'Pausar' : 'Reproduzir'}
        className="flex size-7 shrink-0 items-center justify-center rounded-full bg-chat-accent text-chat-accent-foreground transition-transform active:scale-95"
      >
        {playing ? (
          <Pause className="size-3.5" />
        ) : (
          <Play className="size-3.5 translate-x-px" />
        )}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={currentTime}
        onChange={onSeek}
        disabled={duration === 0}
        aria-label="Posição da reprodução"
        className="audio-range min-w-0 flex-1"
      />
      <span className="shrink-0 text-[10px] tabular-nums opacity-70">
        {timeLabel}
      </span>
    </div>
  )
}

function formatAudioTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
