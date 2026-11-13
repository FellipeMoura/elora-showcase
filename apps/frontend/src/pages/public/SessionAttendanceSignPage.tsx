import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import SignaturePad from 'signature_pad'
import {
  AlertTriangle,
  CameraOff,
  CheckCircle2,
  Eraser,
  Loader2,
  PartyPopper,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/form/TextField'
import {
  usePublicAttendancePreview,
  useSignAttendance,
  useVerifyAttendance,
} from '@/hooks/useSessionAttendance'
import { blobToDataUrl, compressImage } from '@/lib/imageCompress'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// Página pública de assinatura de presença. Sem AppShell, sem login.
//
// Fluxo:
//   1. Carrega preview (clínica, procedimentos do dia).
//   2. Cliente confirma CPF + data de nascimento.
//   3. Captura selfie via câmera frontal + desenha assinatura.
//   4. Submit → sucesso.
//
// Mobile-first (cliente abre no celular, geralmente).
// =====================================================================

type Step = 'verify' | 'capture' | 'success'

export function SessionAttendanceSignPage(): React.ReactElement {
  const { token } = useParams<{ token: string }>()
  const preview = usePublicAttendancePreview(token)
  const [step, setStep] = useState<Step>('verify')
  const [verifyToken, setVerifyToken] = useState<string | null>(null)
  // Snapshot do nome assim que o preview carrega — usado depois que o link
  // já foi consumido pra saudação calorosa na tela de sucesso, sem depender
  // de uma query que agora retorna 410.
  const [clientFirstNameSnapshot, setClientFirstNameSnapshot] = useState<
    string | null
  >(null)
  useEffect(() => {
    if (preview.data?.clientFirstName && !clientFirstNameSnapshot) {
      setClientFirstNameSnapshot(preview.data.clientFirstName)
    }
  }, [preview.data?.clientFirstName, clientFirstNameSnapshot])

  // Sucesso vence sobre erro do preview — depois do sign, o token foi
  // consumido e qualquer refetch vai devolver 410 ("já utilizado"). Sem
  // este early-return, o usuário veria mensagem de erro em vez do parabéns.
  if (step === 'success') {
    return (
      <CenterStage>
        <SuccessStep clientFirstName={clientFirstNameSnapshot} />
      </CenterStage>
    )
  }

  if (preview.isLoading) {
    return <CenterStage><Loader2 className="size-6 animate-spin" /></CenterStage>
  }
  if (preview.isError || !preview.data) {
    const message =
      apiErrorText(preview.error) ?? 'Link inválido ou expirado'
    return (
      <CenterStage>
        <ErrorBox message={message} />
      </CenterStage>
    )
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-md flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1 text-center">
        <h1 className="text-lg font-semibold">{preview.data.clinicName}</h1>
        <p className="text-sm text-muted-foreground">
          {preview.data.clientFirstName} {preview.data.clientLastInitial}
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(preview.data.attendanceDate + 'T00:00:00').toLocaleDateString(
            'pt-BR',
            { weekday: 'long', day: '2-digit', month: 'long' },
          )}
        </p>
      </header>

      <ProceduresList procedures={preview.data.procedures} />

      {step === 'verify' && (
        <VerifyStep
          token={token!}
          onSuccess={(t) => {
            setVerifyToken(t)
            setStep('capture')
          }}
        />
      )}
      {step === 'capture' && verifyToken && (
        <CaptureStep
          token={token!}
          verifyToken={verifyToken}
          onSuccess={() => setStep('success')}
        />
      )}
    </div>
  )
}

// ─── Sub-componentes ─────────────────────────────────────────────────

function CenterStage({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="flex min-h-svh items-center justify-center p-6">
      {children}
    </div>
  )
}

function ErrorBox({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex max-w-sm flex-col items-center gap-3 rounded-md border border-error/40 bg-error-soft p-6 text-center">
      <AlertTriangle className="size-6 text-error" />
      <p className="text-sm font-medium text-error-soft-foreground">
        {message}
      </p>
      <p className="text-xs text-muted-foreground">
        Entre em contato com a clínica para receber um novo link.
      </p>
    </div>
  )
}

