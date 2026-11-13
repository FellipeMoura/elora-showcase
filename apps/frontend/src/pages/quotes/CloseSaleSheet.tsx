import { useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Controller, useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
// eslint-disable-next-line no-restricted-imports -- inputs compactos nas linhas da tabela de parcelas (aria-label, sem label na notch)
import { Input } from '@/components/ui/input'
// eslint-disable-next-line no-restricted-imports -- select compacto nas linhas da tabela de parcelas
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TextArea } from '@/components/form/TextArea'
import { SheetBody, SheetContainer } from '@/components/layout/SheetContainer'
import { SheetToolbar } from '@/components/layout/SheetToolbar'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { MoneyField } from '@/components/form/MoneyField'
import { useProcedures } from '@/hooks/useProcedures'
import { useQuote, useCloseSale } from '@/hooks/useQuotes'
import { PAYMENT_METHODS, type PaymentMethod, type PaymentInput } from '@/api/sales'
import { displayMoney } from '@/lib/format'
import { PAYMENT_METHOD_LABELS } from '@/pages/sales/saleLabels'
import { apiErrorText } from '@/lib/apiError'

const FORM_ID = 'close-sale-form'

interface CloseSaleSheetProps {
  open: boolean
  quoteId: string
  onOpenChange: (open: boolean) => void
}

