import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Ban,
  CalendarCheck,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { displayPhone, displayRelativeTime } from '@/lib/format'
import {
  useLead,
  useRecomputeLeadSubstage,
} from '@/hooks/useLeads'
import { SOURCE_LABELS } from '@/pages/journeys/journeyLabels'
import {
  LEAD_SUBSTAGE_BADGE_CLASS,
  LEAD_SUBSTAGE_LABELS_SHORT,
} from './leadSubstageLabels'
import { MarkLostSheet } from '@/pages/journeys/MarkLostSheet'
import { apiErrorText } from '@/lib/apiError'

interface LeadDetailSheetProps {
  open: boolean
  leadId: string | null
  onOpenChange: (open: boolean) => void
}

// Formata `nextEvaluationAt` por extenso — drawer tem espaço, pode mostrar
// "23/05/2026 às 14h32".
function formatEvaluationFull(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear()
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${dd}/${mm}/${yy} às ${hh}h${mi}`
}

export function LeadDetailSheet({
  open,
  leadId,
  onOpenChange,
}: LeadDetailSheetProps): React.ReactElement {
  const { data: lead, isLoading } = useLead(open ? leadId ?? undefined : undefined)
  const recompute = useRecomputeLeadSubstage()
  const [markLostOpen, setMarkLostOpen] = useState(false)

  const handleRecompute = async () => {
    if (!lead) return
    try {
      await recompute.mutateAsync(lead.id)
      toast.success('Substage recalculado')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao recalcular substage')
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="right"
          hideCloseButton
          className="w-full sm:max-w-md"
        >
          <SheetContainer>
            <SheetToolbar srTitle={lead?.clientName ?? 'Lead'}>
              <SheetToolbar.Action
                label="Recalcular"
                icon={<RefreshCw className={recompute.isPending ? 'size-4 animate-spin' : 'size-4'} />}
                variant="ghost"
                onClick={handleRecompute}
                disabled={recompute.isPending || !lead}
                aria-label="Recalcular substage"
              />
              <SheetToolbar.Action
                label="Marcar como perdido"
                icon={<Ban className="size-4" />}
                variant="destructive"
                onClick={() => setMarkLostOpen(true)}
                disabled={!lead}
              />
            </SheetToolbar>

            <SheetBody>
              {isLoading || !lead ? (
                <div className="text-sm text-muted-foreground">Carregando…</div>
              ) : (
                <div className="flex flex-col gap-5 text-sm">
              {(lead.substage || lead.source) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {lead.substage && (
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${LEAD_SUBSTAGE_BADGE_CLASS[lead.substage]}`}
                    >
                      {LEAD_SUBSTAGE_LABELS_SHORT[lead.substage]}
                    </span>
                  )}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {SOURCE_LABELS[lead.source]}
                  </span>
                </div>
              )}

              <Section title="Contato">
                <Row label="Telefone">
                  {lead.clientPhone ? (
                    <a
                      href={`tel:${lead.clientPhone}`}
                      className="hover:underline"
                    >
                      {displayPhone(lead.clientPhone)}
                    </a>
                  ) : (
                    '—'
                  )}
                </Row>
                <Row label="Email">{lead.clientEmail ?? '—'}</Row>
              </Section>

              <Section title="Atividade">
                <Row label="Criado">
                  {displayRelativeTime(lead.createdAt)}
                </Row>
                <Row label="Última atividade">
                  {displayRelativeTime(lead.lastActivityAt)}
                </Row>
                {lead.nextEvaluationAt && (
                  <Row label="Próxima avaliação">
                    <span className="inline-flex items-center gap-1 text-info">
                      <CalendarCheck className="size-3.5" />
                      {formatEvaluationFull(lead.nextEvaluationAt)}
                    </span>
                  </Row>
                )}
              </Section>

              {lead.latestQuoteId && (
                <Section title="Orçamento">
                  <Row label="Status">
                    {lead.latestQuoteStatus ?? '—'}
                  </Row>
                  <Link
                    to={`/quotes/${lead.latestQuoteId}`}
                    onClick={() => onOpenChange(false)}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    <ExternalLink className="size-3.5" />
                    Abrir orçamento
                  </Link>
                </Section>
              )}

              <Section title="Jornada">
                <Link
                  to={`/journeys/${lead.id}`}
                  onClick={() => onOpenChange(false)}
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="size-3.5" />
                  Ver jornada completa
                </Link>
              </Section>

                </div>
              )}
            </SheetBody>
          </SheetContainer>
        </SheetContent>
      </Sheet>

      <MarkLostSheet
        open={markLostOpen}
        journeyId={lead?.id ?? null}
        onOpenChange={setMarkLostOpen}
      />
    </>
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
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}): React.ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}
