import { AlertTriangle, CheckCircle2, FileText, Loader2 } from 'lucide-react'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useAppointmentAttendance } from '@/hooks/useSessionAttendance'
import type { AttendanceDetails } from '@/api/sessionAttendances'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// SignatureViewSheet — mostra a assinatura registrada para um appointment
// kind=procedure já atendido. Carregada via GET /appointments/:id/attendance,
// que devolve SVG inline + foto base64 (objetos pequenos).
//
// 404 do backend = appointment não tem assinatura registrada (override
// administrativo via attend() ou estado legacy). Sheet mostra mensagem
// específica em vez de cair em "erro genérico".
// =====================================================================

interface SignatureViewSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  appointmentId: string | null
}

export function SignatureViewSheet({
  open,
  onOpenChange,
  appointmentId,
}: SignatureViewSheetProps): React.ReactElement {
  const query = useAppointmentAttendance(appointmentId ?? undefined, open)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle="Ver assinatura">
            <SheetToolbar.Action
              label="Fechar"
              onClick={() => onOpenChange(false)}
            />
          </SheetToolbar>

          <SheetBody>
            {query.isLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Carregando assinatura…
              </div>
            )}
            {query.isError && (
              <ErrorBox error={query.error} />
            )}
            {query.data && <DetailsView data={query.data} />}
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}

function ErrorBox({ error }: { error: Error }): React.ReactElement {
  const status = (error as { response?: { status?: number } })?.response?.status
  const message =
    apiErrorText(error) ?? error.message

  const isNotFound = status === 404
  return (
    <div
      className={
        'flex flex-col gap-2 rounded-md border p-3 ' +
        (isNotFound
          ? 'border-warning/40 bg-warning-soft'
          : 'border-error/40 bg-error-soft')
      }
    >
      <div className="flex items-start gap-2">
        <AlertTriangle
          className={
            'size-4 shrink-0 ' + (isNotFound ? 'text-warning' : 'text-error')
          }
        />
        <div className="flex flex-col gap-1">
          <p
            className={
              'text-sm font-medium ' +
              (isNotFound
                ? 'text-warning-soft-foreground'
                : 'text-error-soft-foreground')
            }
          >
            {isNotFound
              ? 'Sem assinatura registrada'
              : 'Não foi possível carregar'}
          </p>
          <p className="text-xs text-muted-foreground">{message}</p>
        </div>
      </div>
    </div>
  )
}

function DetailsView({ data }: { data: AttendanceDetails }): React.ReactElement {
  const signedAt = new Date(data.signedAt)
  // SVG inline via data URL (em vez de dangerouslySetInnerHTML) — img
  // não executa script dentro de SVG, defesa em profundidade contra
  // payload malicioso que tenha chegado a passar.
  const signatureDataUrl = `data:image/svg+xml;base64,${btoa(
    unescape(encodeURIComponent(data.signatureSvg)),
  )}`

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-success/30 bg-success/10 p-3">
        <div className="flex items-start gap-2">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-medium text-success">
              Presença confirmada por assinatura
            </p>
            <p className="text-xs text-muted-foreground">
              {signedAt.toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}{' '}
              às{' '}
              {signedAt.toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>
      </div>

      <Section title="Foto">
        <img
          src={data.photoDataUrl}
          alt="Foto da presença"
          className="aspect-square w-full rounded-md object-cover"
        />
      </Section>

      <Section title="Assinatura">
        <div className="flex h-40 items-center justify-center rounded-md border border-input bg-background p-2">
          <img
            src={signatureDataUrl}
            alt="Assinatura"
            className="max-h-full max-w-full object-contain"
          />
        </div>
      </Section>

      <Section title="Sessões cobertas">
        <ul className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3">
          {data.coveredSessions.map((s) => {
            const time = new Date(s.scheduledAt).toLocaleTimeString('pt-BR', {
              hour: '2-digit',
              minute: '2-digit',
            })
            return (
              <li key={s.id} className="flex items-start gap-2 text-sm">
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="flex flex-col">
                  <span className="font-medium">{s.procedureName}</span>
                  <span className="text-xs text-muted-foreground">
                    às {time}
                    {s.professionalName ? ` · ${s.professionalName}` : ''}
                  </span>
                </div>
              </li>
            )
          })}
        </ul>
      </Section>

      <Section title="Auditoria">
        <dl className="grid grid-cols-2 gap-1.5 rounded-md border border-border bg-surface p-3 text-xs">
          <dt className="text-muted-foreground">CPF confirmado</dt>
          <dd>{data.cpfConfirmed ? 'Sim' : 'Não'}</dd>
          <dt className="text-muted-foreground">Nascimento confirmado</dt>
          <dd>{data.birthDateConfirmed ? 'Sim' : 'Não'}</dd>
          {data.signedFromIp && (
            <>
              <dt className="text-muted-foreground">IP</dt>
              <dd className="truncate">{data.signedFromIp}</dd>
            </>
          )}
          {data.signedUserAgent && (
            <>
              <dt className="col-span-2 text-muted-foreground">User agent</dt>
              <dd className="col-span-2 break-words text-[11px] text-muted-foreground">
                {data.signedUserAgent}
              </dd>
            </>
          )}
        </dl>
      </Section>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">
        {title}
      </span>
      {children}
    </div>
  )
}
