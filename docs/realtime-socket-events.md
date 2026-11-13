# Eventos Realtime (Socket.IO + Redis pub/sub)

> Inventário único dos eventos que viajam por pub/sub no Elora. Toda vez que adicionar/remover/renomear evento, ou mudar publisher/consumer, atualizar aqui no mesmo PR. Doc-de-decisão arquitetural fica em [arquitetura.md §13.5](./arquitetura.md).

## Topologia em 1 parágrafo

`apps/chat` e `apps/core` publicam em canais Redis nomeados (`@elora/events-contracts` define os nomes — `wa.message.received`, `lead.created`, etc). Um subscriber dedicado no `apps/core` ([redisSubscriber.ts](../apps/core/src/shared/realtime/redisSubscriber.ts)) escuta esses canais e repassa pra sala socket.io apropriada (`tenant:{id}` pros eventos de clínica, `tenant:{id}:chat` pros de chat). O frontend mantém **uma única conexão** com o `apps/core` ([useChatRealtime.ts](../apps/frontend/src/hooks/useChatRealtime.ts), montado via `<ChatRealtimeBoot>` no `app/App.tsx`) e invalida queries TanStack conforme cada evento chega. **Apps nunca emitem socket direto** — sempre via pub/sub, pra que adicionar uma 2ª instância do core não precise de sticky session.

## Catálogo de eventos

Cada evento tem 5 facetas: **canal Redis** (string canônica), **publisher** (quem chama `eventBus.publish`), **payload**, **sala socket.io de destino**, **consumer no frontend** (handler + query invalidations).

### `wa.message.received`

| Faceta | Valor |
|---|---|
| **Publisher** | [`apps/chat/.../inboundNormalizer/pipeline.ts:246`](../apps/chat/src/shared/workers/inboundNormalizer/pipeline.ts), [pipeline.ts:541](../apps/chat/src/shared/workers/inboundNormalizer/pipeline.ts) (variação edit/forward) |
| **Quando dispara** | Mensagem inbound do WhatsApp foi normalizada e persistida em `messages`. Inclui novos contatos, mensagens em conversas existentes, primeiro contato (que cria journey lead). |
| **Payload** | `WhatsappMessageReceivedEvent` ([events-contracts/src/index.ts:44](../packages/events-contracts/src/index.ts)) — `tenantId`, `channelId`, `conversationId`, `messageId`, `clientId`, etc. |
| **Salas** | `tenant:{tenantId}:chat` (quem tem `chat:use`) |
| **Consumer** | `onMessageReceived` em [useChatRealtime.ts:145](../apps/frontend/src/hooks/useChatRealtime.ts). Invalida `['conversations']`, `['conversation', id, 'messages']`, **`['leads']`** (substage pode mudar — inbound `template→contact`, ou cria novo lead via pipeline). Incrementa `totalUnread`, toast/abre flutuante conforme `chatNotificationLevel`. |

### `wa.message.sent`

| Faceta | Valor |
|---|---|
| **Publisher** | [`pipeline.ts`](../apps/chat/src/shared/workers/inboundNormalizer/pipeline.ts) do inbound normalizer (echo do webhook quando staff manda pelo celular pareado) e [`outboundDelivery/pipeline.ts`](../apps/chat/src/shared/workers/outboundDelivery/pipeline.ts) (`OutboundDeliveryWorker` quando confirma `delivery_status='sent'`). **Mudou em 2026-05-26**: antes era publicado direto pelo `MessagesService.sendOutbound` no controller HTTP; agora vem do worker pós-adapter. |
| **Quando dispara** | Outbound foi confirmada como enviada (status='sent') — qualquer fonte: UI Elora (via worker), celular pareado (via pipeline inbound), automação futura. |
| **Payload** | `WhatsappMessageSentEvent` — mesmo formato do received + `authorUserId` (null se foi do celular pareado), `authoredOnDevice`. |
| **Salas** | `tenant:{tenantId}:chat` (quem tem `chat:use`) |
| **Consumer** | `onMessageSent` em [useChatRealtime.ts](../apps/frontend/src/hooks/useChatRealtime.ts). Invalida `['conversations']`, `['conversation', id, 'messages']`, **`['leads']`** (substage pode mudar — outbound `new→template`, ou recompute em cadeia). Sem toast (a equipe que mandou — não tem novidade). |
| **⚠ Coexistência** | Pra outbound da UI, este evento é emitido junto com `wa.message.status_changed (status=sent)` — ambos resultam em invalidate da mesma queryKey, idempotente. Listeners de cascata (journey activity, lead_substage) continuam escutando este por compat; UI da bolha escuta o `status_changed` (cobre também `failed/rejected`). |

