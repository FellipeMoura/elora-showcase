import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { TextField } from '@/components/form/TextField'
import { TextArea } from '@/components/form/TextArea'
import { useUpdateTreatment } from '@/hooks/useTreatments'
import type { Treatment } from '@/api/treatments'
import { apiErrorText } from '@/lib/apiError'

interface TreatmentEditSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  treatment: Treatment | null
}

const FORM_ID = 'treatment-edit-form'

export function TreatmentEditSheet({
  open,
  onOpenChange,
  treatment,
}: TreatmentEditSheetProps): React.ReactElement {
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const updateMut = useUpdateTreatment()

  useEffect(() => {
    if (open && treatment) {
      setName(treatment.name)
      setNotes(treatment.notes ?? '')
    }
  }, [open, treatment])

  const isPending = updateMut.isPending
  const canSubmit =
    Boolean(treatment) && name.trim().length > 0 && !isPending

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!treatment || !canSubmit) return
    const trimmedName = name.trim()
    const trimmedNotes = notes.trim()
    const patch: { name?: string; notes?: string | null } = {}
    if (trimmedName !== treatment.name) patch.name = trimmedName
    const currentNotes = treatment.notes ?? ''
    if (trimmedNotes !== currentNotes) {
      patch.notes = trimmedNotes.length > 0 ? trimmedNotes : null
    }
    if (Object.keys(patch).length === 0) {
      onOpenChange(false)
      return
    }
    try {
      await updateMut.mutateAsync({ id: treatment.id, input: patch })
      toast.success('Tratamento atualizado')
      onOpenChange(false)
    } catch (err) {
      const message =
        apiErrorText(err) ?? 'Falha ao atualizar tratamento'
      toast.error(message)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" hideCloseButton className="w-full sm:max-w-md">
        <SheetContainer>
          <SheetToolbar srTitle="Editar tratamento">
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            />
            <SheetToolbar.Action
              label={isPending ? 'Salvando…' : 'Salvar'}
              type="submit"
              form={FORM_ID}
              disabled={!canSubmit}
            />
          </SheetToolbar>

          <SheetBody>
            <form
              id={FORM_ID}
              onSubmit={handleSubmit}
              className="flex flex-col gap-4"
              noValidate
            >
              <TextField
                id="treatment-name"
                label="Nome"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
                maxLength={255}
              />

              <TextArea
                id="treatment-notes"
                label="Observações"
                rows={8}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={isPending}
                placeholder="Notas clínicas, alertas, contexto do tratamento…"
              />
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
