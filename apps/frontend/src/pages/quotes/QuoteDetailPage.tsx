import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Ban,
  Check,
  Pencil,
  Plus,
  Send,
  Timer,
  Trash2,
  Undo2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useConfirm } from '@/components/ui/confirm-context'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { Table, type TableColumn } from '@/components/data/Table'
import { type RowAction } from '@/components/data/RowActions'
import { MoneyField } from '@/components/form/MoneyField'
import { TextField } from '@/components/form/TextField'
import { TextArea } from '@/components/form/TextArea'
import { useJourney } from '@/hooks/useJourneys'
import { useProcedures } from '@/hooks/useProcedures'
import {
  useDeleteQuote,
  useDeleteQuoteItem,
  useExpireQuote,
  useQuote,
  useRejectQuote,
  useRevertQuoteToDraft,
  useSendQuote,
  useUpdateQuote,
} from '@/hooks/useQuotes'
import type { QuoteItem } from '@/api/quotes'
import { displayMoney, displayRelativeTime } from '@/lib/format'
import { ClientLabel } from '@/pages/journeys/ClientLabel'
import { ORIGIN_LABELS, STATUS_BADGE_CLASS, STATUS_LABELS } from './quoteLabels'
import { QuoteItemFormSheet } from './QuoteItemFormSheet'
import { CloseSaleSheet } from './CloseSaleSheet'
import { apiErrorText } from '@/lib/apiError'

function subtotalOfItem(it: QuoteItem): number {
  const unit = Number(it.unitPrice)
  const pct = Number(it.discountPct)
  return unit * it.quantitySessions * (1 - pct / 100)
}