const todayIso = (): string => {
  const now = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// Adiciona N meses a uma data YYYY-MM-DD respeitando o último dia do mês.
const addMonths = (iso: string, months: number): string => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1 + months, d)
  // Se day rolou de mês (ex: 31/jan + 1 → 03/mar), pula pro último do mês anterior.
  if (dt.getDate() !== d) {
    dt.setDate(0)
  }
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`
}

const toCents = (n: number): number => Math.round(n * 100)

// Schema valida só a forma do payload (positividade, presença). As
// regras cross-field (subtotal > 0, soma das parcelas == total, desconto
// <= subtotal) dependem dos `items` da quote — props/runtime, fora do
// alcance do Zod. Ficam derivadas via `watch`.
const installmentSchema = z.object({
  amount: z.number().positive('Informe um valor'),
  paymentMethod: z.enum(PAYMENT_METHODS),
  dueDate: z.string().min(1, 'Obrigatório'),
  receivedNow: z.boolean(),
})

const formSchema = z.object({
  selectedItemIds: z.array(z.string()),
  discountAmount: z.number().min(0),
  notes: z.string(),
  installments: z.array(installmentSchema).min(1),
})

type FormData = z.infer<typeof formSchema>

const emptyInstallment = (): FormData['installments'][number] => ({
  amount: 0,
  paymentMethod: 'pix',
  dueDate: todayIso(),
  receivedNow: true,
})

const emptyDefaults = (): FormData => ({
  selectedItemIds: [],
  discountAmount: 0,
  notes: '',
  installments: [emptyInstallment()],
})

export function CloseSaleSheet({
  open,
  quoteId,
  onOpenChange,
}: CloseSaleSheetProps): React.ReactElement {
  const navigate = useNavigate()
  const closeSaleMutation = useCloseSale()
  const quoteQuery = useQuote(open ? quoteId : undefined)
  const procedures = useProcedures({ page: 1, pageSize: 100, status: 'all' })

  // useMemo pra estabilizar referência — o `?? []` cria array novo a
  // cada render e poluía deps de useMemo derivados (subtotalCents etc).
  const items = useMemo(
    () => quoteQuery.data?.items ?? [],
    [quoteQuery.data],
  )

  const {
    control,
    handleSubmit,
    watch,
    setValue,
    reset,
    getValues,
    register,
    formState: { errors },
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: emptyDefaults(),
  })

  const {
    fields: installmentFields,
    replace: replaceInstallments,
  } = useFieldArray({ control, name: 'installments' })

  // Flag de "as parcelas estão sob controle automático" — true logo
  // após init/Dividir/redistribute, false se o usuário editou qualquer
  // parcela. Usada pra decidir se a próxima adição deve redistribuir
  // (preserva a intuição "todas iguais") ou só anexar uma parcela vazia
  // (respeita alocação manual do usuário).
  const autoBalancedRef = useRef(true)

  // Init é one-shot por abertura do sheet, atrelado ao quoteId carregado.
  // Evita reset do form se quoteQuery refetchar em background — usuário
  // no meio da edição não perde estado.
  const initializedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!open) {
      initializedFor.current = null
      return
    }
    const data = quoteQuery.data
    if (!data) return
    if (initializedFor.current === data.quote.id) return
    // Subtotal de todos os items pra preencher a primeira parcela com o
    // total da venda — usuário não precisa redigitar se a venda for
    // à vista.
    const subtotalAllCents = data.items.reduce((sum, it) => {
      const unitC = toCents(Number(it.unitPrice))
      const pct = Number(it.discountPct)
      return sum + Math.round(unitC * it.quantitySessions * (1 - pct / 100))
    }, 0)
    reset({
      ...emptyDefaults(),
      selectedItemIds: data.items.map((it) => it.id),
      installments: [{ ...emptyInstallment(), amount: subtotalAllCents / 100 }],
    })
    autoBalancedRef.current = true
    initializedFor.current = data.quote.id
  }, [open, quoteQuery.data, reset])

  // Derivações cross-field via watch — ficam fora do schema.
  const watchedSelected = watch('selectedItemIds')
  const watchedDiscount = watch('discountAmount')
  const watchedInstallments = watch('installments')

  const procedureName = (procedureId: string): string =>
    procedures.data?.items.find((p) => p.id === procedureId)?.name ??
    procedureId.slice(0, 8) + '…'

  const subtotalCents = useMemo(() => {
    const set = new Set(watchedSelected)
    return items.reduce((sum, it) => {
      if (!set.has(it.id)) return sum
      const unitC = toCents(Number(it.unitPrice))
      const pct = Number(it.discountPct)
      return sum + Math.round(unitC * it.quantitySessions * (1 - pct / 100))
    }, 0)
  }, [items, watchedSelected])

  const discountCents = toCents(watchedDiscount || 0)
  const totalCents = Math.max(0, subtotalCents - discountCents)
  const total = totalCents / 100

  const installmentsSumCents = useMemo(
    () => watchedInstallments.reduce((sum, p) => sum + toCents(p.amount || 0), 0),
    [watchedInstallments],
  )

  const sumMatches = installmentsSumCents === totalCents
  const hasSelection = subtotalCents > 0
  const discountValid = discountCents <= subtotalCents

  const canSubmit =
    hasSelection &&
    discountValid &&
    installmentFields.length > 0 &&
    sumMatches &&
    !closeSaleMutation.isPending

  // Distribui totalCents igualmente entre N parcelas, com a primeira
  // absorvendo o resto da divisão pra somar exato. Aplica diretamente
  // no array (pure) — caller decide se usa via setValue ou replace.
  const redistribute = (
    items: FormData['installments'],
  ): FormData['installments'] => {
    const n = items.length
    if (n === 0 || totalCents === 0) return items
    const base = Math.floor(totalCents / n)
    const remainder = totalCents - base * n
    return items.map((it, idx) => ({
      ...it,
      amount: (idx === 0 ? base + remainder : base) / 100,
    }))
  }

  const distributeEvenly = () => {
    const next = redistribute(getValues('installments'))
    if (next.length === 0) return
    next.forEach((it, idx) => {
      setValue(`installments.${idx}.amount`, it.amount, {
        shouldValidate: true,
        shouldDirty: true,
      })
    })
    autoBalancedRef.current = true
  }

  const setInstallmentCount = (n: number) => {
    const current = getValues('installments')
    const clamped = Math.max(1, Math.min(12, n))
    if (clamped === current.length) return

    // Snapshot do "modo automático" ANTES da mudança — se as parcelas
    // atuais cobrem o total e o usuário não editou nenhuma na mão,
    // qualquer mudança de contagem deve continuar "tudo igual".
    const shouldRebalance =
      autoBalancedRef.current && sumMatches && totalCents > 0

    let next: FormData['installments']
    if (clamped > current.length) {
      // Adiciona novas parcelas com dueDate +N meses a partir da primeira.
      const first = current[0]
      next = [...current]
      for (let i = current.length; i < clamped; i++) {
        next.push({
          amount: 0,
          paymentMethod: first?.paymentMethod ?? 'pix',
          dueDate: first ? addMonths(first.dueDate, i) : todayIso(),
          receivedNow: false,
        })
      }
    } else {
      // Mantém as primeiras `clamped` parcelas. replace preserva ordem
      // sem o churn de remover por índice em loop.
      next = current.slice(0, clamped)
    }
    if (shouldRebalance) {
      next = redistribute(next)
    }
    replaceInstallments(next)
  }

  // Remoção pontual via Trash2 — mesma regra do botão −: se estava
  // auto-balanceado, redistribui o total entre os que sobraram.
  const removeInstallmentRow = (idx: number) => {
    const current = getValues('installments')
    if (current.length <= 1) return
    const shouldRebalance =
      autoBalancedRef.current && sumMatches && totalCents > 0
    let next = current.filter((_, i) => i !== idx)
    if (shouldRebalance) {
      next = redistribute(next)
    }
    replaceInstallments(next)
  }

  const onSubmit = handleSubmit(async (data) => {
    if (!canSubmit) return

    const payments: PaymentInput[] = data.installments.map((p) => ({
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      dueDate: p.dueDate,
      paidAt: p.receivedNow ? new Date().toISOString() : null,
    }))

    try {
      const res = await closeSaleMutation.mutateAsync({
        id: quoteId,
        input: {
          selectedItemIds: data.selectedItemIds,
          discountAmount: data.discountAmount,
          payments,
          notes: data.notes === '' ? null : data.notes,
        },
      })
      const ignored = items.length - data.selectedItemIds.length
      toast.success(
        `Venda fechada · ${res.procedureSessionIds.length} ${
          res.procedureSessionIds.length === 1 ? 'sessão criada' : 'sessões criadas'
        }${ignored > 0 ? ` · ${ignored} ${ignored === 1 ? 'item descartado' : 'itens descartados'}` : ''}`,
      )
      onOpenChange(false)
      navigate(`/sales/${res.sale.id}`)
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      const message = apiErrorText(err)
      if (status === 400 || status === 409) toast.error(message ?? 'Operação inválida')
      else toast.error('Erro ao fechar venda')
    }
  })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" hideCloseButton className="w-full sm:max-w-2xl">
        <SheetContainer>
          <SheetToolbar srTitle="Fechar venda">
            <SheetToolbar.Action
              label="Cancelar"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={closeSaleMutation.isPending}
            />
            <SheetToolbar.Action
              label={closeSaleMutation.isPending ? 'Fechando…' : 'Fechar venda'}
              type="submit"
              form={FORM_ID}
              disabled={!canSubmit}
            />
          </SheetToolbar>

          <SheetBody>
            <form id={FORM_ID} onSubmit={onSubmit} noValidate>
              {/* Itens do orçamento */}
              <Controller
                control={control}
                name="selectedItemIds"
                render={({ field }) => {
                  const set = new Set(field.value)
                  const toggle = (id: string, next: boolean) => {
                    if (next && !set.has(id)) field.onChange([...field.value, id])
                    else if (!next && set.has(id))
                      field.onChange(field.value.filter((x: string) => x !== id))
                  }
                  return (
                    <section className="mb-4 rounded-md border bg-background">
                      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                        <h3 className="text-sm font-semibold">Itens do orçamento</h3>
                        <span className="text-xs text-muted-foreground">
                          {field.value.length} de {items.length} selecionados
                        </span>
                      </div>
                      <ul className="divide-y">
                        {items.map((it) => {
                          const unitC = toCents(Number(it.unitPrice))
                          const pct = Number(it.discountPct)
                          const lineCents = Math.round(
                            unitC * it.quantitySessions * (1 - pct / 100),
                          )
                          const checked = set.has(it.id)
                          return (
                            <li
                              key={it.id}
                              className="flex items-center gap-3 px-3 py-2.5"
                            >
                              <Checkbox
                                checked={checked}
                                onCheckedChange={(v) => toggle(it.id, Boolean(v))}
                                aria-label={`Selecionar ${procedureName(it.procedureId)}`}
                              />
                              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="truncate text-sm font-medium">
                                  {procedureName(it.procedureId)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {it.quantitySessions}× {displayMoney(it.unitPrice)}
                                  {pct > 0 ? ` · −${pct.toFixed(0)}%` : ''}
                                </span>
                              </div>
                              <span className="shrink-0 tabular-nums text-sm font-medium">
                                {displayMoney(lineCents / 100)}
                              </span>
                            </li>
                          )
                        })}
                        {items.length === 0 && quoteQuery.isLoading && (
                          <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                            Carregando…
                          </li>
                        )}
                        {items.length === 0 && quoteQuery.isError && (
                          <li className="px-3 py-4 text-center text-sm text-error">
                            Erro ao carregar o orçamento.
                          </li>
                        )}
                        {items.length === 0 &&
                          !quoteQuery.isLoading &&
                          !quoteQuery.isError && (
                            <li className="px-3 py-4 text-center text-sm text-muted-foreground">
                              Sem itens.
                            </li>
                          )}
                      </ul>
                    </section>
                  )
                }}
              />

              {/* Resumo financeiro */}
              <section className="mb-4 rounded-md border bg-background p-3">
                <div className="flex flex-col gap-3 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal selecionado</span>
                    <span className="tabular-nums">
                      {displayMoney(subtotalCents / 100)}
                    </span>
                  </div>
                  <MoneyField
                    control={control}
                    name="discountAmount"
                    label="Desconto"
                    max={subtotalCents / 100}
                  />
                  <div className="flex justify-between border-t pt-2 text-base font-semibold">
                    <span>Total a cobrar</span>
                    <span className="tabular-nums">{displayMoney(total)}</span>
                  </div>
                </div>
              </section>

              {/* Parcelas */}
              <section className="mb-4 rounded-md border bg-background">
                <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                  <h3 className="text-sm font-semibold">Parcelas</h3>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setInstallmentCount(installmentFields.length - 1)}
                      disabled={installmentFields.length <= 1}
                      aria-label="Menos uma parcela"
                    >
                      −
                    </Button>
                    <span className="w-6 text-center tabular-nums text-sm">
                      {installmentFields.length}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setInstallmentCount(installmentFields.length + 1)}
                      disabled={installmentFields.length >= 12}
                      aria-label="Mais uma parcela"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={distributeEvenly}
                      disabled={totalCents === 0}
                    >
                      Dividir
                    </Button>
                  </div>
                </div>

                <ul className="divide-y">
                  {installmentFields.map((field, idx) => {
                    const rowErrors = errors.installments?.[idx]
                    const current = watchedInstallments[idx]
                    return (
                      <li
                        key={field.id}
                        className="grid grid-cols-[28px_1fr_1fr_1fr_auto] items-center gap-2 px-3 py-2"
                      >
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {idx + 1}/{installmentFields.length}
                        </span>
                        <MoneyField
                          compact
                          control={control}
                          name={`installments.${idx}.amount`}
                          aria-label={`Valor da parcela ${idx + 1}`}
                          onValueChange={() => {
                            // Edição manual quebra o "modo automático":
                            // próximas adições NÃO vão redistribuir.
                            // Reativado só via Dividir/init.
                            autoBalancedRef.current = false
                          }}
                        />
                        <Controller
                          control={control}
                          name={`installments.${idx}.paymentMethod`}
                          render={({ field: methodField }) => (
                            <Select
                              value={methodField.value}
                              onValueChange={(v) =>
                                methodField.onChange(v as PaymentMethod)
                              }
                            >
                              <SelectTrigger
                                aria-label={`Método de pagamento da parcela ${idx + 1}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {PAYMENT_METHODS.map((m) => (
                                  <SelectItem key={m} value={m}>
                                    {PAYMENT_METHOD_LABELS[m]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                        <Controller
                          control={control}
                          name={`installments.${idx}.dueDate`}
                          render={({ field: dateField }) => (
                            <Input
                              type="date"
                              aria-label={`Vencimento da parcela ${idx + 1}`}
                              aria-invalid={Boolean(rowErrors?.dueDate)}
                              className={
                                rowErrors?.dueDate ? 'border-error' : undefined
                              }
                              value={dateField.value}
                              onChange={(e) => dateField.onChange(e.target.value)}
                              onBlur={dateField.onBlur}
                            />
                          )}
                        />
                        <div className="flex items-center gap-1.5">
                          <Controller
                            control={control}
                            name={`installments.${idx}.receivedNow`}
                            render={({ field: receivedField }) => (
                              <label
                                className="flex items-center gap-1.5 text-xs text-muted-foreground"
                                title="Marcar como já recebida agora"
                              >
                                <Checkbox
                                  checked={receivedField.value}
                                  onCheckedChange={(v) => {
                                    const next = Boolean(v)
                                    receivedField.onChange(next)
                                    // Se marcou recebida com vencimento
                                    // futuro, alinha pra hoje — evita
                                    // paidAt < dueDate.
                                    if (next && current?.dueDate > todayIso()) {
                                      setValue(
                                        `installments.${idx}.dueDate`,
                                        todayIso(),
                                        { shouldValidate: true },
                                      )
                                    }
                                  }}
                                />
                                Paga
                              </label>
                            )}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeInstallmentRow(idx)}
                            disabled={installmentFields.length <= 1}
                            aria-label={`Remover parcela ${idx + 1}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </li>
                    )
                  })}
                </ul>

                <div className="flex items-center justify-between border-t px-3 py-2 text-sm">
                  <span className="text-muted-foreground">Soma das parcelas</span>
                  <span
                    className={`tabular-nums font-medium ${
                      sumMatches ? 'text-foreground' : 'text-error'
                    }`}
                  >
                    {displayMoney(installmentsSumCents / 100)}
                  </span>
                </div>
                {!sumMatches && (
                  <p className="px-3 pb-2 text-xs text-error">
                    A soma das parcelas precisa bater com o total (
                    {displayMoney(total)}).
                  </p>
                )}
              </section>

              {/* Notas */}
              <section className="mb-4 flex flex-col gap-1.5">
                <TextArea
                  id="close-sale-notes"
                  label="Observações"
                  rows={2}
                  placeholder="Comprovante, condições, observações da venda…"
                  {...register('notes')}
                />
              </section>
            </form>
          </SheetBody>
        </SheetContainer>
      </SheetContent>
    </Sheet>
  )
}
