import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, FileText, PenLine } from 'lucide-react'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { TextArea } from '@/components/form/TextArea'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { useEvolveProcedureSession } from '@/hooks/useProcedureSessions'
import { useProcedure } from '@/hooks/useProcedures'
import { useClient } from '@/hooks/useClients'
import type { ProcedureSession } from '@/api/procedureSessions'
import { apiErrorText } from '@/lib/apiError'

// =====================================================================
// SessionEvolutionSheet — fluxo de evolução clínica (signed → done).
//
// Aberta a partir do popover da agenda (em appointment kind=procedure
// status=attended com session.status='signed'), do detalhe do cliente
// ou da EvolutionsPage. Exige nota não-vazia; backend valida.
//
// Estados resolvidos pelo session passado:
//   - signed   → form ativo, submit habilitado
//   - done     → mostra read-only com nota atual (chat-domain.md §6:
//                edição clínica permitida em qualquer status, mas o
//                fluxo "evoluir" é one-shot — pra editar nota depois
//                use o endpoint PATCH normal)
//   - pending  → bloqueia ("cliente ainda não assinou presença")
//   - cancelled → bloqueia ("sessão cancelada")
// =====================================================================

interface SessionEvolutionSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session: ProcedureSession | null
  /** Disparado após sucesso pra caller invalidar listas locais. */
  onEvolved?: (session: ProcedureSession) => void
  /** Disparado quando o usuário pede pra ver a assinatura registrada. */
  onViewSignature?: () => void
}

export function SessionEvolutionSheet({
  open,
  onOpenChange,
  session,
  onEvolved,
  onViewSignature,
}: SessionEvolutionSheetProps): React.ReactElement {
  const [notes, setNotes] = useState('')
  const evolveMut = useEvolveProcedureSession()
  const client = useClient(session?.clientId)
  const procedure = useProcedure(session?.procedureId)

  useEffect(() => {
    if (open) setNotes(session?.evolutionNotes ?? '')
  }, [open, session?.id, session?.evolutionNotes])

  if (!session) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" hideCloseButton className="w-full sm:max-w-lg">
          <SheetContainer>
            <SheetToolbar srTitle="Evoluir sessão">
              <SheetToolbar.Action
                label="Fechar"
                variant="ghost"
                onClick={() => onOpenChange(false)}
              />
            </SheetToolbar>
            <SheetBody>
              <p className="text-sm text-muted-foreground">
                Sessão não carregada.
              </p>
            </SheetBody>
          </SheetContainer>
        </SheetContent>
      </Sheet>
    )
  }

  const status = session.status
  const isSigned = status === 'signed'
  const isDone = status === 'done'
  const canSubmit = isSigned && notes.trim().length > 0 && !evolveMut.isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit) return
    try {
      const updated = await evolveMut.mutateAsync({
        id: session.id,
        input: { evolutionNotes: notes.trim() },
      })
      toast.success('Evolução registrada')
      onEvolved?.(updated)
      onOpenChange(false)
    } catch (err) {
      const message =
        apiErrorText(err) ?? 'Falha ao registrar evolução'
      toast.error(message)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" hideCloseButton className="w-full sm:max-w-lg">
        <SheetContainer>
          <SheetToolbar srTitle="Evoluir sessão">
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={evolveMut.isPending}
            />
            {isSigned && (
              <SheetToolbar.Action
                label="Concluir evolução"
                type="submit"
                form="session-evolution-form"
                disabled={!canSubmit}
              />
            )}
          </SheetToolbar>

          <SheetBody>
            <div className="flex flex-col gap-3">
              <ContextCard
                clientName={client.data?.name}
                procedureName={procedure.data?.name}
                executedAt={session.executedAt}
              />

              {status === 'pending' && (
                <BlockedBox
                  title="Cliente ainda não assinou presença"
                  description="A evolução só é registrada após o cliente confirmar presença pelo link público. Volte ao popover da agenda e gere o link de presença."
                />
              )}
              {status === 'cancelled' && (
                <BlockedBox
                  title="Sessão cancelada"
                  description="Sessões canceladas não podem ser evoluídas."
                />
              )}

              {isDone && (
                <DoneNotice />
              )}

              {(isSigned || isDone) && onViewSignature && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-fit"
                  onClick={onViewSignature}
                >
                  <PenLine className="mr-1.5 size-3.5" />
                  Ver assinatura registrada
                </Button>
              )}

              {(isSigned || isDone) && (
                <form
                  id="session-evolution-form"
                  onSubmit={handleSubmit}
                  className="flex flex-col gap-1.5"
                >
                  <TextArea
                    id="evolution-notes"
                    label="Evolução clínica"
                    required={isSigned}
                    rows={10}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    disabled={isDone || evolveMut.isPending}
                    placeholder="Técnica aplicada, intensidade, áreas trabalhadas, reação imediata, orientações pós-procedimento…"
                    helperText={
                      isSigned
                        ? 'Observação registrada na ficha do cliente e usada como atestado clínico da sessão.'
                        : undefined
                    }
                  />
                </form>
              )}
            </div>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}

function ContextCard({
  clientName,
  procedureName,
  executedAt,
}: {
  clientName: string | undefined
  procedureName: string | undefined
  executedAt: string | null
}): React.ReactElement {
  const signedAt = executedAt ? new Date(executedAt) : null
  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-surface p-3">
      <div className="flex items-center gap-2 text-sm">
        <FileText className="size-4 text-muted-foreground" />
        <span className="font-medium">{procedureName ?? '—'}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        Cliente: <span className="text-foreground">{clientName ?? '—'}</span>
      </div>
      {signedAt && (
        <div className="text-xs text-muted-foreground">
          Presença assinada em{' '}
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
        </div>
      )}
    </div>
  )
}

function BlockedBox({
  title,
  description,
}: {
  title: string
  description: string
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-warning/40 bg-warning-soft p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="size-4 shrink-0 text-warning" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-warning-soft-foreground">
            {title}
          </p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
    </div>
  )
}

function DoneNotice(): React.ReactElement {
  return (
    <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/10 p-3">
      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
      <div className="flex flex-col gap-0.5">
        <p className="text-sm font-medium text-success">Sessão já evoluída</p>
        <p className="text-xs text-muted-foreground">
          A nota abaixo é o registro atual. Pra ajustar a observação use a
          edição clínica pelo detalhe do cliente.
        </p>
      </div>
    </div>
  )
}