function ProceduresList({
  procedures,
}: {
  procedures: Array<{
    name: string
    scheduledAt: string
    professionalName: string | null
  }>
}): React.ReactElement {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        {procedures.length === 1
          ? 'Procedimento de hoje'
          : `${procedures.length} procedimentos de hoje`}
      </p>
      <ul className="flex flex-col gap-1.5">
        {procedures.map((p, i) => {
          const time = new Date(p.scheduledAt).toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })
          return (
            <li key={i} className="flex items-start gap-2 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              <div className="flex flex-col">
                <span className="font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground">
                  às {time}
                  {p.professionalName ? ` · ${p.professionalName}` : ''}
                </span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── Step 1: Verify CPF + birth ──────────────────────────────────────

function VerifyStep({
  token,
  onSuccess,
}: {
  token: string
  onSuccess: (verifyToken: string) => void
}): React.ReactElement {
  const [document, setDocument] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [error, setError] = useState<string | null>(null)
  const verifyMut = useVerifyAttendance(token)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const result = await verifyMut.mutateAsync({ document, birthDate })
      onSuccess(result.verifyToken)
    } catch (err) {
      const message =
        apiErrorText(err) ?? 'Não foi possível confirmar'
      setError(message)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <TextField
        id="att-cpf"
        label="CPF"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder="000.000.000-00"
        value={document}
        onChange={(e) => setDocument(e.target.value)}
        className="text-base"
        required
      />
      <TextField
        id="att-birth"
        label="Data de nascimento"
        type="date"
        value={birthDate}
        onChange={(e) => setBirthDate(e.target.value)}
        className="text-base"
        required
      />
      {error && <p className="text-sm text-error">{error}</p>}
      <Button
        type="submit"
        disabled={verifyMut.isPending || !document || !birthDate}
        className="h-11 w-full"
      >
        {verifyMut.isPending ? 'Confirmando…' : 'Confirmar'}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">
        Por segurança, confirmamos sua identidade antes da assinatura.
      </p>
    </form>
  )
}

// ─── Step 2: Camera + signature ──────────────────────────────────────

function CaptureStep({
  token,
  verifyToken,
  onSuccess,
}: {
  token: string
  verifyToken: string
  onSuccess: () => void
}): React.ReactElement {
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null)
  const [signatureSvg, setSignatureSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const signMut = useSignAttendance(token)

  const canSubmit = Boolean(photoDataUrl && signatureSvg && !signMut.isPending)

  const handleSubmit = async () => {
    if (!photoDataUrl || !signatureSvg) return
    setError(null)
    try {
      await signMut.mutateAsync({ verifyToken, signatureSvg, photoDataUrl })
      onSuccess()
    } catch (err) {
      const message =
        apiErrorText(err) ?? 'Não foi possível registrar a presença'
      setError(message)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PhotoCapture photoDataUrl={photoDataUrl} onCapture={setPhotoDataUrl} />
      <SignaturePadField onChange={setSignatureSvg} />
      {error && <p className="text-sm text-error">{error}</p>}
      <Button
        onClick={handleSubmit}
        disabled={!canSubmit}
        className="h-11 w-full"
      >
        {signMut.isPending ? 'Enviando…' : 'Confirmar presença'}
      </Button>
    </div>
  )
}

function PhotoCapture({
  photoDataUrl,
  onCapture,
}: {
  photoDataUrl: string | null
  onCapture: (dataUrl: string | null) => void
}): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  // Liga a câmera quando ainda não tem foto.
  useEffect(() => {
    if (photoDataUrl) return
    let cancelled = false
    setError(null)
    setReady(false)
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'user', width: { ideal: 720 } },
        audio: false,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => setReady(true)
        }
      })
      .catch((err: Error) => {
        if (cancelled) return
        setError(
          err.name === 'NotAllowedError'
            ? 'Permissão de câmera negada. Habilite e recarregue a página.'
            : 'Não foi possível acessar a câmera neste dispositivo.',
        )
      })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [photoDataUrl])

  const handleCapture = async () => {
    const video = videoRef.current
    if (!video) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png', 1),
    )
    if (!blob) return
    const compressed = await compressImage(blob, {
      maxSide: 720,
      mimeType: 'image/webp',
      quality: 0.75,
    })
    const dataUrl = await blobToDataUrl(compressed.blob)
    onCapture(dataUrl)
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-md border border-warning/40 bg-warning-soft p-4 text-center">
        <CameraOff className="size-5 text-warning" />
        <p className="text-sm text-warning-soft-foreground">{error}</p>
      </div>
    )
  }

  if (photoDataUrl) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-muted-foreground">Foto</span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoDataUrl}
          alt="Foto capturada"
          className="aspect-square w-full rounded-md object-cover"
        />
        <Button
          variant="outline"
          onClick={() => onCapture(null)}
          className="h-10"
        >
          <RotateCcw className="mr-2 size-4" />
          Tirar outra
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-muted-foreground">
        Selfie para confirmar presença
      </span>
      <div className="relative aspect-square w-full overflow-hidden rounded-md bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="absolute inset-0 size-full object-cover"
        />
      </div>
      <Button onClick={handleCapture} disabled={!ready} className="h-11">
        {ready ? 'Tirar foto' : 'Iniciando câmera…'}
      </Button>
    </div>
  )
}