### `wa.message.revoked`

| Faceta | Valor |
|---|---|
| **Publisher** | [`MessagesService.ts:691`](../apps/chat/src/modules/messages/MessagesService.ts) (staff aciona `DELETE /messages/:id`) e [`MessagesService.ts:756`](../apps/chat/src/modules/messages/MessagesService.ts) (cliente apaga no app, capturado pelo pipeline). |
| **Quando dispara** | Mensagem foi soft-deleted (`deleted_at IS NOT NULL` + `deletion_origin` setado). |
| **Payload** | `WhatsappMessageRevokedEvent` — `conversationId`, `messageId`, `origin: 'staff' \| 'client' \| 'system'`, `deletedAt`. |
| **Salas** | `tenant:{tenantId}:chat` (quem tem `chat:use`) |
| **Consumer** | `onMessageRevoked` em [useChatRealtime.ts:233](../apps/frontend/src/hooks/useChatRealtime.ts). Invalida `['conversation', conversationId, 'messages']` e `['conversations']` (preview de última mensagem). |

### `wa.status.updated`

| Faceta | Valor |
|---|---|
| **Publisher** | [`pipeline.ts:437`](../apps/chat/src/shared/workers/inboundNormalizer/pipeline.ts) — webhook `messages.update` informa novo status (`sent` → `delivered` → `read`). |
| **Quando dispara** | Status de outbound mudou no provider. |
| **Payload** | `WhatsappStatusUpdatedEvent` — `conversationId`, `whatsappMessageId`, `externalId`, `status`. Só é publicado quando a mensagem tem bolha domain (sem ela não há conversa pra rotear). |
| **Salas** | `tenant:{tenantId}:chat` (quem tem `chat:use`) |
| **Consumer** | `onStatusUpdated` em [useChatRealtime.ts](../apps/frontend/src/hooks/useChatRealtime.ts). Invalida `['conversation', conversationId, 'messages']` — tiques de entregue/lido ao vivo. |

### `wa.channel.connection_changed`

| Faceta | Valor |
|---|---|
| **Publisher** | [`pipeline.ts:131`](../apps/chat/src/shared/workers/inboundNormalizer/pipeline.ts) — `connection.update` muda `whatsapp_channels.connection_state` (open/connecting/closed/unknown). Dedup feito no chat (UPDATE só dispara em mudança real). |
| **Quando dispara** | Estado da conexão de um canal WhatsApp mudou. |
| **Payload** | `WhatsappChannelConnectionChangedEvent` — `channelId`, `state`, `changedAt`. |
| **Salas** | `tenant:{tenantId}:chat` (quem tem `chat:use`) |
| **Consumer** | `onChannelConnectionChanged` em [useChatRealtime.ts:223](../apps/frontend/src/hooks/useChatRealtime.ts). Invalida `['whatsappChannels']` — UI atualiza badge de conexão sem polling. |

### `lead.created`

| Faceta | Valor |
|---|---|
| **Publisher** | [`createExternalLead.ts:141`](../apps/core/src/shared/leads/createExternalLead.ts) — helper centralizado pra criação de lead via canal **não-WhatsApp** (manual UI, form, sheets, recycling, imported, other). Publish depois do commit. |
| **Quando dispara** | `POST /leads` (criação manual), `POST /leads/:id/recycle`, e qualquer sync futuro (form/sheets/imported) que passe pelo helper. WhatsApp **não** emite — o pipeline inbound já dispara `wa.message.received` que cobre. |
| **Payload** | `LeadCreatedEvent` ([events-contracts/src/index.ts:107](../packages/events-contracts/src/index.ts)) — `journeyId`, `clientId`, `clientName`, `source`, `createdAt`. |
| **Salas** | `tenant:{tenantId}` (toda a equipe vê o badge + board atualizar) |
| **Consumer** | `onLeadCreated` em [useChatRealtime.ts:247](../apps/frontend/src/hooks/useChatRealtime.ts). Invalida `['leads']`. Toast condicional: `manual` e `imported` silenciam (já vêm de ação local ou batch); `form`/`sheets`/`recycling`/`other` exibem toast se `chatNotificationLevel ≠ 'quiet'`. |

