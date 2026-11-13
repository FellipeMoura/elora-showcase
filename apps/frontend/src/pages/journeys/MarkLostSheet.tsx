import { useState } from 'react'
import { toast } from 'sonner'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { useMarkJourneyLost } from '@/hooks/useJourneys'
import { LOST_REASONS, type LostReason } from '@/api/journeys'
import { LOST_REASON_LABELS } from './journeyLabels'
import { apiErrorText } from '@/lib/apiError'

interface MarkLostSheetProps {
  open: boolean
  journeyId: string | null
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'mark-lost-form'

export function MarkLostSheet({
  open,
  journeyId,
  onOpenChange,
}: MarkLostSheetProps): React.ReactElement {
  const [reason, setReason] = useState<LostReason>('timeout')
  const markLost = useMarkJourneyLost()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!journeyId) return
    try {
      await markLost.mutateAsync({ id: journeyId, input: { reason } })
      toast.success('Jornada marcada como perdida')
      onOpenChange(false)
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao marcar jornada como perdida')
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle="Marcar como perdida">
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={markLost.isPending}
            />
            <SheetToolbar.Action
              label={markLost.isPending ? 'Marcando…' : 'Marcar'}
              type="submit"
              form={FORM_ID}
              variant="destructive"
              disabled={markLost.isPending}
            />
          </SheetToolbar>

          <SheetBody>
            <form
              id={FORM_ID}
              onSubmit={handleSubmit}
              className="flex flex-col gap-3"
              noValidate
            >
              {LOST_REASONS.map((r) => (
                <label
                  key={r}
                  className="flex items-start gap-3 rounded-md border border-input p-3 hover:bg-accent/30"
                >
                  <input
                    type="radio"
                    name="lost-reason"
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    className="mt-1"
                  />
                  <span className="text-sm">{LOST_REASON_LABELS[r]}</span>
                </label>
              ))}
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