function SignaturePadField({
  onChange,
}: {
  onChange: (svg: string | null) => void
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const padRef = useRef<SignaturePad | null>(null)
  const [empty, setEmpty] = useState(true)

  // Reset SVG output sempre que esvazia. Devolve o atual no commit (mouseup).
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // Calibra a resolução interna do canvas pra densidade do device pra
    // assinatura não ficar pixelada em mobile (retina).
    const resize = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1)
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * ratio
      canvas.height = rect.height * ratio
      const ctx = canvas.getContext('2d')
      ctx?.scale(ratio, ratio)
      padRef.current?.clear()
    }

    const pad = new SignaturePad(canvas, {
      backgroundColor: 'rgba(255,255,255,0)',
      penColor: '#111',
    })
    padRef.current = pad
    resize()

    const handleEnd = () => {
      if (pad.isEmpty()) {
        setEmpty(true)
        onChange(null)
        return
      }
      setEmpty(false)
      onChange(pad.toSVG())
    }
    pad.addEventListener('endStroke', handleEnd)
    window.addEventListener('resize', resize)
    return () => {
      pad.removeEventListener('endStroke', handleEnd)
      pad.off()
      window.removeEventListener('resize', resize)
    }
  }, [onChange])

  const handleClear = () => {
    padRef.current?.clear()
    setEmpty(true)
    onChange(null)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Assinatura
        </span>
        <button
          type="button"
          onClick={handleClear}
          disabled={empty}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <Eraser className="size-3" /> Limpar
        </button>
      </div>
      <div className="relative h-48 w-full overflow-hidden rounded-md border border-input bg-background">
        <canvas
          ref={canvasRef}
          className="absolute inset-0 size-full touch-none"
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            Assine aqui
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Step 3: Success ─────────────────────────────────────────────────

function SuccessStep({
  clientFirstName,
}: {
  clientFirstName: string | null
}): React.ReactElement {
  const greeting = clientFirstName
    ? `Tudo certo, ${clientFirstName}!`
    : 'Tudo certo!'
  return (
    <div className="flex max-w-sm flex-col items-center gap-4 rounded-lg border border-success/30 bg-success/10 p-8 text-center">
      <div className="relative">
        <CheckCircle2 className="size-14 text-success" />
        <PartyPopper className="absolute -right-3 -top-2 size-6 text-warning" />
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xl font-semibold text-success">
          {greeting}
        </p>
        <p className="text-sm text-foreground/80">
          Sua presença foi registrada com sucesso.
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        Pode aguardar confortavelmente — a equipe já foi avisada e vai
        te chamar em instantes.
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        Você já pode fechar essa página.
      </p>
    </div>
  )
}
