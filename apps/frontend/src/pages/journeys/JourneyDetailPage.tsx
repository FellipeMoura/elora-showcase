import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { PageContainer } from '@/components/layout/PageContainer'
import { displayRelativeTime } from '@/lib/format'
import { useClient } from '@/hooks/useClients'
import { useJourney, useJourneyEvents, useMarkJourneyWon } from '@/hooks/useJourneys'
import { JourneyAppointmentsSection } from '@/pages/appointments/JourneyAppointmentsSection'
import { ClientLabel } from './ClientLabel'
import {
  labelForEventType,
  SOURCE_LABELS,
  STAGE_BADGE_CLASS,
  STAGE_LABELS,
  STATUS_BADGE_CLASS,
  STATUS_LABELS,
} from './journeyLabels'
import { MarkLostSheet } from './MarkLostSheet'
import { apiErrorText } from '@/lib/apiError'

export function JourneyDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()

  const journey = useJourney(id)
  const client = useClient(journey.data?.clientId)
  const events = useJourneyEvents(id, { pageSize: 100 })

  const markWon = useMarkJourneyWon()
  const [lostOpen, setLostOpen] = useState(false)

  const handleMarkWon = async () => {
    if (!journey.data) return
    const ok = await confirm({
      title: 'Marcar como ganha?',
      description: 'Selo final — não permite reabrir.',
      confirmLabel: 'Marcar como ganha',
      variant: 'success',
    })
    if (!ok) return
    try {
      await markWon.mutateAsync(journey.data.id)
      toast.success('Jornada marcada como ganha')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao marcar como ganha')
    }
  }

  if (journey.isLoading) {
    return (
      <PageContainer>
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Carregando jornada…
        </div>
      </PageContainer>
    )
  }

  if (journey.isError || !journey.data) {
    return (
      <PageContainer>
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>Erro ao carregar jornada.</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/journeys')}>
            Voltar
          </Button>
        </div>
      </PageContainer>
    )
  }

  const j = journey.data
  const closed = j.status !== 'active'
  const canMarkWon = j.stage === 'result' && j.status === 'active'

  return (
    <PageContainer>
      <div className="flex h-full flex-col gap-3 overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-2 rounded-md border bg-background p-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/journeys')}
            aria-label="Voltar"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <ClientLabel clientId={j.clientId} showPhone />
            <div className="flex flex-wrap items-center gap-1.5">
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${STAGE_BADGE_CLASS[j.stage]}`}
              >
                {STAGE_LABELS[j.stage]}
              </span>
              <span
                className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[j.status]}`}
              >
                {STATUS_LABELS[j.status]}
                {j.status === 'lost' && j.lostReason ? ` · ${j.lostReason}` : ''}
              </span>
              <span className="text-xs text-muted-foreground">
                Origem: {SOURCE_LABELS[j.source]}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkWon}
              disabled={!canMarkWon || markWon.isPending}
              title={
                canMarkWon
                  ? undefined
                  : 'Só permitido em stage=resultado com status=ativa'
              }
            >
              <Check className="mr-1 h-4 w-4" />
              Ganha
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLostOpen(true)}
              disabled={closed}
              className="text-error hover:bg-error/10"
            >
              <X className="mr-1 h-4 w-4" />
              Perdida
            </Button>
          </div>
        </div>

        {/* Agendamentos da journey — cria + lista + actions */}
        <JourneyAppointmentsSection journey={j} />

        {/* Conteúdo: dois blocos lado a lado em md+ */}
        <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2">
          {/* Info da jornada */}
          <div className="flex flex-col gap-3 rounded-md border bg-background p-4">
            <h2 className="text-sm font-semibold">Informações</h2>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Cliente</dt>
              <dd>{client.data?.name ?? '…'}</dd>

              <dt className="text-muted-foreground">Telefone</dt>
              <dd>{client.data?.phoneE164 ?? '…'}</dd>

              {client.data?.email && (
                <>
                  <dt className="text-muted-foreground">Email</dt>
                  <dd>{client.data.email}</dd>
                </>
              )}

              <dt className="text-muted-foreground">Criada</dt>
              <dd>{displayRelativeTime(j.createdAt)}</dd>

              <dt className="text-muted-foreground">Última atividade</dt>
              <dd>{displayRelativeTime(j.lastActivityAt)}</dd>

              {j.closedAt && (
                <>
                  <dt className="text-muted-foreground">Encerrada</dt>
                  <dd>{displayRelativeTime(j.closedAt)}</dd>
                </>
              )}
            </dl>

            {j.sourceMetadata && Object.keys(j.sourceMetadata).length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold text-muted-foreground">
                  Metadados da origem
                </h3>
                <pre className="overflow-x-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(j.sourceMetadata, null, 2)}
                </pre>
              </div>
            )}

            {client.data && (
              <Link
                to={`/clients`}
                className="text-xs text-muted-foreground hover:underline"
              >
                Ver na lista de clientes →
              </Link>
            )}
          </div>

          {/* Timeline */}
          <div className="flex flex-col gap-3 rounded-md border bg-background p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Linha do tempo</h2>
              {events.data && (
                <span className="text-xs text-muted-foreground">
                  {events.data.total} {events.data.total === 1 ? 'evento' : 'eventos'}
                </span>
              )}
            </div>

            {events.isLoading && (
              <p className="text-sm text-muted-foreground">Carregando eventos…</p>
            )}
            {events.isError && (
              <p className="text-sm text-error">Erro ao carregar eventos.</p>
            )}
            {events.data && events.data.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum evento registrado ainda.
              </p>
            )}

            <ol className="flex flex-col gap-3">
              {events.data?.items.map((ev) => (
                <li
                  key={ev.id}
                  className="flex flex-col gap-1 border-l-2 border-primary/40 pl-3"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium">
                      {labelForEventType(ev.eventType)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {displayRelativeTime(ev.createdAt)}
                    </span>
                  </div>
                  {ev.payload && Object.keys(ev.payload).length > 0 && (
                    <pre className="overflow-x-auto rounded bg-muted px-2 py-1 text-xs">
                      {JSON.stringify(ev.payload, null, 2)}
                    </pre>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      <MarkLostSheet
        open={lostOpen}
        journeyId={j.id}
        onOpenChange={setLostOpen}
      />
    </PageContainer>
  )
}