### `message.created`

| Faceta | Valor |
|---|---|
| **Publisher** | [`MessagesService.enqueueOutbound`](../apps/chat/src/modules/messages/MessagesService.ts) — depois do INSERT em `messages` com `delivery_status='pending'`, antes de enfileirar o job BullMQ. |
| **Quando dispara** | Bolha outbound recém-inserida pelo backend, ainda em estado `pending` (worker outbound ainda não processou). Só outbound da UI (controller HTTP) — caminhos `createInbound`/`createOutboundExternal`/`createCallMessage`/`postInternalNote` persistem direto como `sent` e usam `wa.message.received`/`wa.message.sent`. |
| **Payload** | `MessageCreatedEvent` ([events-contracts/src/index.ts](../packages/events-contracts/src/index.ts)) — `tenantId`, `channelId`, `conversationId`, `messageId`, `clientId`, `authorUserId`, `createdAt`. |
| **Salas** | `tenant:{tenantId}:chat` (quem tem `chat:use`) |
| **Consumer** | `onMessageCreated` em [useChatRealtime.ts](../apps/frontend/src/hooks/useChatRealtime.ts). Invalida `['conversations']` + `['conversation', id, 'messages']`. **A sessão que disparou o POST já recebeu a row via HTTP response (`onSuccess` do `useSendMessage` injeta via `setQueriesData`); este evento existe pra OUTRAS abas/devices vejam a bolha pending aparecer em tempo real.** Sem toast/badge — é mensagem da própria equipe. |

### `wa.message.status_changed`

| Faceta | Valor |
|---|---|
| **Publisher** | [`outboundDelivery/pipeline.ts`](../apps/chat/src/shared/workers/outboundDelivery/pipeline.ts) — `OutboundDeliveryWorker` quando a transição terminal acontece (`pending → sent | failed | rejected`). Também publicado pelo [`reconciler.ts`](../apps/chat/src/shared/workers/outboundDelivery/reconciler.ts) quando `pending` stuck vira `failed/worker_timeout`. |
| **Quando dispara** | Toda mudança de `delivery_status` de uma mensagem outbound. Em sucesso, é emitido junto com `wa.message.sent` (compat). Em falha, só este. |
| **Payload** | `WhatsappMessageStatusChangedEvent` — `tenantId`, `channelId`, `conversationId`, `messageId`, `deliveryStatus` (`pending` \| `sent` \| `failed` \| `rejected`), `failureReason` (enum ou null), `updatedAt`. `failureDetail` fica fora do payload — UI busca via HTTP se quiser exibir detalhe rico. |
| **Salas** | `tenant:{tenantId}:chat` (quem tem `chat:use`) |
| **Consumer** | `onMessageStatusChanged` em [useChatRealtime.ts](../apps/frontend/src/hooks/useChatRealtime.ts). Invalida `['conversations']` + `['conversation', id, 'messages']`. Em `status='sent'` também invalida `['leads']` (cascata de stage — outbound conta como atividade). Sem toast em falha — o motivo já fica visível na própria bolha laranja/vermelha (`MessageBubble` mapeia `failure_reason` pra label PT-BR + cor de fundo). |

### `procedure_session_attendance.recorded`

| Faceta | Valor |
|---|---|
| **Publisher** | [`AttendanceService.sign`](../apps/core/src/modules/procedureSessionAttendances/AttendanceService.ts) — depois do commit que cria `attendance_record`, vincula sessões, marca `procedure_sessions` como `signed` e `appointments` como `attended`, e consome o token. |
| **Quando dispara** | Cliente terminou de assinar a presença no link público (`POST /public/session-attendance/:token/sign`). Uma assinatura pode cobrir N sessões do mesmo dia — o evento carrega todas em `signedSessionIds`. |
| **Payload** | `ProcedureSessionAttendanceRecordedEvent` ([events-contracts/src/index.ts](../packages/events-contracts/src/index.ts)) — `tenantId`, `attendanceId`, `clientId`, `attendanceDate`, `signedSessionIds: string[]`, `signedAt`. **Sem foto/SVG no payload** (objetos do MinIO/R2 ficam no `attendance_record`; UI puxa via `GET /appointments/:id/attendance`). |
| **Salas** | `tenant:{tenantId}` (qualquer aba da agenda interessa — operadora, recepção, aplicadora) |
| **Consumer** | `onAttendanceRecorded` em [useChatRealtime.ts](../apps/frontend/src/hooks/useChatRealtime.ts). Invalida `['appointments']`, `['procedureSessions']`, `['treatments']`. Toast `Presença confirmada por assinatura` (singular) ou `Presença confirmada (N sessões)` (quando cobre múltiplas), só quando `chatNotificationLevel ≠ 'quiet'`. |