export function QuoteDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const confirm = useConfirm()

  const quoteQuery = useQuote(id)
  const journey = useJourney(quoteQuery.data?.quote.journeyId)
  const procedures = useProcedures({
    page: 1,
    pageSize: 100,
    status: 'all',
  })

  const updateMutation = useUpdateQuote()
  const sendMutation = useSendQuote()
  const revertMutation = useRevertQuoteToDraft()
  const rejectMutation = useRejectQuote()
  const expireMutation = useExpireQuote()
  const deleteMutation = useDeleteQuote()
  const deleteItemMutation = useDeleteQuoteItem()

  const [itemSheetOpen, setItemSheetOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<QuoteItem | null>(null)
  const [closeSaleOpen, setCloseSaleOpen] = useState(false)

  // Form state pra edição inline (só usado em draft).
  const [discountInput, setDiscountInput] = useState('')
  const [validUntilInput, setValidUntilInput] = useState('')
  const [notesInput, setNotesInput] = useState('')

  // Sincroniza inputs com o quote sempre que ele recarrega.
  useEffect(() => {
    const q = quoteQuery.data?.quote
    if (!q) return
    setDiscountInput(q.discountAmount)
    setValidUntilInput(q.validUntil ? q.validUntil.slice(0, 10) : '')
    setNotesInput(q.notes ?? '')
  }, [quoteQuery.data?.quote])

  if (quoteQuery.isLoading) {
    return (
      <PageContainer>
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Carregando orçamento…
        </div>
      </PageContainer>
    )
  }

  if (quoteQuery.isError || !quoteQuery.data) {
    return (
      <PageContainer>
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>Erro ao carregar orçamento.</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/quotes')}>
            Voltar
          </Button>
        </div>
      </PageContainer>
    )
  }

  const { quote, items } = quoteQuery.data
  const isDraft = quote.status === 'draft'
  const isSent = quote.status === 'sent'
  const isTerminal =
    quote.status === 'accepted' ||
    quote.status === 'rejected' ||
    quote.status === 'expired'

  const itemsTotal = items.reduce((sum, it) => sum + subtotalOfItem(it), 0)

  const procedureName = (procedureId: string): string => {
    const p = procedures.data?.items.find((p) => p.id === procedureId)
    return p?.name ?? procedureId.slice(0, 8) + '…'
  }

  // Pra `expire` precisamos saber se validUntil já passou (backend valida).
  const validUntilPassed = Boolean(
    quote.validUntil && new Date(quote.validUntil) < new Date(),
  )

  const isDirty =
    isDraft &&
    (discountInput !== quote.discountAmount ||
      (validUntilInput || null) !==
        (quote.validUntil ? quote.validUntil.slice(0, 10) : null) ||
      notesInput !== (quote.notes ?? ''))

  const handleSaveQuote = async () => {
    const discount = Number(discountInput.replace(',', '.'))
    if (!Number.isFinite(discount) || discount < 0) {
      toast.error('Desconto inválido')
      return
    }
    const validUntil =
      validUntilInput === ''
        ? null
        : new Date(`${validUntilInput}T23:59:59`).toISOString()

    try {
      await updateMutation.mutateAsync({
        id: quote.id,
        input: {
          discountAmount: discount,
          validUntil,
          notes: notesInput === '' ? null : notesInput,
        },
      })
      toast.success('Orçamento atualizado')
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status
      if (status === 409) toast.error('Só permitido em rascunho')
      else toast.error('Erro ao atualizar orçamento')
    }
  }

  const handleSend = async () => {
    if (items.length === 0) {
      toast.error('Adicione ao menos um item antes de enviar')
      return
    }
    const ok = await confirm({
      title: 'Enviar orçamento?',
      description: 'Depois disso não dá pra editar itens.',
      confirmLabel: 'Enviar',
    })
    if (!ok) return
    try {
      await sendMutation.mutateAsync(quote.id)
      toast.success('Orçamento enviado')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao enviar orçamento')
    }
  }

  const handleRevertToDraft = async () => {
    const ok = await confirm({
      title: 'Voltar orçamento para rascunho?',
      description: 'Items poderão ser editados novamente.',
      confirmLabel: 'Voltar para rascunho',
    })
    if (!ok) return
    try {
      await revertMutation.mutateAsync(quote.id)
      toast.success('Orçamento voltou para rascunho')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao reverter orçamento')
    }
  }

  const handleReject = async () => {
    const ok = await confirm({
      title: 'Recusar este orçamento?',
      description: 'Selo final.',
      confirmLabel: 'Recusar',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await rejectMutation.mutateAsync(quote.id)
      toast.success('Orçamento recusado')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao recusar orçamento')
    }
  }

  const handleExpire = async () => {
    const ok = await confirm({
      title: 'Marcar orçamento como expirado?',
      confirmLabel: 'Marcar como expirado',
      variant: 'warning',
    })
    if (!ok) return
    try {
      await expireMutation.mutateAsync(quote.id)
      toast.success('Orçamento expirado')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao expirar orçamento')
    }
  }

  const handleDelete = async () => {
    const ok = await confirm({
      title: 'Excluir este orçamento?',
      description: 'Só permitido em rascunho.',
      confirmLabel: 'Excluir',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await deleteMutation.mutateAsync(quote.id)
      toast.success('Orçamento excluído')
      navigate('/quotes')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao excluir')
    }
  }

  const handleDeleteItem = async (item: QuoteItem) => {
    const ok = await confirm({
      title: 'Remover este item do orçamento?',
      confirmLabel: 'Remover',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await deleteItemMutation.mutateAsync({
        quoteId: quote.id,
        itemId: item.id,
      })
      toast.success('Item removido')
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao remover item')
    }
  }

  const itemColumns: TableColumn<QuoteItem, never>[] = [
    {
      key: 'procedure',
      header: 'Procedimento',
      cell: (it) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{procedureName(it.procedureId)}</span>
          {it.notes && (
            <span className="text-xs text-muted-foreground">{it.notes}</span>
          )}
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Sessões',
      className: 'text-right tabular-nums',
      cell: (it) => it.quantitySessions,
    },
    {
      key: 'unit',
      header: 'Preço/sessão',
      className: 'text-right tabular-nums',
      cell: (it) => displayMoney(it.unitPrice),
    },
    {
      key: 'disc',
      header: 'Desconto',
      className: 'text-right tabular-nums',
      cell: (it) => `${Number(it.discountPct).toFixed(2)}%`,
    },
    {
      key: 'subtotal',
      header: 'Subtotal',
      className: 'text-right tabular-nums font-medium',
      cell: (it) => displayMoney(subtotalOfItem(it)),
    },
  ]

  const itemActions = (it: QuoteItem): RowAction[] => {
    if (!isDraft) return []
    return [
      {
        label: 'Editar',
        icon: <Pencil />,
        onClick: () => {
          setEditingItem(it)
          setItemSheetOpen(true)
        },
      },
      {
        label: 'Remover',
        icon: <Trash2 />,
        onClick: () => handleDeleteItem(it),
        destructive: true,
      },
    ]
  }

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Action
          icon={<ArrowLeft />}
          onClick={() => navigate('/quotes')}
          variant="ghost"
          aria-label="Voltar"
          placement="leading"
        />
        {isDraft && (
          <>
            <PageToolbar.Action
              label="Enviar"
              icon={<Send />}
              onClick={handleSend}
              variant="outline"
              disabled={sendMutation.isPending || items.length === 0}
            />
            <PageToolbar.Action
              label="Excluir"
              icon={<Trash2 />}
              onClick={handleDelete}
              variant="outline"
              disabled={deleteMutation.isPending}
            />
          </>
        )}
        {isSent && (
          <>
            <PageToolbar.Action
              label="Fechar venda"
              icon={<Check />}
              onClick={() => setCloseSaleOpen(true)}
              disabled={items.length === 0}
            />
            <PageToolbar.Action
              label="Voltar para rascunho"
              icon={<Undo2 />}
              onClick={handleRevertToDraft}
              variant="outline"
              disabled={revertMutation.isPending}
            />
            <PageToolbar.Action
              label="Recusar"
              icon={<X />}
              onClick={handleReject}
              variant="outline"
              disabled={rejectMutation.isPending}
            />
            <PageToolbar.Action
              label="Expirar"
              icon={<Timer />}
              onClick={handleExpire}
              variant="outline"
              disabled={expireMutation.isPending || !validUntilPassed}
            />
          </>
        )}
      </PageToolbar>

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {/* Identificação — cliente + status + origem + link da jornada */}
        <section className="flex flex-col gap-2 rounded-md border bg-background p-4">
          {journey.data && <ClientLabel clientId={journey.data.clientId} />}
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[quote.status]}`}
            >
              {STATUS_LABELS[quote.status]}
            </span>
            <span className="text-xs text-muted-foreground">
              Origem: {ORIGIN_LABELS[quote.origin]}
            </span>
            {journey.data && (
              <Link
                to={`/journeys/${journey.data.id}`}
                className="text-xs text-primary hover:underline"
              >
                Ver jornada →
              </Link>
            )}
            {isTerminal && (
              <span className="text-xs text-muted-foreground">
                · Orçamento finalizado — somente leitura.
              </span>
            )}
          </div>
        </section>

        {/* Conteúdo: dados (esq) + itens (dir, mais largo) */}
        <div className="grid flex-1 grid-cols-1 gap-3 lg:grid-cols-[320px_1fr]">
          {/* Dados */}
          <div className="flex flex-col gap-3 rounded-md border bg-background p-4">
            <h2 className="text-sm font-semibold">Dados</h2>

            <MoneyField
              id="quote-discount"
              label="Desconto sobre total"
              value={discountInput}
              disabled={!isDraft}
              onValueChange={(v) => setDiscountInput(v.toFixed(2))}
            />

            <TextField
              id="quote-valid-until"
              label="Válido até"
              type="date"
              value={validUntilInput}
              disabled={!isDraft}
              onChange={(e) => setValidUntilInput(e.target.value)}
            />

            <TextArea
              id="quote-notes"
              label="Observações"
              rows={4}
              value={notesInput}
              disabled={!isDraft}
              onChange={(e) => setNotesInput(e.target.value)}
              placeholder={isDraft ? 'Condições, parcelamento sugerido…' : undefined}
            />

            {isDirty && (
              <Button
                size="sm"
                onClick={handleSaveQuote}
                disabled={updateMutation.isPending}
                className="self-end"
              >
                Salvar alterações
              </Button>
            )}

            <div className="mt-2 flex flex-col gap-1.5 border-t pt-3 text-xs text-muted-foreground">
              <div className="flex justify-between">
                <span>Itens</span>
                <span className="tabular-nums">{displayMoney(itemsTotal)}</span>
              </div>
              <div className="flex justify-between">
                <span>Desconto</span>
                <span className="tabular-nums">
                  − {displayMoney(quote.discountAmount)}
                </span>
              </div>
              <div className="mt-1 flex justify-between border-t pt-1 text-sm font-semibold text-foreground">
                <span>Total</span>
                <span className="tabular-nums">{displayMoney(quote.totalAmount)}</span>
              </div>
            </div>

            <div className="mt-2 flex flex-col gap-1 border-t pt-3 text-xs text-muted-foreground">
              <div>
                Criado{' '}
                <span className="text-foreground">
                  {displayRelativeTime(quote.createdAt)}
                </span>
              </div>
              {quote.sentAt && (
                <div>
                  Enviado{' '}
                  <span className="text-foreground">
                    {displayRelativeTime(quote.sentAt)}
                  </span>
                </div>
              )}
              {quote.acceptedAt && (
                <div>
                  Aceito{' '}
                  <span className="text-foreground">
                    {displayRelativeTime(quote.acceptedAt)}
                  </span>
                </div>
              )}
              {quote.rejectedAt && (
                <div>
                  Recusado{' '}
                  <span className="text-foreground">
                    {displayRelativeTime(quote.rejectedAt)}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Itens */}
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Itens do orçamento</h2>
              {isDraft && (
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingItem(null)
                    setItemSheetOpen(true)
                  }}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Adicionar item
                </Button>
              )}
            </div>

            <Table<QuoteItem, never>
              columns={itemColumns}
              data={items}
              rowKey={(it) => it.id}
              actions={isDraft ? itemActions : undefined}
              emptyText={
                isDraft
                  ? 'Nenhum item ainda. Adicione pelo botão acima.'
                  : 'Sem itens.'
              }
            />

            {isSent && validUntilPassed && (
              <p className="flex items-center gap-1 text-xs text-warning">
                <Ban className="h-3 w-3" />
                Este orçamento já passou da validade.
              </p>
            )}
          </div>
        </div>
      </div>

      <QuoteItemFormSheet
        open={itemSheetOpen}
        quoteId={quote.id}
        item={editingItem}
        onOpenChange={setItemSheetOpen}
      />

      <CloseSaleSheet
        open={closeSaleOpen}
        quoteId={quote.id}
        onOpenChange={setCloseSaleOpen}
      />
    </PageContainer>
  )
}
