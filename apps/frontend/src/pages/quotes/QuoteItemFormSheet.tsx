import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
// eslint-disable-next-line no-restricted-imports -- input de filtro da lista de procedimentos (não é campo do form)
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyField } from '@/components/form/MoneyField'
import { TextField } from '@/components/form/TextField'
import { TextArea } from '@/components/form/TextArea'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import {
  useCreateQuoteItem,
  useUpdateQuoteItem,
} from '@/hooks/useQuotes'
import { useProcedures } from '@/hooks/useProcedures'
import type { QuoteItem } from '@/api/quotes'
import { apiErrorText } from '@/lib/apiError'

const formSchema = z.object({
  procedureId: z.string().uuid('Selecione um procedimento'),
  quantitySessions: z
    .string()
    .trim()
    .regex(/^\d+$/, 'Apenas números inteiros')
    .refine((v) => Number(v) >= 1 && Number(v) <= 999, '1 a 999 sessões'),
  unitPrice: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d{1,2})?$/, 'Use formato 1234.56'),
  discountPct: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || /^\d+([.,]\d{1,2})?$/.test(v),
      'Use formato 12.34',
    )
    .refine((v) => v === '' || Number(v.replace(',', '.')) <= 100, 'Máximo 100%'),
  notes: z.string().trim().max(1000),
})

type FormValues = z.infer<typeof formSchema>

interface QuoteItemFormSheetProps {
  open: boolean
  quoteId: string
  // null = criar; item = editar existente.
  item: QuoteItem | null
  onOpenChange: (open: boolean) => void
}

const FORM_ID = 'quote-item-form'

const emptyValues: FormValues = {
  procedureId: '',
  quantitySessions: '1',
  unitPrice: '',
  discountPct: '0',
  notes: '',
}

function valuesFromItem(item: QuoteItem | null): FormValues {
  if (!item) return emptyValues
  return {
    procedureId: item.procedureId,
    quantitySessions: String(item.quantitySessions),
    unitPrice: item.unitPrice,
    discountPct: item.discountPct,
    notes: item.notes ?? '',
  }
}

export function QuoteItemFormSheet({
  open,
  quoteId,
  item,
  onOpenChange,
}: QuoteItemFormSheetProps): React.ReactElement {
  const isEdit = Boolean(item)
  const createMutation = useCreateQuoteItem()
  const updateMutation = useUpdateQuoteItem()

  const proceduresQuery = useProcedures({
    page: 1,
    pageSize: 100,
    status: 'active',
    sortBy: 'name',
    sortDir: 'asc',
  })

  const [procedureFilter, setProcedureFilter] = useState('')

  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyValues,
  })

  useEffect(() => {
    if (open) {
      reset(valuesFromItem(item))
      setProcedureFilter('')
    }
  }, [open, item, reset])

  const procedureId = watch('procedureId')

  const filteredProcedures = useMemo(() => {
    const items = proceduresQuery.data?.items ?? []
    const q = procedureFilter.trim().toLowerCase()
    if (!q) return items
    return items.filter((p) => p.name.toLowerCase().includes(q))
  }, [proceduresQuery.data, procedureFilter])

  // Quando seleciona procedimento e o form ainda está vazio, sugere preço
  // default + sessões default do catálogo. Só sugere — usuário pode mudar.
  const handleSelectProcedure = (id: string) => {
    setValue('procedureId', id)
    const proc = proceduresQuery.data?.items.find((p) => p.id === id)
    if (proc) {
      if (watch('unitPrice') === '' && proc.defaultPrice) {
        setValue('unitPrice', proc.defaultPrice)
      }
      if (!isEdit) {
        setValue('quantitySessions', String(proc.defaultSessions))
      }
    }
  }

  const onSubmit = handleSubmit(async (data) => {
    const payload = {
      procedureId: data.procedureId,
      quantitySessions: Number(data.quantitySessions),
      unitPrice: Number(data.unitPrice.replace(',', '.')),
      discountPct: Number((data.discountPct || '0').replace(',', '.')),
      notes: data.notes === '' ? null : data.notes,
    }

    try {
      if (isEdit && item) {
        await updateMutation.mutateAsync({
          quoteId,
          itemId: item.id,
          input: payload,
        })
        toast.success('Item atualizado')
      } else {
        await createMutation.mutateAsync({ quoteId, input: payload })
        toast.success('Item adicionado')
      }
      onOpenChange(false)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const message = apiErrorText(err)
      if (status === 409) toast.error(message ?? 'Operação não permitida')
      else if (status === 404) toast.error(message ?? 'Não encontrado')
      else if (status === 400) toast.error(message ?? 'Dados inválidos')
      else toast.error('Erro ao salvar item')
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
          <SheetToolbar srTitle={isEdit ? 'Editar item' : 'Novo item'}>
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            />
            <SheetToolbar.Action
              label={isSubmitting ? 'Salvando…' : isEdit ? 'Salvar' : 'Adicionar'}
              type="submit"
              form={FORM_ID}
              disabled={isSubmitting}
            />
          </SheetToolbar>

          <SheetBody>
            <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <Label>Procedimento</Label>
                <Input
                  placeholder="Filtrar procedimentos…"
                  value={procedureFilter}
                  onChange={(e) => setProcedureFilter(e.target.value)}
                />
                <div className="max-h-48 overflow-y-auto rounded-md border bg-background">
                  {proceduresQuery.isLoading && (
                    <p className="p-3 text-sm text-muted-foreground">
                      Carregando…
                    </p>
                  )}
                  {filteredProcedures.length === 0 && !proceduresQuery.isLoading && (
                    <p className="p-3 text-sm text-muted-foreground">
                      Nenhum procedimento encontrado.
                    </p>
                  )}
                  <ul className="divide-y">
                    {filteredProcedures.map((p) => {
                      const active = procedureId === p.id
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => handleSelectProcedure(p.id)}
                            className={`flex w-full items-center justify-between gap-2 p-2 text-left text-sm hover:bg-muted ${
                              active ? 'bg-primary/10' : ''
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="font-medium">{p.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {p.defaultSessions}{' '}
                                {p.defaultSessions === 1 ? 'sessão' : 'sessões'} ·
                                preço-base{' '}
                                {p.defaultPrice
                                  ? `R$ ${p.defaultPrice}`
                                  : 'não definido'}
                              </div>
                            </div>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
                {errors.procedureId?.message && (
                  <p className="text-xs text-destructive" role="alert">
                    {errors.procedureId.message}
                  </p>
                )}
              </div>

              <TextField
                label="Quantidade de sessões"
                inputMode="numeric"
                error={errors.quantitySessions?.message ?? null}
                required
                {...register('quantitySessions')}
              />

              {/* Zerado volta pra '' — mantém o "obrigatório" do schema e o
                  pré-preenchimento pelo preço sugerido do procedimento. */}
              <MoneyField
                label="Preço por sessão"
                error={errors.unitPrice?.message ?? null}
                required
                value={watch('unitPrice')}
                onValueChange={(v) =>
                  setValue('unitPrice', v > 0 ? v.toFixed(2) : '', {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              />

              <TextField
                label="Desconto (%)"
                inputMode="decimal"
                helperText="Aplicado por sessão. 0 a 100."
                error={errors.discountPct?.message ?? null}
                {...register('discountPct')}
              />

              <TextArea
                id="quote-item-notes"
                label="Observações"
                rows={3}
                placeholder="Detalhes específicos deste item…"
                {...register('notes')}
              />
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