### `procedure_session.evolved`

| Faceta | Valor |
|---|---|
| **Publisher** | [`ProcedureSessionsService.evolve`](../apps/core/src/modules/procedureSessions/ProcedureSessionsService.ts) — depois do commit que atualiza `evolution_notes`, marca a sessão como `done` e roda `checkAndAutoCompleteTreatment`. |
| **Quando dispara** | Aplicadora encerrou a evolução clínica da sessão (`signed → done`) via `POST /procedure-sessions/:id/evolve`. Override admin `/done` (legacy) **não** emite — uso restrito a correção, sem cascata de notificação. |
| **Payload** | `ProcedureSessionEvolvedEvent` ([events-contracts/src/index.ts](../packages/events-contracts/src/index.ts)) — `tenantId`, `sessionId`, `clientId`, `evolvedAt`, `evolvedByUserId`, `treatmentCompleted: boolean`. Sem snapshot da nota: payload leve, UI re-fetcha por HTTP quando precisa exibir. |
| **Salas** | `tenant:{tenantId}` (qualquer aba — outros aplicadores na /evolutions repintam a sessão; ClientDetailPage refresha a SessionRow; agenda fecha a janela "Aguardando evolução"). |
| **Consumer** | `onSessionEvolved` em [useChatRealtime.ts](../apps/frontend/src/hooks/useChatRealtime.ts). Invalida `['procedureSessions']`, `['treatments']`, `['journeys']`, `['appointments']`. Toast `Tratamento concluído` **só quando** `treatmentCompleted=true` (evolução individual é ruído pra quem não tá na sessão; quem evoluiu já viu o toast local da mutation). Gated por `chatNotificationLevel ≠ 'quiet'`. |

## Salas socket.io

Definidas em [SOCKET_ROOMS](../packages/events-contracts/src/index.ts):

- **`tenant:{tenantId}`** — todo socket autenticado do tenant. Eventos de clínica (lead criado, contrato, presença, evolução).
- **`tenant:{tenantId}:chat`** — sockets de usuários com `chat:use` (roles carregados no handshake). Todos os eventos de chat (mensagens, status, revogação, estado do canal, tags). Mudança de grupo vale na próxima conexão.

Não há sala por conversa nem `subscribe:conversation` (removidos em 2026-11 — o frontend nunca usava): o cliente não escolhe sala, então conhecer o UUID de uma conversa não dá acesso aos eventos dela.

**Isolamento entre tenants vira impossível por construção.** Auth do socket valida o JWT no handshake e o socket só consegue subscrever salas do próprio `tenantId` (resolvido no handshake, não vindo do input do cliente). Publisher só emite com `tenantId` do payload do evento. Sem `tenant:` prefix = bug de segurança.

## Onde o frontend escuta

[`useChatRealtime`](../apps/frontend/src/hooks/useChatRealtime.ts) — hook montado uma única vez via `<ChatRealtimeBoot>` em `app/App.tsx`. Mantém o socket vivo enquanto há usuário autenticado; logout chama `disconnectSocket()` + reseta `chatStore`.

Cada handler invalida queries TanStack (chave raiz, deixa o `staleTime` de cada `useQuery` decidir se refaz a request). Vantagem: caches independentes ficam consistentes em todas as abas/devices logados no mesmo tenant sem polling.

## Gaps conhecidos — mudanças que NÃO disparam socket nos leads

A maioria das mutations no domínio de lead **só atualiza na aba que disparou** (React Query local invalidate via `useMutation > onSuccess`). Outras abas/devices ficam stale até refresh manual ou até receber inbound/outbound que invalida `['leads']`.

