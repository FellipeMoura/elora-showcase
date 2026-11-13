import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
// eslint-disable-next-line no-restricted-imports -- input de filtro da lista de jornadas (não é campo do form)
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyField } from '@/components/form/MoneyField'
import { TextField } from '@/components/form/TextField'
import { TextArea } from '@/components/form/TextArea'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { ButtonGroup } from '@/components/ui/button-group'
import { useCreateQuote } from '@/hooks/useQuotes'
import { useJourneys } from '@/hooks/useJourneys'
import { ClientLabel } from '@/pages/journeys/ClientLabel'
import { STAGE_LABELS } from '@/pages/journeys/journeyLabels'
import { displayRelativeTime } from '@/lib/format'
import { QUOTE_ORIGINS, type QuoteOrigin } from '@/api/quotes'
import { ORIGIN_LABELS } from './quoteLabels'
import { apiErrorText } from '@/lib/apiError'

const formSchema = z.object({
  origin: z.enum(QUOTE_ORIGINS),
  discountAmount: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\d+([.,]\d{1,2})?$/.test(v),
      'Use formato 1234.56 (ou 0)',
    ),
  validUntil: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v),
      'Data deve estar em YYYY-MM-DD',
    ),
  notes: z.string().trim().max(10000),
})

type FormValues = z.infer<typeof formSchema>

const ORIGIN_OPTIONS: ReadonlyArray<{ value: QuoteOrigin; label: string }> =
  QUOTE_ORIGINS.map((v) => ({ value: v, label: ORIGIN_LABELS[v] }))

const FORM_ID = 'quote-form'

interface QuoteFormSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  // Quando fornecido, pula o seletor de jornada e cria já vinculado.
  presetJourneyId?: string
}

