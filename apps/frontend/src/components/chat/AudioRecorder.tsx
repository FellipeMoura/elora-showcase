import { Check, Mic, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface AudioRecorderProps {
  // Disparado quando user para a gravação. O File já vem com `audio/<ext>`
  // mimeType correto pro composer fazer upload via fluxo normal.
  onComplete: (file: File) => void
  // Disparado quando user cancela (descarta o áudio).
  onCancel: () => void
}

// Limite hard de 5min pra evitar áudios acidentais gigantes. Aciona stop
// automático e dispara onComplete (audio é salvo, não descartado — usuário
// que esquecer não perde o que gravou).
const MAX_DURATION_MS = 5 * 60 * 1000

// Tipos MIME suportados pela MediaRecorder em ordem de preferência. Opus em
// webm é o que Chrome/Firefox/Edge usam nativamente e o que o WhatsApp aceita
// como audio/ogg-equivalent. Safari só faz audio/mp4. O primeiro suportado
// é usado; se nada bater, getUserMedia/MediaRecorder lança e o caller
// trata erro genérico.
const MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
] as const

// UI compacta que substitui a toolbar do composer durante a gravação.
// Visual: ponto vermelho pulsante + timer + botões cancelar/confirmar.
// Inspirado no comportamento do WhatsApp Web (tap-to-record). Não usa
// hold-to-record porque touch+desktop ficam consistentes.
export function AudioRecorder({
  onComplete,
  onCancel,
}: AudioRecorderProps): React.ReactElement {
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef<number>(0)
  // Quando user clica em cancelar, sinaliza pra onstop descartar o resultado
  // em vez de chamar onComplete. Ref (e não state) porque o callback do
  // recorder roda fora do React lifecycle e precisa ler o valor atual.
  const discardRef = useRef(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [starting, setStarting] = useState(true)

  // Inicia a gravação na montagem. Acoplar a start com o mount evita
  // requerer um "clique pra iniciar" depois de já clicar no botão Mic do
  // composer (dois cliques pra começar a falar seria irritante).
  useEffect(() => {
    let cancelled = false

    async function start(): Promise<void> {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        const mimeType =
          MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
        if (!mimeType) {
          throw new Error('Browser sem suporte a gravação de áudio')
        }
        const recorder = new MediaRecorder(stream, { mimeType })
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data)
        }
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          streamRef.current = null
          if (discardRef.current) {
            chunksRef.current = []
            onCancel()
            return
          }
          // Tamanho zero = stop antes de qualquer data chunk (clique muito
          // rápido). Trata como cancel pra evitar enviar arquivo vazio.
          const blob = new Blob(chunksRef.current, { type: mimeType })
          chunksRef.current = []
          if (blob.size === 0) {
            onCancel()
            return
          }
          const ext = mimeType.startsWith('audio/mp4')
            ? 'm4a'
            : mimeType.startsWith('audio/ogg')
              ? 'ogg'
              : 'webm'
          const file = new File([blob], `audio-${Date.now()}.${ext}`, {
            type: mimeType,
          })
          onComplete(file)
        }
        recorder.start(250) // Chunks de 250ms — suficiente pra latência baixa sem polling pesado.
        recorderRef.current = recorder
        streamRef.current = stream
        startedAtRef.current = Date.now()
        setStarting(false)
      } catch (err) {
        const name = (err as { name?: string }).name
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          toast.error(
            'Permissão de microfone negada. Habilite no navegador pra gravar áudio.',
          )
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          toast.error('Microfone não encontrado.')
        } else {
          toast.error('Não foi possível iniciar a gravação.')
        }
        onCancel()
      }
    }

    void start()

    return () => {
      // Cleanup defensivo se o componente desmontar sem stop explícito
      // (navegação, troca de conversa). Marca pra descartar resultado e
      // libera o microfone.
      cancelled = true
      discardRef.current = true
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop()
        } catch {
          // Ignora — pode já estar inativo
        }
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
    }
    // onComplete/onCancel são estáveis no caller (memoizados via useState
    // setters em MessageComposer); intencionalmente sem deps pra start
    // rodar exatamente uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleStop = (): void => {
    const recorder = recorderRef.current
    if (!recorder || recorder.state === 'inactive') return
    discardRef.current = false
    recorder.stop()
  }

  // Timer + auto-stop em 5min.
  useEffect(() => {
    if (starting) return
    const id = window.setInterval(() => {
      const ms = Date.now() - startedAtRef.current
      setElapsedMs(ms)
      if (ms >= MAX_DURATION_MS) {
        handleStop()
      }
    }, 200)
    return () => window.clearInterval(id)
  }, [starting])

  const handleCancel = (): void => {
    const recorder = recorderRef.current
    discardRef.current = true
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    } else {
      // Ainda startando (getUserMedia em progresso) — propaga cancel.
      onCancel()
    }
  }

  return (
    <div className="flex flex-1 items-center gap-2 rounded-md border border-input bg-background-chat-card px-3 py-1.5">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={handleCancel}
        aria-label="Descartar gravação"
        className="size-8 text-muted-foreground hover:text-error"
      >
        <Trash2 className="size-4" />
      </Button>

      <div className="flex flex-1 items-center gap-2">
        <span
          className={cn(
            'inline-block size-2.5 shrink-0 rounded-full bg-error',
            !starting && 'motion-safe:animate-pulse',
          )}
          aria-hidden
        />
        <span className="font-mono text-sm tabular-nums text-foreground">
          {starting ? 'Preparando…' : formatElapsed(elapsedMs)}
        </span>
        {!starting && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Mic className="size-3" />
            Gravando
          </span>
        )}
      </div>

      <Button
        type="button"
        size="icon"
        onClick={handleStop}
        disabled={starting}
        aria-label="Parar gravação"
        className="bg-chat-accent text-chat-accent-foreground hover:bg-chat-accent/90"
      >
        <Check className="size-4" />
      </Button>
    </div>
  )
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