| Operação | Onde mexe no board | Hoje |
|---|---|---|
| Quote enviada ([QuotesService.ts:336](../apps/core/src/modules/quotes/QuotesService.ts)) | substage → `quoted` | sem evento |
| Quote aceita / `closeSale` ([QuotesService.ts:410](../apps/core/src/modules/quotes/QuotesService.ts)) | sai do board (stage `lead`→`sale`) | sem evento |
| Quote rejeitada / expirada ([QuotesService.ts:461,495](../apps/core/src/modules/quotes/QuotesService.ts)) | volta substage; auto-lost se for a última via `autoLostIfAllQuotesClosed` | sem evento |
| Appointment kind=evaluation criado ([AppointmentsService.ts:143](../apps/core/src/modules/appointments/AppointmentsService.ts)) | substage → `scheduled` | sem evento |
| Appointment editado / no_show ([AppointmentsService.ts:262,417,447](../apps/core/src/modules/appointments/AppointmentsService.ts)) | `scheduled` ↔ `no_show` ↔ `rescheduled` | sem evento |
| Appointment atendido (override admin) ([AppointmentsService.ts:355](../apps/core/src/modules/appointments/AppointmentsService.ts)) | sai do board (stage `lead`→`evaluation`) | sem evento. Atendimento via assinatura pública (kind=procedure) já dispara `procedure_session_attendance.recorded` — esta linha cobre só o `attend()` admin |
| Mark lost (`POST /leads/:id/mark-lost`, `/journeys/:id/lost`) | sai do board (`status='lost'`) | sem evento |
| Mark won (`POST /journeys/:id/won`) | sai do board (`status='won'`) | sem evento |
| Override de substage (`PUT /leads/:id/substage`) | substage muda | sem evento |
| Recompute manual (`POST /leads/:id/recompute-substage`) | substage pode mudar | sem evento |

### Proposta de fechamento — um único evento `journey.changed`

Em vez de N eventos novos, um evento genérico cobre todos os casos:

```ts
interface JourneyChangedEvent {
  tenantId: string;
  journeyId: string;
  stage?: 'lead' | 'evaluation' | 'sale' | 'treatment' | 'result';
  status?: 'active' | 'won' | 'lost';
  leadSubstage?: LeadSubstage | null;
}
```

Publish points sugeridos:
- Final de `recomputeLeadSubstage` quando retorno ≠ `null` (substage mudou de fato).
- Final de `setLeadSubstageManual`.
- Final de `markJourneyLost`, `markJourneyWon`.
- Final de `applyStageTransition`.

Sala: `tenant:{tenantId}` (toda equipe interessada). Consumer no frontend: novo handler em `useChatRealtime` que invalida `['leads']` + `['journeys']` + `leadByIdKey(journeyId)`. ~10 linhas no frontend, ~5 chamadas de publish no backend.

Alternativa enxuta: começar só pelos pontos que **removem cards do board** (mark-lost, mark-won, closeSale, appointment atendido) — esses geram a confusão mais visível em multi-usuário. Os outros (mudança de substage) ainda são percebidos via reordering interno e podem esperar.

## Padrão pra adicionar evento novo

1. **Definir contrato** em [`packages/events-contracts/src/index.ts`](../packages/events-contracts/src/index.ts): adicionar entrada em `EVENT_CHANNELS`, interface do payload, e mapping em `EventPayloadByChannel`.
2. **Publisher**: chamar `eventBus.publish(EVENT_CHANNELS.X, payload)` **depois do commit** da transação que gerou o estado. Publicar dentro de transação aberta vaza estado não-comitado se a tx falhar depois.
3. **Subscriber no core**: adicionar canal em `SUBSCRIBED_CHANNELS` ([redisSubscriber.ts](../apps/core/src/shared/realtime/redisSubscriber.ts)) e novo `case` em `dispatch()` decidindo a sala (`tenant:{id}` ou `tenant:{id}:chat`).
4. **Typing do socket**: adicionar a assinatura em `ElorIoServer` ([socketServer.ts](../apps/core/src/shared/realtime/socketServer.ts)).
5. **Consumer frontend**: `socket.on(...)` + handler em [useChatRealtime.ts](../apps/frontend/src/hooks/useChatRealtime.ts), com `socket.off` no cleanup. Invalidar a queryKey raiz que cobre as views afetadas.
6. **Atualizar este doc** — nova linha no catálogo + remover da tabela de gaps se virou coberto.
