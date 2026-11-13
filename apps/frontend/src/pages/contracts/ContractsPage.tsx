import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Ban,
  Download,
  ExternalLink,
  RefreshCcw,
  SquareArrowOutUpRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { RowActions, type RowAction } from '@/components/data/RowActions'
import { Table, type TableColumn } from '@/components/data/Table'
import { useConfirm } from '@/components/ui/confirm-context'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import {
  useCancelContract,
  useContracts,
  useCopyContractLink,
} from '@/hooks/useContracts'
import {
  CONTRACT_KIND_LABELS,
  CONTRACT_STATUS_COLOR_CLASS,
  CONTRACT_STATUS_LABELS,
  contractSignedPdfUrl,
  type Contract,
  type ContractSortField,
  type ContractStatus,
  type FindContractsQuery,
} from '@/api/contracts'
import { displayDateTime, displayPhone } from '@/lib/format'
import { useSortState } from '@/lib/sorting'
import { cn } from '@/lib/utils'
import { apiErrorText } from '@/lib/apiError'

const PAGE_SIZE = 20

type StatusFilter = 'pending' | 'signed' | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'pending', label: 'Pendentes' },
  { value: 'signed', label: 'Assinados' },
  { value: 'all', label: 'Todos' },
]

// Status que permitem ações de "reenviar" e "cancelar".
const RESENDABLE: Array<ContractStatus> = ['sent', 'viewed']
const CANCELLABLE: Array<ContractStatus> = ['draft', 'sent', 'viewed']

export function ContractsPage(): React.ReactElement {
  const navigate = useNavigate()
  const confirm = useConfirm()
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending')
  const [page, setPage] = useState(1)
  const { state: sortState, toggleSort } = useSortState<ContractSortField>()

  const query: FindContractsQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      pendingOnly: statusFilter === 'pending' || undefined,
      status: statusFilter === 'signed' ? 'signed' : undefined,
      sortBy: sortState.sortBy ?? undefined,
      sortDir: sortState.sortDir ?? undefined,
    }),
    [page, statusFilter, sortState.sortBy, sortState.sortDir],
  )

  const { data, isLoading, isError, isFetching, refetch } = useContracts(query)
  const copyLink = useCopyContractLink()
  const cancel = useCancelContract()

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const handleCopyLink = async (c: Contract) => {
    try {
      const updated = await copyLink.mutateAsync(c.id)
      if (updated.signUrl) {
        await navigator.clipboard.writeText(updated.signUrl)
        toast.success('Link copiado pra área de transferência')
      } else {
        toast.success('Contrato pronto')
      }
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  const handleCancel = async (c: Contract) => {
    const ok = await confirm({
      title: `Cancelar o contrato "${c.title}"?`,
      confirmLabel: 'Cancelar contrato',
      variant: 'destructive',
    })
    if (!ok) return
    try {
      await cancel.mutateAsync(c.id)
      toast.success('Contrato cancelado')
    } catch (err) {
      toast.error(extractErrorMessage(err))
    }
  }

  const rowActions = (c: Contract): RowAction[] => {
    const actions: RowAction[] = [
      {
        label: 'Abrir cliente',
        icon: <SquareArrowOutUpRight />,
        onClick: () => navigate(`/clients/${c.clientId}`),
      },
    ]
    if (c.signUrl && RESENDABLE.includes(c.status)) {
      actions.push({
        label: 'Abrir link de assinatura',
        icon: <ExternalLink />,
        onClick: () => window.open(c.signUrl as string, '_blank'),
      })
      actions.push({
        label: 'Copiar link de assinatura',
        icon: <RefreshCcw />,
        onClick: () => void handleCopyLink(c),
      })
    }
    if (c.status === 'signed') {
      actions.push({
        label: 'Baixar PDF assinado',
        icon: <Download />,
        onClick: () => window.open(contractSignedPdfUrl(c.id), '_blank'),
      })
    }
    if (CANCELLABLE.includes(c.status)) {
      actions.push({
        label: 'Cancelar contrato',
        icon: <Ban />,
        onClick: () => void handleCancel(c),
        destructive: true,
      })
    }
    return actions
  }

  const columns: TableColumn<Contract, ContractSortField>[] = [
    {
      key: 'title',
      header: 'Contrato',
      sortField: 'title',
      cell: (c) => (
        <div className="flex flex-col">
          <span className="font-medium">{c.title}</span>
          <span className="text-xs text-muted-foreground">
            {CONTRACT_KIND_LABELS[c.kind]}
          </span>
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Cliente',
      cell: (c) => (
        <div className="flex flex-col">
          <span>{c.client.name}</span>
          <span className="text-xs text-muted-foreground">
            {displayPhone(c.client.phoneE164)}
          </span>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortField: 'status',
      cell: (c) => (
        <span
          className={cn(
            'inline-block rounded px-1.5 py-0.5 text-xs font-medium',
            CONTRACT_STATUS_COLOR_CLASS[c.status],
          )}
        >
          {CONTRACT_STATUS_LABELS[c.status]}
        </span>
      ),
    },
    {
      key: 'sentAt',
      header: 'Enviado',
      sortField: 'sentAt',
      className: 'text-muted-foreground',
      cell: (c) => displayDateTime(c.sentAt),
    },
    {
      key: 'signedAt',
      header: 'Assinado',
      sortField: 'signedAt',
      className: 'text-muted-foreground',
      cell: (c) => displayDateTime(c.signedAt) || '—',
    },
  ]

  const emptyText =
    statusFilter === 'pending'
      ? 'Nenhum contrato pendente de assinatura.'
      : statusFilter === 'signed'
        ? 'Nenhum contrato assinado ainda.'
        : 'Nenhum contrato criado ainda. Envie pelo detalhe do cliente.'

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Filter label="Status" minWidth={260}>
          <ButtonGroup
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v)
              setPage(1)
            }}
            options={STATUS_OPTIONS}
            aria-label="Filtrar por status"
          />
        </PageToolbar.Filter>
      </PageToolbar>

      <Table<Contract, ContractSortField>
        columns={columns}
        data={items}
        rowKey={(c) => c.id}
        actions={rowActions}
        sortField={sortState.sortBy}
        sortDir={sortState.sortDir}
        onSort={toggleSort}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar contratos."
        mobileCard={(c, actions) => (
          <div className="flex items-start gap-3 p-4">
            <RowActions actions={actions} className="shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{c.title}</span>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-xs font-medium',
                    CONTRACT_STATUS_COLOR_CLASS[c.status],
                  )}
                >
                  {CONTRACT_STATUS_LABELS[c.status]}
                </span>
              </div>
              <span className="text-sm text-muted-foreground">
                {c.client.name} · {displayPhone(c.client.phoneE164)}
              </span>
              <span className="text-xs text-muted-foreground">
                Enviado {displayDateTime(c.sentAt) || '—'}
              </span>
            </div>
          </div>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'contrato' : 'contratos'}
                {isFetching ? ' • atualizando…' : ''}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                >
                  Anterior
                </Button>
                <span className="text-muted-foreground">
                  Página {page} de {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= totalPages}
                >
                  Próxima
                </Button>
              </div>
            </>
          ) : null
        }
      />
    </PageContainer>
  )
}

function extractErrorMessage(err: unknown): string {
  const msg = apiErrorText(err)
  if (msg) return msg
  if (err instanceof Error) return err.message
  return 'Erro inesperado'
}
