import { useMemo, useState } from 'react'
import { useMe } from '@/hooks/useMe'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  Plus,
  SquareArrowOutUpRight,
} from 'lucide-react'
import { WhatsAppIcon } from '@/components/icons/WhatsAppIcon'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { RowActions, type RowAction } from '@/components/data/RowActions'
import { Table, type TableColumn } from '@/components/data/Table'
import { PageContainer } from '@/components/layout/PageContainer'
import { PageToolbar } from '@/components/layout/PageToolbar'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { useClients } from '@/hooks/useClients'
import type {
  Client,
  ClientSortField,
  FindClientsQuery,
} from '@/api/clients'
import { findOrCreateConversation } from '@/api/conversations'
import { CLIENTS_QUERY_KEY } from '@/hooks/useClients'
import { displayPhone } from '@/lib/format'
import { openChatConversation } from '@/lib/chatBridge'
import { useSortState } from '@/lib/sorting'
import { cn } from '@/lib/utils'
import {
  STAGE_BADGE_CLASS,
  STAGE_LABELS,
} from '@/pages/journeys/journeyLabels'
import { ClientFormSheet } from './ClientFormSheet'
import { apiErrorText } from '@/lib/apiError'

const PAGE_SIZE = 20

type StatusFilter = 'active' | 'inactive' | 'all'

const STATUS_OPTIONS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Ativos' },
  { value: 'inactive', label: 'Inativos' },
  { value: 'all', label: 'Todos' },
]