export function QuoteFormSheet({
  open,
  onOpenChange,
  presetJourneyId,
}: QuoteFormSheetProps): React.ReactElement {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const urlJourneyId = searchParams.get('journeyId') ?? undefined
  const initialJourneyId = presetJourneyId ?? urlJourneyId

  const [journeyId, setJourneyId] = useState<string | null>(
    initialJourneyId ?? null,
  )
  const [journeyFilter, setJourneyFilter] = useState('')

  const createMutation = useCreateQuote()

  const journeysQuery = useJourneys({
    page: 1,
    pageSize: 50,
    status: 'active',
    sortBy: 'lastActivityAt',
    sortDir: 'desc',
  })

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      origin: 'evaluation',
      discountAmount: '0',
      validUntil: '',
      notes: '',
    },
  })

  // Reset toda vez que o sheet abre — evita carregar valores de uma criação
  // anterior cancelada.
  useEffect(() => {
    if (open) {
      reset({
        origin: 'evaluation',
        discountAmount: '0',
        validUntil: '',
        notes: '',
      })
      setJourneyId(initialJourneyId ?? null)
      setJourneyFilter('')
    }
  }, [open, initialJourneyId, reset])

  const origin = watch('origin')

  // Lista filtrada client-side por busca livre — testa contra journey.id ou
  // clientId (cliente nome resolveria via N+1, fica caro).
  const filteredJourneys = useMemo(() => {
    const items = journeysQuery.data?.items ?? []
    const q = journeyFilter.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (j) =>
        j.id.toLowerCase().includes(q) ||
        j.clientId.toLowerCase().includes(q),
    )
  }, [journeysQuery.data, journeyFilter])

  const onSubmit = handleSubmit(async (data) => {
    if (!journeyId) {
      toast.error('Selecione uma jornada')
      return
    }

    const discountAmount = Number(data.discountAmount.replace(',', '.') || '0')
    if (!Number.isFinite(discountAmount) || discountAmount < 0) {
      toast.error('Desconto inválido')
      return
    }

    // YYYY-MM-DD vira ISO no início do dia local — backend aceita datetime ISO.
    const validUntil =
      data.validUntil === ''
        ? null
        : new Date(`${data.validUntil}T23:59:59`).toISOString()

    try {
      const created = await createMutation.mutateAsync({
        journeyId,
        origin: data.origin,
        discountAmount,
        validUntil,
        notes: data.notes === '' ? null : data.notes,
      })
      toast.success('Orçamento criado')
      onOpenChange(false)
      navigate(`/quotes/${created.id}`)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const message = apiErrorText(err)
      if (status === 409) toast.error(message ?? 'Conflito ao criar orçamento')
      else if (status === 404) toast.error(message ?? 'Jornada não encontrada')
      else if (status === 400) toast.error(message ?? 'Dados inválidos')
      else toast.error('Erro ao criar orçamento')
    }
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full sm:max-w-md"
      >
        <SheetContainer>
          <SheetToolbar srTitle="Novo orçamento">
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            />
            <SheetToolbar.Action
              label={isSubmitting ? 'Criando…' : 'Criar'}
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting || !journeyId}
            />
          </SheetToolbar>

          <SheetBody>
            <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {/* Seletor de jornada — escondido quando preset vem da URL */}
              {!initialJourneyId && (
                <div className="flex flex-col gap-1.5">
                  <Label>Jornada</Label>
                  <Input
                    placeholder="Filtrar por id / clientId…"
                    value={journeyFilter}
                    onChange={(e) => setJourneyFilter(e.target.value)}
                  />
                  <div className="max-h-64 overflow-y-auto rounded-md border bg-background">
                    {journeysQuery.isLoading && (
                      <p className="p-3 text-sm text-muted-foreground">
                        Carregando jornadas ativas…
                      </p>
                    )}
                    {journeysQuery.isError && (
                      <p className="p-3 text-sm text-error">
                        Erro ao carregar jornadas.
                      </p>
                    )}
                    {!journeysQuery.isLoading &&
                      !journeysQuery.isError &&
                      filteredJourneys.length === 0 && (
                        <p className="p-3 text-sm text-muted-foreground">
                          Nenhuma jornada ativa encontrada.
                        </p>
                      )}
                    <ul className="divide-y">
                      {filteredJourneys.map((j) => {
                        const active = journeyId === j.id
                        return (
                          <li key={j.id}>
                            <button
                              type="button"
                              onClick={() => setJourneyId(j.id)}
                              className={`flex w-full items-center justify-between gap-2 p-2 text-left text-sm hover:bg-muted ${
                                active ? 'bg-primary/10' : ''
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <ClientLabel clientId={j.clientId} />
                                <div className="mt-0.5 text-xs text-muted-foreground">
                                  {STAGE_LABELS[j.stage]} ·{' '}
                                  {displayRelativeTime(j.lastActivityAt)}
                                </div>
                              </div>
                              {active && (
                                <span className="rounded bg-primary/15 px-1.5 py-0.5 text-xs font-medium text-primary">
                                  Selecionada
                                </span>
                              )}
                            </button>
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Mostra até 50 jornadas ativas. Pra mais controle, abra o
                    orçamento diretamente pela jornada.
                  </p>
                </div>
              )}

              {initialJourneyId && (
                <div className="flex flex-col gap-1.5">
                  <Label>Jornada</Label>
                  <div className="rounded-md border bg-muted/30 p-2 font-mono text-xs">
                    {initialJourneyId}
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <Label>Origem</Label>
                <ButtonGroup
                  value={origin}
                  onChange={(v) => setValue('origin', v)}
                  options={ORIGIN_OPTIONS}
                  aria-label="Origem do orçamento"
                />
              </div>

              <MoneyField
                label="Desconto sobre total"
                helperText="Aplicado depois da soma dos itens. Aceita 0."
                error={errors.discountAmount?.message ?? null}
                value={watch('discountAmount')}
                onValueChange={(v) =>
                  setValue('discountAmount', v.toFixed(2), {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />

              <TextField
                label="Válido até"
                type="date"
                helperText="Opcional. Depois dessa data o orçamento pode ser expirado."
                error={errors.validUntil?.message ?? null}
                {...register('validUntil')}
              />

              <TextArea
                id="quote-notes"
                label="Observações"
                rows={4}
                placeholder="Condições, parcelamento sugerido, observações internas…"
                {...register('notes')}
              />
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
