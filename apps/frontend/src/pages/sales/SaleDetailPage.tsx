import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { AlertTriangle, ArrowLeft, Check, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { Table, type TableColumn } from '@/components/data/Table'
import { useClient } from '@/hooks/useClients'
import { useProcedures } from '@/hooks/useProcedures'
import { useMarkPaymentPaid, useSale } from '@/hooks/useSales'
import type { Payment, SaleItem } from '@/api/sales'
import { displayIsoDate, displayMoney, displayRelativeTime } from '@/lib/format'
import { ClientLabel } from '@/pages/journeys/ClientLabel'
import { SaleContractsSection } from '@/pages/contracts/SaleContractsSection'
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_BADGE_CLASS,
  PAYMENT_STATUS_LABELS,
  SALE_STATUS_BADGE_CLASS,
  SALE_STATUS_LABELS,
} from './saleLabels'
import { apiErrorText } from '@/lib/apiError'

const isOverdue = (p: Payment): boolean => {
  if (p.status !== 'pending') return false
  // due_date YYYY-MM-DD comparada com hoje em local time.
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${(today.getMonth() + 1)
    .toString()
    .padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`
  return p.dueDate < todayIso
}

export function SaleDetailPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const saleQuery = useSale(id)
  const procedures = useProcedures({ page: 1, pageSize: 100, status: 'all' })
  const markPaidMutation = useMarkPaymentPaid()
  const [busyPaymentId, setBusyPaymentId] = useState<string | null>(null)
  // Cliente é fetched separadamente — `useSale` traz só `clientId`, e a
  // SaleContractsSection precisa do nome pra header do sheet de envio.
  const clientQuery = useClient(saleQuery.data?.sale.clientId)

  const procedureName = useMemo(() => {
    return (procedureId: string): string => {
      const p = procedures.data?.items.find((p) => p.id === procedureId)
      return p?.name ?? procedureId.slice(0, 8) + '…'
    }
  }, [procedures.data])

  if (saleQuery.isLoading) {
    return (
      <PageContainer>
        <div className="flex h-full items-center justify-center text-muted-foreground">
          Carregando venda…
        </div>
      </PageContainer>
    )
  }

  if (saleQuery.isError || !saleQuery.data) {
    return (
      <PageContainer>
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
          <p>Erro ao carregar venda.</p>
          <Button variant="outline" size="sm" onClick={() => navigate('/sales')}>
            Voltar
          </Button>
        </div>
      </PageContainer>
    )
  }

  const { sale, items, payments } = saleQuery.data

  const pendingTotal = payments
    .filter((p) => p.status === 'pending')
    .reduce((sum, p) => sum + Number(p.amount), 0)

  const overdueCount = payments.filter(isOverdue).length

  const handleMarkPaid = async (payment: Payment) => {
    setBusyPaymentId(payment.id)
    try {
      await markPaidMutation.mutateAsync({
        saleId: sale.id,
        paymentId: payment.id,
      })
      toast.success(`Parcela ${payment.installmentNumber} marcada como paga`)
    } catch (err) {
      const message = apiErrorText(err)
      toast.error(message ?? 'Erro ao registrar pagamento')
    } finally {
      setBusyPaymentId(null)
    }
  }

  const itemColumns: TableColumn<SaleItem, never>[] = [
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
      cell: (it) => displayMoney(it.computedAmount),
    },
  ]

  const paymentColumns: TableColumn<Payment, never>[] = [
    {
      key: 'installment',
      header: 'Parcela',
      cell: (p) => (
        <span className="tabular-nums">
          {p.installmentNumber}/{p.totalInstallments}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Valor',
      className: 'text-right tabular-nums',
      cell: (p) => displayMoney(p.amount),
    },
    {
      key: 'method',
      header: 'Método',
      className: 'text-muted-foreground',
      cell: (p) => PAYMENT_METHOD_LABELS[p.paymentMethod],
    },
    {
      key: 'dueDate',
      header: 'Vencimento',
      cell: (p) => (
        <div className="flex flex-col">
          <span>{displayIsoDate(p.dueDate)}</span>
          {isOverdue(p) && (
            <span className="inline-flex items-center gap-1 text-xs text-error">
              <AlertTriangle className="h-3 w-3" />
              vencida
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'paidAt',
      header: 'Recebida',
      className: 'text-muted-foreground',
      cell: (p) => (p.paidAt ? displayRelativeTime(p.paidAt) : '—'),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (p) => (
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-medium ${PAYMENT_STATUS_BADGE_CLASS[p.status]}`}
        >
          {PAYMENT_STATUS_LABELS[p.status]}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'w-32 text-right',
      cell: (p) =>
        p.status === 'pending' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleMarkPaid(p)}
            disabled={busyPaymentId === p.id}
          >
            <Check className="mr-1 h-4 w-4" />
            {busyPaymentId === p.id ? 'Salvando…' : 'Marcar paga'}
          </Button>
        ) : null,
    },
  ]

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
      </PageToolbar>

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {/* Identificação — cliente + status + parcelas vencidas + links + fechamento */}
        <section className="flex flex-col gap-2 rounded-md border bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <ClientLabel clientId={sale.clientId} showPhone />
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-medium ${SALE_STATUS_BADGE_CLASS[sale.status]}`}
                >
                  {SALE_STATUS_LABELS[sale.status]}
                </span>
                {overdueCount > 0 && (
                  <span className="inline-flex items-center gap-1 rounded bg-error/15 px-1.5 py-0.5 text-xs font-medium text-error">
                    <AlertTriangle className="h-3 w-3" />
                    {overdueCount} parcela{overdueCount === 1 ? '' : 's'} vencida{overdueCount === 1 ? '' : 's'}
                  </span>
                )}
                <Link
                  to={`/quotes/${sale.quoteId}`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Ver orçamento
                </Link>
                <Link
                  to={`/journeys/${sale.journeyId}`}
                  className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Ver jornada
                </Link>
              </div>
            </div>
            <div className="shrink-0 text-xs text-muted-foreground">
              Fechada {displayRelativeTime(sale.closedAt)}
            </div>
          </div>
        </section>

        {/* Resumo financeiro */}
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          <div className="flex flex-col gap-0.5 rounded-md border bg-background p-3">
            <span className="text-xs text-muted-foreground">Subtotal</span>
            <span className="tabular-nums text-base font-medium">
              {displayMoney(sale.subtotalAmount)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border bg-background p-3">
            <span className="text-xs text-muted-foreground">Desconto</span>
            <span className="tabular-nums text-base font-medium">
              − {displayMoney(sale.discountAmount)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border bg-background p-3">
            <span className="text-xs text-muted-foreground">Recebido</span>
            <span className="tabular-nums text-base font-medium text-success">
              {displayMoney(sale.paidAmount)}
            </span>
          </div>
          <div className="flex flex-col gap-0.5 rounded-md border bg-background p-3">
            <span className="text-xs text-muted-foreground">A receber</span>
            <span className="tabular-nums text-base font-semibold">
              {displayMoney(pendingTotal)}
            </span>
          </div>
        </div>

        {/* Itens */}
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-sm font-semibold">Itens da venda</h2>
          <Table<SaleItem, never>
            columns={itemColumns}
            data={items}
            rowKey={(it) => it.id}
            emptyText="Sem itens."
          />
        </div>

        {/* Parcelas */}
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="text-sm font-semibold">Parcelas</h2>
          <Table<Payment, never>
            columns={paymentColumns}
            data={payments}
            rowKey={(p) => p.id}
            emptyText="Sem parcelas."
          />
        </div>

        {/* Contratos da venda (Fase 7) */}
        <SaleContractsSection
          saleId={sale.id}
          clientId={sale.clientId}
          clientName={clientQuery.data?.name ?? ''}
          journeyId={sale.journeyId}
          procedureIds={items.map((it) => it.procedureId)}
        />

        {sale.notes && (
          <div className="rounded-md border bg-background p-3">
            <h3 className="mb-1 text-sm font-semibold">Observações</h3>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
              {sale.notes}
            </p>
          </div>
        )}
      </div>
    </PageContainer>
  )
}