export function ClientsPage(): React.ReactElement {
  const navigate = useNavigate()
  const [searchInput, setSearchInput] = useState('')
  const debouncedSearch = useDebouncedValue(searchInput.trim(), 300)
  const [status, setStatus] = useState<StatusFilter>('active')
  const [page, setPage] = useState(1)
  const { state: sortState, toggleSort } = useSortState<ClientSortField>()

  // Volta pra página 1 sempre que o filtro muda — caso contrário o usuário
  // pode ficar numa página vazia depois de filtrar.
  const query: FindClientsQuery = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      q: debouncedSearch || undefined,
      status,
      sortBy: sortState.sortBy ?? undefined,
      sortDir: sortState.sortDir ?? undefined,
    }),
    [page, debouncedSearch, status, sortState.sortBy, sortState.sortDir],
  )

  const { data, isLoading, isError, isFetching, refetch } = useClients(query)

  // Sheet só é usada pra criação inline. Edição moveu pra ClientDetailPage
  // (toolbar do detalhe). Mantemos editingClient como `null` no contrato
  // do sheet pra não inflar a API.
  const [sheetOpen, setSheetOpen] = useState(false)

  const openCreate = () => {
    setSheetOpen(true)
  }

  const queryClient = useQueryClient()
  // Botão de conversa em todo cliente (todos têm phone_e164) quando o chat
  // está ligado: sem contato WhatsApp ainda, o backend escolhe o canal e o
  // worker cria o contato no primeiro envio.
  const { data: me } = useMe()
  const chatEnabled = !!me?.chatEnabled

  // Cliente cujo botão de chat está criando conversation neste momento.
  // Local porque o ciclo dura ms e não justifica react-query — só queremos
  // mostrar spinner naquele botão específico e bloquear duplo-clique.
  const [openingChatFor, setOpeningChatFor] = useState<string | null>(null)

  const handleOpenChat = async (c: Client): Promise<void> => {
    if (c.conversationId) {
      openChatConversation(c.conversationId)
      return
    }
    setOpeningChatFor(c.id)
    try {
      const conv = await findOrCreateConversation({
        clientId: c.id,
        whatsappChannelId: c.whatsappChannelId ?? undefined,
      })
      // Refresca a lista pra próxima vez vir com conversationId populado.
      queryClient.invalidateQueries({ queryKey: CLIENTS_QUERY_KEY })
      openChatConversation(conv.id)
    } catch (err) {
      const message =
        apiErrorText(err)
      toast.error(message ?? 'Não foi possível abrir a conversa.')
    } finally {
      setOpeningChatFor(null)
    }
  }

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0
  const total = data?.total ?? 0

  // Listagem é só "navega pra detalhe". Edição/desativação moveram pra
  // ClientDetailPage (toolbar do detalhe) — evita duplicar mutations em
  // dois lugares e mantém o fluxo "list → detail → action" canônico.
  const rowActions = (c: Client): RowAction[] => [
    {
      label: 'Abrir detalhes',
      icon: <SquareArrowOutUpRight />,
      onClick: () => navigate(`/clients/${c.id}`),
    },
  ]

  const columns: TableColumn<Client, ClientSortField>[] = [
    {
      key: 'name',
      header: 'Nome',
      sortField: 'name',
      cell: (c) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{c.name}</span>
          {c.currentJourneyStage && (
            <span
              className={cn(
                'rounded px-1.5 py-0.5 text-xs font-medium',
                STAGE_BADGE_CLASS[c.currentJourneyStage],
              )}
            >
              {STAGE_LABELS[c.currentJourneyStage]}
            </span>
          )}
          {c.isVip && (
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
              VIP
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Telefone',
      sortField: 'phoneE164',
      className: 'text-muted-foreground',
      cell: (c) => {
        const isOpening = openingChatFor === c.id
        const enabled = chatEnabled
        return (
          <span className="inline-flex items-center gap-1.5">
            {displayPhone(c.phoneE164)}
            {chatEnabled && (
              <button
                type="button"
                onClick={(e) => {
                  // Linha da tabela pode ter onClick próprio (abrir detalhe);
                  // stopPropagation evita disparar os dois.
                  e.stopPropagation()
                  void handleOpenChat(c)
                }}
                disabled={!enabled || isOpening}
                title={
                  c.conversationId
                    ? 'Abrir conversa'
                    : 'Iniciar conversa com este contato'
                }
                className={cn(
                  'inline-flex size-6 items-center justify-center rounded text-chat-accent transition-colors',
                  enabled && !isOpening
                    ? 'hover:bg-chat-accent/10'
                    : 'cursor-not-allowed opacity-40',
                )}
                aria-label="Abrir conversa do cliente"
              >
                {isOpening ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <WhatsAppIcon className="size-4" />
                )}
              </button>
            )}
          </span>
        )
      },
    },
  ]

  const emptyText =
    debouncedSearch || status !== 'active'
      ? 'Nenhum cliente encontrado pros filtros atuais.'
      : 'Nenhum cliente ainda. Cadastre o primeiro pela toolbar.'

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
          label="Novo cliente"
          onClick={openCreate}
        />
      </PageToolbar>

      <Table<Client, ClientSortField>
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
        errorText="Erro ao carregar clientes."
        mobileCard={(c, actions) => (
          <div className="flex items-start gap-3 p-4">
            <RowActions actions={actions} className="shrink-0" />
            <div className="flex min-w-0 flex-1 items-start gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-medium">{c.name}</span>
                  {c.currentJourneyStage && (
                    <span
                      className={cn(
                        'rounded px-1.5 py-0.5 text-xs font-medium',
                        STAGE_BADGE_CLASS[c.currentJourneyStage],
                      )}
                    >
                      {STAGE_LABELS[c.currentJourneyStage]}
                    </span>
                  )}
                  {c.isVip && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                      VIP
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <span>{displayPhone(c.phoneE164)}</span>
                  {chatEnabled && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        void handleOpenChat(c)
                      }}
                      disabled={openingChatFor === c.id}
                      title={
                        c.conversationId
                          ? 'Abrir conversa'
                          : 'Iniciar conversa'
                      }
                      className={cn(
                        'inline-flex size-6 items-center justify-center rounded text-chat-accent transition-colors',
                        'hover:bg-chat-accent/10',
                        openingChatFor === c.id && 'cursor-wait',
                      )}
                      aria-label="Abrir conversa do cliente"
                    >
                      {openingChatFor === c.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <WhatsAppIcon className="size-4" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        footer={
          totalPages > 0 ? (
            <>
              <div className="text-muted-foreground">
                {total} {total === 1 ? 'cliente' : 'clientes'}
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

      <ClientFormSheet
        open={sheetOpen}
        client={null}
        onOpenChange={setSheetOpen}
      />
    </PageContainer>
  )
}
