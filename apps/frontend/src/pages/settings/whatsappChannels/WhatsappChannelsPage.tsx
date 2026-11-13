import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, SquareArrowOutUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { RowActions, type RowAction } from '@/components/data/RowActions'
import { Table, type TableColumn } from '@/components/data/Table'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useWhatsappChannels } from '@/hooks/useWhatsappChannels'
import type {
  FindChannelsQuery,
  WhatsappChannel,
} from '@/api/whatsappChannels'
import { displayPhone } from '@/lib/format'
import { WhatsappChannelFormSheet } from './WhatsappChannelFormSheet'
import {
  ActiveBadge,
  ColorSwatch,
  ConnectionBadge,
  ProviderBadge,
  ProvisionBadge,
} from './whatsappChannelBadges'

const PAGE_SIZE = 20

type StatusFilter = 'active' | 'inactive' | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
]

export function WhatsappChannelsPage(): React.ReactElement {
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)

  const query: FindChannelsQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedSearch || undefined,
      status,
    }),
    [page, debouncedSearch, status],
  )

  const { data, isLoading, isError, isFetching, refetch } =
    useWhatsappChannels(query)

  // Sheet só pra criação inline. Edição, gerenciamento de conexão e
  // ativar/desativar moveram pra WhatsappChannelDetailPage — listagem é
  // só "navega pra detalhe", mesmo pattern do ClientsPage.
  const [createOpen, setCreateOpen] = useState(false)

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  const rowActions = (c: WhatsappChannel): RowAction[] => [
    {
      label: 'Abrir detalhes',
      icon: <SquareArrowOutUpRight />,
      onClick: () => navigate(`/settings/whatsapp-channels/${c.id}`),
    },
  ]

  const columns: TableColumn<WhatsappChannel>[] = [
    {
      key: 'name',
      header: 'Nome',
      cell: (c) => (
        <div className="flex items-center gap-2">
          <ColorSwatch color={c.color} />
          <span className="font-medium">{c.name}</span>
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Telefone',
      className: 'text-muted-foreground',
      cell: (c) => (c.phoneNumber ? displayPhone(c.phoneNumber) : '—'),
    },
    {
      key: 'provider',
      header: 'Tipo',
      cell: (c) => <ProviderBadge channel={c} />,
    },
    {
      key: 'provision',
      header: 'Estado',
      cell: (c) => <ProvisionBadge channel={c} />,
    },
    {
      key: 'connection',
      header: 'Conexão',
      cell: (c) => <ConnectionBadge channel={c} />,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => <ActiveBadge active={c.active} />,
    },
  ]

  const emptyText =
    debouncedSearch || status !== 'active'
      ? 'Nenhum canal encontrado pros filtros atuais.'
      : 'Nenhum canal ainda. Crie o primeiro pela toolbar.'

  return (
    <PageContainer>
      <PageToolbar>
        <PageToolbar.Search
          value={searchInput}
          onChange={(v) => {
            setSearchInput(v)
            setPage(1)
          }}
          placeholder="Buscar por nome ou telefone"
        />
        <PageToolbar.Filter label="Status" minWidth={260}>
          <ButtonGroup
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            options={STATUS_OPTIONS}
            aria-label="Filtrar por status"
          />
        </PageToolbar.Filter>
        <PageToolbar.Action
          icon={<Plus />}
          label="Novo canal"
          onClick={() => setCreateOpen(true)}
        />
      </PageToolbar>

      <Table<WhatsappChannel>
        columns={columns}
        data={items}
        rowKey={(c) => c.id}
        actions={rowActions}
        isLoading={isLoading}
        isError={isError}
        onRetry={() => refetch()}
        emptyText={emptyText}
        errorText="Erro ao carregar canais."
        mobileCard={(c, actions) => (
          <div className="flex items-start gap-3 p-4">
            <RowActions actions={actions} className="shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <ColorSwatch color={c.color} />
                  <span className="truncate font-medium">{c.name}</span>
                </div>
                <ActiveBadge active={c.active} />
              </div>
              <div className="text-sm text-muted-foreground">
                {c.phoneNumber ? displayPhone(c.phoneNumber) : '—'}
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <ProviderBadge channel={c} />
                <ProvisionBadge channel={c} />
                <ConnectionBadge channel={c} />
              </div>
            </div>
          </div>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'canal' : 'canais'}
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

      <WhatsappChannelFormSheet
        open={createOpen}
        channel={null}
        onOpenChange={setCreateOpen}
      />
    </PageContainer>
  )
}
