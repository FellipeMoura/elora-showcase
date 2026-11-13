# Agente de IA — Plano de implementação V1

Roteiro pra construir o agente de IA do Elora do zero. Conversa preparatória rodou em 2026-06-16 entre `claudinei` (Claude Opus 4.7) e o usuário; este doc consolida o escopo + decisões + ordem de execução pra que outro PC (ou outra sessão) possa retomar sem perder contexto.

**Antes de qualquer linha de código**, ler CLAUDE.md (regras absolutas) e [arquitetura.md](./arquitetura.md) (visão geral). Este doc é o "como" específico do agente.

---

## 1. Visão geral

Agente conversacional que atende clientes pelo WhatsApp em dois cenários:

- **Idle** — cliente mandou mensagem, ninguém respondeu por X minutos (configurável por tenant)
- **Fora do horário** — cliente mandou mensagem fora do horário de funcionamento da clínica

Escopo V1: **agendamento + classificação da conversa**. Sem venda, sem geração de PIX, sem áudio inbound — tudo isso fica pra fases futuras.

Stack:
- **Provider**: Anthropic (Claude Sonnet 4.6 como modelo principal; Haiku 4.5 pode entrar pra tarefas baratas se virar dor)
- **App novo**: `apps/agent` (não embute em `apps/chat`)
- **Tools** chamam `apps/core` via HTTP com JWT de "system agent user" por tenant
- **Trigger** via BullMQ delayed jobs + subscriber de eventos Redis existentes
- **Persistência** em tabela nova `agent_turns`

---

## 2. Decisões fechadas (resumo executivo)

### Produto
- **Escopo V1**: agendamento + classificação por tags definidas pelo tenant
- **Triggers**: idle (X min configurável por tenant) OU fora do horário de funcionamento
- **Áudio inbound**: V2 (nada na V1)
- **Feature flag**: dupla — global (env `AGENT_GLOBAL_KILL_SWITCH`) + por tenant (`tenants.agent_enabled`)
- **Tags da conversa**: aplicadas pelo agente E por humano via UI desde a V1

### Arquitetura
- **App novo `apps/agent`** — separado de `apps/chat` por motivos de cadência de mudança, concerns próprios e desacoplamento via Redis
- **Provider**: Anthropic (SDK `@anthropic-ai/sdk` com prompt caching)
- **Tools como HTTP** pro `apps/core` (não import direto de services) — JWT de system agent user, latência aceitável (LLM já é 1-2s)
- **Persistência de turno** em tabela própria `agent_turns` (não polui `messages`)
- **`agent_proposals`** como tabela própria pra confirmar agendamento em duas fases (não reusa `appointments` com status `tentative`)
- **`conversations.agent_paused_until`** (campo simples) pra pausa por conversation — sem tabela de histórico de quem pausou na V1
- **Pacote `@elora/agent-contracts`** pra compartilhar tipos das tool schemas entre `apps/core` e `apps/agent`

### Comportamento
- **Confirmação em 2 fases** pra agendamento: `proposeAppointment` (cria proposta com expiração 15min) → `confirmAppointment` (com idempotency key) só depois do "sim" do cliente
- **Handoff explícito** pra humano via tool `handoffToHuman` quando: cliente pede, agente não sabe, urgência médica, max iterations atingido
- **Max iterations no loop** = 5 tool rounds; depois força handoff
- **Modelo escolhido**: Claude Sonnet 4.6 (`claude-sonnet-4-6`)

---

## 3. O que NÃO entra na V1

- Geração de PIX / venda
- Sumarização de conversa antes de handoff
- Áudio inbound (transcrição via Whisper ou equivalente)
- Memory de longo prazo cross-conversation
- RAG / vector store (catálogo de procedimentos cabe no system prompt)
- Outbound proativo do agente (ex.: "está chegando a hora da manutenção")
- A/B testing de prompts
- Evals automatizados (fica manual via planilha de casos)
- Painel de métricas dedicado além da tabela `agent_turns` consultável

---

## 4. Pré-requisitos

### Dependências a instalar

Em `apps/agent/package.json` (novo app):
```
@anthropic-ai/sdk
bullmq
ioredis
zod
@elora/db
@elora/auth
@elora/events-contracts
@elora/agent-contracts
@elora/openapi (se existir; senão duplicar pattern do chat)
pino
@sentry/node
express  (pra endpoints admin)
```

Em `packages/agent-contracts/` (novo workspace):
```
zod
```

### Variáveis de ambiente novas

```
ANTHROPIC_API_KEY=sk-ant-...
AGENT_GLOBAL_KILL_SWITCH=true        # default true em prod até ligar deliberadamente
AGENT_DEFAULT_MODEL=claude-sonnet-4-6
AGENT_MAX_TOOL_ITERATIONS=5
AGENT_RATE_LIMIT_HOURLY=10
AGENT_RATE_LIMIT_DAILY=50
AGENT_TENANT_DAILY_COST_CAP_CENTS=5000   # R$ 50/dia por tenant; agente para
CORE_BASE_URL=http://localhost:3000      # apps/core URL pra chamadas internas
```

### Convenções da casa que valem reforçar

- **schema.ts é fonte da verdade** ([packages/db/src/schema.ts](../packages/db/src/schema.ts)) — workflow em [db-workflow.md](./db-workflow.md)
- **Toda query em tabela com RLS** roda em `withTenant(db, tenantId, async (tx) => {...})`
- **Strings/comentários em PT-BR; identificadores em inglês** (CLAUDE.md regra 1)
- **Validação com Zod**, schemas em `*Types.ts`, registro OpenAPI no `*Routes.ts` (CLAUDE.md regra 10)
- **Estrutura por domínio** (CLAUDE.md regra 2) — espelhar `apps/chat/src/modules/<domínio>`
- **Sem generic handlers** (CLAUDE.md regra 3) — controllers explícitos com try/catch + next(err)
- **Drizzle** com `InferSelectModel<typeof t>` pra tipos; nunca interfaces manuais

---

## 5. Esquema de banco — 4 mudanças

Editar [packages/db/src/schema.ts](../packages/db/src/schema.ts), depois `pnpm db:generate` + lembrar do `FORCE ROW LEVEL SECURITY` no SQL gerado (CLAUDE.md regra 4).

### 5.1 `tenants` — flags + business hours + persona

```ts
agentEnabled: boolean('agent_enabled').notNull().default(false),
agentIdleMinutes: integer('agent_idle_minutes').notNull().default(15),
agentPersona: text('agent_persona'),
businessHours: jsonb('business_hours').$type<BusinessHours>(),
```

```ts
interface BusinessHours {
  timezone: string;                                  // "America/Sao_Paulo"
  schedule: Array<{
    dayOfWeek: 0|1|2|3|4|5|6;
    open: string;                                    // "HH:MM"
    close: string;
  }>;
  // Dia ausente = fechado. Múltiplas janelas no mesmo dia = N entries.
}
```

### 5.2 `users` — flag de system agent

```ts
isSystemAgent: boolean('is_system_agent').notNull().default(false),
```

**Backfill**: migration cria 1 user `is_system_agent=true` por tenant existente. Username `system_agent` (unique por tenant respeita `(tenant_id, username)`); email `null` (system agent não recebe comunicação humana). `passwordHash` = bcrypt de string aleatória descartada (não tem login). Role com permissões: `clients:read`, `appointments:read`, `appointments:write`, `availability:read`, `conversations:read`, `messages:write`, `procedures:read`, `tenants:read`.

> **Nota histórica (2026-07-21):** V1 documentado abaixo criava o user com `email=agent@system.elora.test`; após a migração de login por username (arquitetura.md §26), o system agent passou a ter `username='system_agent'` + `email=null` — a invariante "1 user is_system_agent por tenant" é a mesma.

Editar [packages/db/seed.ts](../packages/db/seed.ts) pra criar esse user em tenants de seed também.

### 5.3 `conversation_tags` + `conversation_tag_assignments`

```ts
export const conversationTags = pgTable('conversation_tags', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
  name: varchar({ length: 64 }).notNull(),
  color: varchar({ length: 16 }).notNull(),                // hex
  agentInstruction: text('agent_instruction'),             // vai no system prompt
  active: boolean().notNull().default(true),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique('conversation_tags_tenant_name_unique').on(t.tenantId, t.name),
  index('conversation_tags_tenant_id_idx').on(t.tenantId),
  pgPolicy('tenant_isolation', { as: 'permissive', for: 'all', using: tenantPolicy, withCheck: tenantPolicy }),
]).enableRLS();

export const conversationTagAssignments = pgTable('conversation_tag_assignments', {
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  tagId: uuid('tag_id').notNull().references(() => conversationTags.id, { onDelete: 'cascade' }),
  tenantId: uuid('tenant_id').notNull(),
  assignedByAgentTurnId: uuid('assigned_by_agent_turn_id'),   // null quando aplicada por humano
  assignedAt: timestamp().notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.conversationId, t.tagId] }),
  index('conv_tag_asgn_tenant_id_idx').on(t.tenantId),
  pgPolicy('tenant_isolation', { as: 'permissive', for: 'all', using: tenantPolicy, withCheck: tenantPolicy }),
]).enableRLS();
```

### 5.4 `agent_turns` + enum

```ts
export const agentTriggerTypeEnum = pgEnum('agent_trigger_type', [
  'idle', 'out_of_hours', 'manual_resume'
]);

export const agentTurns = pgTable('agent_turns', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  triggerType: agentTriggerTypeEnum('trigger_type').notNull(),
  triggerMetadata: jsonb('trigger_metadata').$type<Record<string, unknown>>(),
  inputMessageId: uuid('input_message_id').references(() => messages.id, { onDelete: 'set null' }),
  promptVersion: text('prompt_version').notNull(),                        // "agendamento.v1"
  model: text('model').notNull(),                                         // "claude-sonnet-4-6"
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  costCents: numeric('cost_cents', { precision: 10, scale: 4 }).notNull().default('0'),
  latencyMs: integer('latency_ms').notNull().default(0),
  toolCalls: jsonb('tool_calls').$type<ToolCallRecord[]>().notNull().default(sql`'[]'::jsonb`),
  outputMessageIds: uuid('output_message_ids').array(),
  classificationTagIds: uuid('classification_tag_ids').array(),
  handoffReason: text('handoff_reason'),
  error: text('error'),
  createdAt: timestamp().notNull().defaultNow(),
  updatedAt: timestamp().notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index('agent_turns_tenant_created_idx').on(t.tenantId, t.createdAt),
  index('agent_turns_conv_created_idx').on(t.conversationId, t.createdAt),
  pgPolicy('tenant_isolation', { as: 'permissive', for: 'all', using: tenantPolicy, withCheck: tenantPolicy }),
]).enableRLS();

type ToolCallRecord = {
  name: string;
  args: Record<string, unknown>;
  result: 'ok' | 'error';
  resultPayload?: unknown;
  errorMessage?: string;
  ms: number;
};
```

### 5.5 `agent_proposals` (criada no PR 7)

```ts
export const agentProposals = pgTable('agent_proposals', {
  id: uuid().primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  agentTurnId: uuid('agent_turn_id').references(() => agentTurns.id, { onDelete: 'set null' }),
  payload: jsonb('payload').notNull(),                            // dados da proposta de agendamento
  expiresAt: timestamp('expires_at').notNull(),                   // now + 15min
  consumedAt: timestamp('consumed_at'),                           // null = ainda pendente
  resultAppointmentId: uuid('result_appointment_id'),             // FK pra appointments quando confirmada
  createdAt: timestamp().notNull().defaultNow(),
}, (t) => [
  index('agent_proposals_tenant_id_idx').on(t.tenantId),
  index('agent_proposals_conv_idx').on(t.conversationId, t.createdAt),
  pgPolicy('tenant_isolation', { as: 'permissive', for: 'all', using: tenantPolicy, withCheck: tenantPolicy }),
]).enableRLS();
```

### 5.6 `conversations.agent_paused_until` (PR 6 ou 7)

```ts
agentPausedUntil: timestamp('agent_paused_until'),
```

`NULL` = agente ativo (respeitando flag global/tenant). Quando humano clica "Assumir conversa", seta `now + 24h`. Botão "Devolver pro agente" zera. Worker checa antes de rodar.

---

## 6. Estrutura do `apps/agent`

Espelha [apps/chat](../apps/chat/) e segue CLAUDE.md regra 2 (por domínio):

```
apps/agent/
├── package.json
├── tsconfig.json
├── src/
│   ├── env.ts                                      # ANTHROPIC_API_KEY, AGENT_GLOBAL_KILL_SWITCH, CORE_BASE_URL...
│   ├── server.ts                                   # boot: HTTP admin + workers + subscribers
│   ├── routes.ts                                   # admin endpoints
│   ├── modules/
│   │   ├── conversations/
│   │   │   ├── AgentRunner.ts                      # orquestra: contexto → LLM → tools loop → persist
│   │   │   ├── ContextBuilder.ts                   # monta system+messages payload
│   │   │   ├── ResponseDispatcher.ts               # envia outbound via CoreClient.sendMessage()
│   │   │   ├── AgentTurnsRepo.ts                   # persistência em agent_turns
│   │   │   └── AgentTurnsTypes.ts
│   │   ├── triggers/
│   │   │   ├── IdleTriggerScheduler.ts             # enqueue/cancel delayed jobs
│   │   │   ├── OutOfHoursDetector.ts               # consulta business_hours
│   │   │   ├── InboundSubscriber.ts                # assina wa.message.received
│   │   │   ├── HumanReplyCanceller.ts              # assina message.created (humano)
│   │   │   └── worker.ts                           # BullMQ worker
│   │   ├── tools/
│   │   │   ├── ToolRegistry.ts                     # nome → { schema, handler, description }
│   │   │   ├── executeToolCall.ts                  # valida args (Zod) → chama handler
│   │   │   └── definitions/
│   │   │       ├── tagConversation.ts
│   │   │       ├── searchAvailableSlots.ts
│   │   │       ├── proposeAppointment.ts
│   │   │       ├── confirmAppointment.ts
│   │   │       ├── getClientInfo.ts
│   │   │       ├── getProcedureInfo.ts
│   │   │       ├── getBusinessHours.ts
│   │   │       └── handoffToHuman.ts
│   │   └── prompts/
│   │       ├── PromptBuilder.ts                    # compõe dinâmico (persona+tags+horários)
│   │       └── versions/
│   │           └── agendamento.v1.ts               # texto base
│   └── shared/
│       ├── anthropic/
│       │   ├── client.ts                           # SDK + cache_control + retry
│       │   └── pricing.ts                          # cost_cents por modelo
│       ├── coreClient/
│       │   ├── CoreClient.ts                       # interface
│       │   ├── HttpCoreClient.ts                   # impl HTTP com JWT system agent
│       │   ├── jwt.ts                              # gera token curto por tenant
│       │   └── index.ts                            # singleton factory
│       ├── redis/redis.ts
│       ├── database/db.ts
│       ├── eventBus/index.ts                       # subscriber (não publisher V1)
│       ├── rateLimit/
│       │   └── conversationRateLimit.ts            # Redis-based
│       └── observability/{logger,sentry,requestContext}.ts
```

---

## 7. Roadmap de PRs (10 PRs em ordem)

### PR 1 — Schema + system agent users
**Sem comportamento ainda.** Schema + admin CRUD.

- Editar [packages/db/src/schema.ts](../packages/db/src/schema.ts) com as mudanças §5.1, §5.2, §5.3, §5.4
- `pnpm db:generate` + revisar SQL gerado (adicionar `FORCE ROW LEVEL SECURITY` onde necessário)
- Backfill em migration: criar system agent user pra cada tenant existente
- Editar [packages/db/seed.ts](../packages/db/seed.ts) pra incluir system agent user
- Novo módulo `apps/core/src/modules/conversationTags/` (Controller, Service, Query, Types, Routes) — CRUD admin pro catálogo
- Atualizar `defaultMenus` no seed pra incluir entrada "Tags da conversa" em settings (seed_workflow memory)

### PR 2 — Skeleton `apps/agent` + Anthropic client
- Criar `apps/agent` com env, server boot, OpenAPI registry, error handling — espelho de `apps/chat`
- `shared/anthropic/client.ts`: wrapper do SDK com `cache_control: { type: 'ephemeral' }` no system + tools, retry exponencial, headers de cost tracking
- `shared/anthropic/pricing.ts`: tabela de preços por modelo (input/output/cache_read/cache_creation tokens) → `costCents`
- Endpoints admin: `GET /health`, `GET /kill-switch`
- `AGENT_GLOBAL_KILL_SWITCH=true` por padrão (não roda nada)

### PR 3 — CoreClient + `@elora/agent-contracts`
- Criar `packages/agent-contracts/` workspace com schemas Zod compartilhados (tool inputs/outputs)
- `apps/agent/shared/coreClient/HttpCoreClient.ts`:
  - `jwt.ts`: gera token curto (exp 60s) `{ userId: <system-agent-user>, tenantId }`
  - Métodos: `getBusinessHours`, `getClient`, `getProcedures`, `getFreeSlots`, `createAppointment`, `sendMessage`, `assignConversationTags`, `findSystemAgentUserId(tenantId)`
- Cada chamada loga `[coreClient] <method>` + headers `X-Agent-Request: true` pra rastreabilidade nos logs do core
- Nada de LLM ainda — só infra de comunicação

### PR 4 — Triggers (observa, não age)
- `InboundSubscriber` assina `EVENT_CHANNELS.whatsappMessageReceived` ([events-contracts](../packages/events-contracts/))
- Filtro: tenant tem `agent_enabled=true` E mensagem é inbound de cliente (não call, não outbound capturado)
- Calcula se está fora do horário via `OutOfHoursDetector` (usa `tenant.businessHours` + timezone)
- Enfileira job:
  - Fora do horário → `delay: 0`
  - Dentro → `delay: tenant.agentIdleMinutes * 60_000`
  - `jobId: agent-trigger-{conversationId}` — único por conversation, novo job substitui
- `HumanReplyCanceller` assina `EVENT_CHANNELS.messageCreated` ([apps/chat MessagesService.ts:439](../apps/chat/src/modules/messages/MessagesService.ts#L439)):
  - Se `direction === 'outbound'` E `authorUserId !== systemAgentUserId` → cancela job `agent-trigger-{conversationId}`
- Worker recebe job: **só loga** `[agent] would trigger now { conversationId, triggerType }`. **Não chama LLM ainda.**
- Valida toda mecânica de trigger sem custo de IA

### PR 5 — Classificação only (pipeline end-to-end, sem responder)
- `AgentRunner.run(conversationId, triggerType, triggerMetadata)`:
  - `ContextBuilder`: carrega conversation + últimas 30 messages + client + tenant + tags ativas
  - `PromptBuilder.minimal()`: system prompt v1.minimal = "Você é classificador, tags disponíveis: ..., responda só com tool_use"
  - Call Anthropic com `tool_choice: { type: 'tool', name: 'tagConversation' }` (força uso)
  - Executa `tagConversation` → chama `CoreClient.assignConversationTags(conversationId, tagIds, agentTurnId)`
  - `AgentTurnsRepo.create(...)` com todos os campos preenchidos
- Única tool registrada: `tagConversation`
- **NÃO envia resposta** ao cliente
- Frontend recebe evento Redis novo `conversation.tags.updated` (publicado pelo agent) → atualiza tag chips na UI

### PR 6 — Resposta de texto + tools read-only
- System prompt completo (v1) — ver §9
- Tools adicionadas: `getClientInfo`, `getProcedureInfo`, `getBusinessHours`, `searchAvailableSlots`, `handoffToHuman`
- `ResponseDispatcher.sendText(conversationId, text)` chama `CoreClient.sendMessage(conversationId, text)` — entra no fluxo outbound existente do `apps/chat`
- Loop Anthropic completo: tool_use → execute → tool_result → repeat até `stop_reason === 'end_turn'` OU max iterations
- **NÃO cria appointment ainda** — se cliente confirma horário, agente é instruído a chamar `handoffToHuman(reason='agendamento_pendente_confirmacao')` em vez
- Adicionar campo `conversations.agent_paused_until` (§5.6) e checagem no worker
- Frontend: botão "Assumir conversa" no header da conversa → POST que seta `agent_paused_until = now + 24h`

### PR 7 — Agendamento com confirmação em 2 fases
- Migration: tabela `agent_proposals` (§5.5)
- Nova tool: `proposeAppointment({ procedureId, professionalId, slotStart, slotEnd })`:
  - Validações antes de criar: slot ainda livre, professional pode aplicar (`canApplyProcedures`), client_id resolvido da conversation
  - INSERT em `agent_proposals` com `expiresAt = now + 15min`
  - Retorna `{ proposalId, expiresAt, humanSummary }` (summary = string formatada pro LLM compor mensagem)
- Nova tool: `confirmAppointment({ proposalId, idempotencyKey })`:
  - Validações: proposal existe, não expirou, não consumida, mesma conversation, idempotencyKey é UUID válido
  - Idempotência: se já existe consumo com mesma `idempotencyKey`, retorna mesmo `appointmentId`
  - Chama `CoreClient.createAppointment(...)` com dados da proposal
  - UPDATE `agent_proposals.consumedAt = now()`, `resultAppointmentId = ...`
  - Retorna `{ appointmentId, summary }`
- System prompt v1 ganha bloco "REGRAS DURAS" reforçando: NUNCA confirmar sem cliente ter dito sim explícito

### PR 8 — UI de operação (frontend)
- Em settings: seção "Agente IA" com:
  - Toggle `agent_enabled`
  - Slider `agent_idle_minutes` (5–60)
  - Textarea `agent_persona`
  - Editor visual de `business_hours` (lista de dias da semana com janelas open/close)
- Página `/configuracoes/tags` (já criada no PR 1, agora finalizada visualmente):
  - Lista de tags com cor + nome + `agent_instruction`
  - Form de criar/editar com preview de chip
- Em ChatPage:
  - Badge "IA" nas bolhas de outbound onde `authorUserId === systemAgentUserId`
  - Indicador no header: "Agente fará follow-up em 12min" quando job pendente
  - Tag chips da conversa visíveis no painel lateral, com opção de adicionar/remover manualmente
- Todo trabalho de UI passa por [frontend-design-system.md](./frontend-design-system.md) (CLAUDE.md regra 13)

### PR 9 — Painel de traces + observabilidade
- Página `/agente/traces` (admin only):
  - Lista paginada de `agent_turns` recentes
  - Filtros: tenant (super-admin), conversation, status (ok/erro/handoff), range de data
  - Expansão por linha: tool_calls jsonb formatado, latência, tokens, custo, erro completo
- Endpoint `GET /api/agent-traces` em `apps/core` (requer permissão `agent:read_traces`)
- Sentry context: cada `AgentRunner.run()` abre transaction com tags `agent_turn_id`, `conversation_id`, `tenant_id`, `trigger_type`
- Cron simples (BullMQ repeat job a cada 1h): agrega `agent_turns` por tenant nas últimas 24h → log estruturado pra alerting externo

### PR 10 — Kill switch ativo + rate limits + go-live
- `AGENT_GLOBAL_KILL_SWITCH=false` em prod
- Rate limit Redis por conversation: `agent:rate:{conversationId}:hourly` e `:daily` — TTL alinhado
- Hard cap de custo diário por tenant: `SELECT sum(cost_cents) FROM agent_turns WHERE tenant_id=? AND created_at > now() - interval '24h'`. Se > `AGENT_TENANT_DAILY_COST_CAP_CENTS`, agente para e abre handoff
- Smoke test em 1 tenant piloto (interno) com dados reais
- Liga `agent_enabled=true` no piloto, monitora 1 semana
- Documenta procedimento de rollback (set `AGENT_GLOBAL_KILL_SWITCH=true` + restart `apps/agent`)

---

## 8. Fluxo end-to-end (anatomia de uma conversa)

```
Cliente: "Oi, queria marcar laser de virilha pra semana que vem"
  │
  ▼
apps/chat: inboundNormalizer/pipeline.ts
  ├── persiste em messages
  └── publica EVENT_CHANNELS.whatsappMessageReceived
  │
  ▼
apps/agent: InboundSubscriber
  ├── tenant.agent_enabled? não → drop
  └── sim:
      ├── conversations.agent_paused_until > now? → drop
      ├── fora do horário? → enfileira job delay=0
      └── dentro? → enfileira job delay=15min, jobId=agent-trigger-{convId}

[15 min passam SEM humano responder]
  │
  ▼
BullMQ dispara job → worker → AgentRunner.run(convId, 'idle')
  │
  ├── 1. checagem dupla: agent_enabled ainda true? paused? rate limit OK? cost cap OK?
  ├── 2. ContextBuilder.load(convId):
  │      ├── conversation + últimas 30 messages
  │      ├── client (nome, telefone, último appointment, journey stage)
  │      ├── tenant (persona, business_hours, tags ativas com agent_instruction)
  │      └── procedures do tenant (do CoreClient.getProcedures)
  ├── 3. PromptBuilder.compose(ctx):
  │      ├── system [cached]: persona + horário + tags + procedures + guardrails
  │      ├── tools [cached]: definitions de todas as 8 tools
  │      └── messages: histórico convertido pra Anthropic format
  ├── 4. Loop Anthropic (max 5 iterações):
  │      ├── call #1 → LLM: tool_use(tagConversation) + tool_use(searchAvailableSlots)
  │      ├── executeToolCall x2 → handlers chamam CoreClient
  │      ├── call #2 → LLM: texto "Posso agendar terça 14h ou quarta 16h, qual prefere?"
  │      └── stop_reason='end_turn' → sai do loop
  ├── 5. ResponseDispatcher.sendText(convId, "Posso agendar ...") via CoreClient.sendMessage
  ├── 6. AgentTurnsRepo.create(turn completo)
  └── 7. publica `agent.turn.completed` (frontend opcional reage)

[Cliente: "quarta"]
  │
  ▼
wa.message.received → InboundSubscriber → enfileira NOVO idle job (substitui)
  ▼
[15 min OU configuração de "ativa logo se cliente respondeu uma pergunta direta"]
  ▼
AgentRunner roda de novo, contexto inclui "quarta"
  ├── tool_use(proposeAppointment) → cria row em agent_proposals expira 15min
  └── LLM: "Confirmo agendamento quarta 16h com Dra. X pra laser virilha. Confirma?"

[Cliente: "sim"]
  ▼
AgentRunner novo turno
  ├── tool_use(confirmAppointment, idempotency_key=<UUID gerado pelo LLM>)
  ├── createAppointment de fato no core
  └── LLM: "Confirmado! Lembrete chegará 24h antes."
```

---

## 9. System prompt v1 (esboço)

Arquivo: `apps/agent/src/modules/prompts/versions/agendamento.v1.ts`

Bloco com `cache_control: { type: 'ephemeral' }` (CONTEXTO DA CLÍNICA + CLASSIFICAÇÃO + RESPONSABILIDADES + REGRAS + TOM) muda pouco entre chamadas do mesmo tenant. Bloco `CONTEXTO DO CLIENTE` muda por conversation — fica fora do cache.

```
Você é o assistente virtual da {{tenant.name}}. {{tenant.agent_persona}}

CONTEXTO DA CLÍNICA
- Razão social: {{tenant.tradeName}}
- Horário de funcionamento: {{businessHoursFormatted}}
- Procedimentos disponíveis:
{{proceduresList}}

CLASSIFICAÇÃO DA CONVERSA (use a tool tagConversation no INÍCIO de todo turno)
{{tagsListWithInstructions}}

SUAS RESPONSABILIDADES
1. Responder dúvidas sobre procedimentos, preços e horários da clínica.
2. Agendar consultas usando proposeAppointment + confirmAppointment (sempre nesta ordem).
3. Classificar a conversa usando tagConversation a cada turno.
4. NUNCA dar conselho médico, sugestão clínica ou opinião sobre indicação de procedimento.
   → Diga sempre: "Vou agendar uma avaliação com nossa profissional pra te orientar."

REGRAS DURAS
- Antes de criar um agendamento de fato, SEMPRE chame proposeAppointment e peça confirmação ao cliente em mensagem separada.
- Só chame confirmAppointment depois do cliente responder claramente "sim", "confirmo", "pode marcar" ou equivalente. Recuse interpretar silêncio ou ambiguidade como confirmação.
- Se a tool retornar erro de slot ocupado, tente o próximo slot disponível antes de pedir nova preferência.
- Se o cliente reclamar, mencionar urgência médica, falar em desistir/cancelar pacote, OU se você não souber responder algo: chame handoffToHuman.
- Após 5 trocas sem progresso claro, chame handoffToHuman.

TOM
Português brasileiro, mensagens curtas (2-3 linhas), evite formalidade excessiva. {{tenant.agent_persona}}.

---
CONTEXTO DO CLIENTE
- Nome: {{client.name}}
- Última visita: {{client.lastAppointmentSummary || "primeira visita"}}
- Etapa na jornada: {{journey.stage}}
```

---

## 10. Tools v1 — schemas Zod

Compartilhados via `packages/agent-contracts/`. Cada tool tem:
- `name: string`
- `description: string` (vai pro LLM — capricho aqui afeta qualidade)
- `inputSchema: ZodSchema` (convertido pra JSON Schema pelo Anthropic SDK)
- `handler: (input, ctx) => Promise<output>` (no `apps/agent`)

```ts
// tagConversation
input: z.object({
  tagIds: z.array(z.string().uuid()).min(0).max(5)
})
output: { applied: number }

// getClientInfo
input: z.object({})
output: {
  id: string;
  name: string;
  journeyStage: string;
  lastAppointmentAt: string | null;
  activePackages: Array<{ procedureName: string; remainingSessions: number }>;
  notes: string | null;
}

// getProcedureInfo
input: z.object({
  search: z.string().optional(),
  procedureId: z.string().uuid().optional()
}).refine(d => d.search || d.procedureId, "informe search OU procedureId")
output: Array<{
  id: string;
  name: string;
  description: string;
  durationMin: number;
  priceCents: number;
  requiresEvaluation: boolean;
}>

// getBusinessHours
input: z.object({})
output: {
  timezone: string;
  schedule: Array<{ dayOfWeek: number; open: string; close: string }>;
  nextOpenAt: string;          // ISO
  isOpenNow: boolean;
}

// searchAvailableSlots
input: z.object({
  procedureId: z.string().uuid(),
  dateFrom: z.string().date(),                       // YYYY-MM-DD
  dateTo: z.string().date().optional(),
  professionalId: z.string().uuid().optional()
})
output: Array<{
  slotStart: string;                                 // ISO
  slotEnd: string;
  professionalId: string;
  professionalName: string;
}>

// proposeAppointment
input: z.object({
  procedureId: z.string().uuid(),
  professionalId: z.string().uuid(),
  slotStart: z.string().datetime(),
  slotEnd: z.string().datetime()
})
output: {
  proposalId: string;
  expiresAt: string;                                 // ISO
  humanSummary: string;                              // ex: "laser virilha com Dra. Ana, quarta 17/06 às 16h"
}

// confirmAppointment
input: z.object({
  proposalId: z.string().uuid(),
  idempotencyKey: z.string().uuid()
})
output: {
  appointmentId: string;
  summary: string;
}

// handoffToHuman
input: z.object({
  reason: z.string().min(3).max(200),
  urgency: z.enum(['low', 'high'])
})
output: { handoffId: string; message: string }
```

---

## 11. Guardrails consolidados

1. **Validação dupla**: Zod no input da tool + regra de domínio no core (`createAppointment` já rejeita slot ocupado, valor inválido, professional sem capacidade, etc.)
2. **Agendamento em 2 fases**: `proposeAppointment` (dry-run, expira em 15min) → `confirmAppointment` (commit) com `idempotencyKey` obrigatória
3. **Idempotência**: UUID gerado pelo LLM, validado no backend. Mesmo UUID = mesmo appointment retornado
4. **Pause por conversation**: `conversations.agent_paused_until` checado pelo worker. Humano clica "assumir" → seta `now + 24h`; "devolver" → zera
5. **Kill switch global**: env `AGENT_GLOBAL_KILL_SWITCH=true` desliga tudo
6. **Rate limit Redis**: 10 turnos/h e 50/dia por conversation; hard cap de custo R$ X/dia por tenant
7. **Max iterations no loop**: 5 tool rounds; depois força `handoffToHuman` automático
8. **System agent user com permissions enxutas**: sem `tenants:write`, `users:write`, `sales:write`. Só leitura + agendamento + envio de mensagem
9. **JWT curto** (60s exp) — agente gera novo a cada batch de chamadas; vazamento limita janela de exploração

---

## 12. Riscos & mitigações

| Risco | Mitigação |
|---|---|
| Vazamento entre tenants (tool da clínica A vê dados da clínica B) | Todas as queries via `withTenant` no core. JWT do agente já vincula tenant. Auditar nos PRs 3 e 6. |
| LGPD — dados de saúde indo pro provider externo | DPA com Anthropic (não treina em API data). Documentar nos termos da clínica. Não enviar CPF/RG no prompt — só nome + telefone + procedimento. |
| Custo descontrolado | Rate limit + hard cap diário por tenant (PR 10). Alerta em log estruturado quando 80% do cap. |
| PIX/venda fantasma | **N/A na V1** (escopo só agendamento). Quando entrar venda, confirmação em 2 fases + valor validado contra tabela de preços do backend, NUNCA do LLM. |
| Agendamento errado por má interpretação | Confirmação em 2 fases. `proposeAppointment` retorna `humanSummary` que o LLM mostra ao cliente literalmente antes de pedir "sim". |
| Conselho clínico inadequado | Regra dura no system prompt + caso de teste manual nos evals iniciais. Possível LLM-as-judge no V2. |
| Agente respondendo após humano já ter falado | `HumanReplyCanceller` cancela job ao detectar `message.created` com `authorUserId != systemAgentUserId`. Race: humano e agent simultâneos é mitigado por `conversations.agent_paused_until` ser checado no `AgentRunner.run()` antes de qualquer ação. |

---

## 13. Referências do código existente

Arquivos/patterns que o agente reusa ou se integra com:

- [packages/db/src/schema.ts](../packages/db/src/schema.ts) — fonte da verdade do banco
- [apps/chat/src/shared/workers/outboundDelivery/queue.ts](../apps/chat/src/shared/workers/outboundDelivery/queue.ts) — padrão BullMQ com jobId determinístico + retry
- [apps/chat/src/shared/workers/outboundDelivery/worker.ts](../apps/chat/src/shared/workers/outboundDelivery/worker.ts) — padrão Worker + lock + DelayedError
- [apps/chat/src/shared/eventBus/eventBus.ts](../apps/chat/src/shared/eventBus/eventBus.ts) — wrapper publish (agent é só subscriber V1)
- [apps/chat/src/shared/workers/inboundNormalizer/pipeline.ts](../apps/chat/src/shared/workers/inboundNormalizer/pipeline.ts) — publica `whatsappMessageReceived` (linha 266)
- [apps/chat/src/modules/messages/MessagesService.ts](../apps/chat/src/modules/messages/MessagesService.ts) — publica `messageCreated` (linha 439)
- [apps/chat/src/shared/middleware/ensureAuthenticated.ts](../apps/chat/src/shared/middleware/ensureAuthenticated.ts) — padrão de auth com JWT (espelhar no agent admin endpoints)
- [apps/core/src/modules/availability/availabilityRoutes.ts](../apps/core/src/modules/availability/availabilityRoutes.ts) — endpoint `/availability/free-slots` reusado pela tool `searchAvailableSlots`
- [apps/core/src/modules/appointments/appointmentsRoutes.ts](../apps/core/src/modules/appointments/appointmentsRoutes.ts) — endpoint de criar appointment reusado pela tool `confirmAppointment`
- [apps/chat/src/shared/coreGateway/CoreGateway.ts](../apps/chat/src/shared/coreGateway/CoreGateway.ts) — padrão de gateway (inspiração pro `CoreClient` do agente, com diferença: agent vai por HTTP desde V1)

---

## 14. Estado de implementação

- [x] PR 1 — Schema + system agent users *(migration 0038_tense_callisto.sql aplicada 2026-06-16)*
- [x] PR 2 — Skeleton `apps/agent` + Anthropic client *(validado 2026-06-17; /agent/diagnostics retornou Anthropic ok com Haiku)*
- [x] PR 3 — CoreClient + `@elora/agent-contracts` *(validado 2026-06-17 end-to-end: /agent/diagnostics?tenant=clinica retornou agentUserResolved=true, proceduresFetched=4, 160ms)*
- [x] PR 4 — Triggers (observa, não age) *(validado 2026-06-17 — enqueue + reset + cancelamento por outbound humano)*
- [x] PR 5 — Classificação only *(validado 2026-06-17 — turn ok em ~2s, 0.486 cents)*
- [x] PR 6 — Resposta de texto + tools read-only *(validado 2026-06-17 end-to-end no WhatsApp real — agente respondeu cliente; bugs do dia já corrigidos)*
- [ ] PR 7 — Agendamento 2 fases
- [ ] PR 8 — UI de operação
- [ ] PR 9 — Painel de traces + observabilidade
- [ ] PR 10 — Kill switch ativo + rate limits + go-live

Atualizar este checklist conforme PRs forem mergeados. Quando todos fechados, mover doc pra histórico (`-implementation.md` → seção "Histórico" em [arquitetura.md](./arquitetura.md) §X) e criar `ai-agent.md` operacional (como [reports-module.md](./reports-module.md) é pro relatório).

---

## 15. PR 1 — pós-código: passos do usuário

Mudanças de código já aplicadas:
- `packages/db/src/schema.ts` ganhou: `BusinessHours` interface + 4 campos novos em `tenants`, `isSystemAgent` em `users`, valor `'agent'` em `roleCodeEnum`, enum `agentTriggerTypeEnum`, tabelas `agentTurns` + `conversationTags` + `conversationTagAssignments`, interface `AgentToolCallRecord`.
- `packages/db/src/index.ts` re-exporta tudo isso.
- `apps/core/src/shared/permissions/permissions.ts` ganhou role `agent` em ROLE_CODES + permissions `conversationTags:*` + role `agent` em algumas actions existentes (clients:read, procedures:read, appointments:read/write, availability:read).
- `apps/core/src/modules/conversationTags/` (5 arquivos novos): Controller, Service, Query, Types, Routes — espelho de units.
- `apps/core/src/routes.ts` registra `conversationTagsRoutes`.
- `packages/db/seed.ts`: grupo "Agente IA" + system agent user pra cada tenant (platform + demo) + menu "Tags da conversa" em Configurações + catálogo inicial de 5 tags pro tenant demo.

### 15.1 Gerar migration

```bash
pnpm --filter @elora/db db:generate
```

### 15.2 Ajustar migration gerada

`drizzle-kit` não gera `FORCE ROW LEVEL SECURITY`. Abrir o `.sql` recém-criado em `packages/db/migrations/` e adicionar, logo depois de cada `ENABLE ROW LEVEL SECURITY` das 3 tabelas novas:

```sql
ALTER TABLE "agent_turns" FORCE ROW LEVEL SECURITY;
ALTER TABLE "conversation_tags" FORCE ROW LEVEL SECURITY;
ALTER TABLE "conversation_tag_assignments" FORCE ROW LEVEL SECURITY;
```

Sem isso, o owner do banco (postgres) bypassa as policies e a isolation entre tenants vaza nessas tabelas.

### 15.3 Backfill em prod (dev: reseed cuida)

Em dev, `pnpm seed` recria tudo a partir do zero — backfill não se aplica.

Em prod (tenant `main` + tenants clientes vivos), a migration precisa criar o grupo "Agente IA" e o system agent user de cada tenant existente, mais o menu novo + vínculo aos tenants. Adicionar ao final da migration:

```sql
-- ============================================================
-- Backfill: agente de IA (idempotente)
-- ============================================================

-- 1) Group global "Agente IA" — único pro role 'agent'.
INSERT INTO groups (name, role_code, description)
VALUES (
  'Agente IA',
  'agent',
  'System agent (apps/agent) — não-humano. Permissions enxutas: leitura de catálogos + agendamento + envio de mensagem.'
)
ON CONFLICT (role_code) DO NOTHING;

-- 2) Pra cada tenant existente, cria 1 system agent user + vincula ao grupo.
-- Reusa um passwordHash bcrypt válido qualquer (login pelo agent é bloqueado
-- em camada superior, mas a coluna é NOT NULL). Pega o primeiro user admin
-- pra emprestar o hash — sempre existe porque seed/provisioning cria admin.
-- (Pós-migração username: usa username='system_agent'; email null.)
WITH agent_group AS (
  SELECT id FROM groups WHERE role_code = 'agent' LIMIT 1
),
inserted_users AS (
  INSERT INTO users (tenant_id, username, email, password_hash, name, is_system_agent)
  SELECT
    t.id,
    'system_agent',
    NULL,
    (SELECT password_hash FROM users WHERE tenant_id = t.id LIMIT 1),
    'Agente IA',
    true
  FROM tenants t
  WHERE NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.tenant_id = t.id AND u.is_system_agent = true
  )
  RETURNING id, tenant_id
)
INSERT INTO user_groups (user_id, group_id, tenant_id)
SELECT iu.id, ag.id, iu.tenant_id
FROM inserted_users iu CROSS JOIN agent_group ag
ON CONFLICT (user_id, group_id) DO NOTHING;

-- 3) Menu "Tags da conversa" sob "Configurações" + vínculo aos tenants
-- existentes (todos: tag não é platformOnly).
WITH settings_menu AS (
  SELECT id FROM menus WHERE label = 'Configurações' AND parent_id IS NULL LIMIT 1
),
inserted_menu AS (
  INSERT INTO menus (parent_id, label, icon, path, position)
  SELECT sm.id, 'Tags da conversa', 'tags', 'settings/conversation-tags', 9
  FROM settings_menu sm
  WHERE NOT EXISTS (
    SELECT 1 FROM menus m WHERE m.path = 'settings/conversation-tags'
  )
  RETURNING id
)
INSERT INTO menu_tenants (menu_id, tenant_id)
SELECT im.id, t.id
FROM inserted_menu im CROSS JOIN tenants t
ON CONFLICT (menu_id, tenant_id) DO NOTHING;

-- 4) Visibilidade do menu novo pros grupos admin + manager (matriz global).
WITH new_menu AS (
  SELECT id FROM menus WHERE path = 'settings/conversation-tags' LIMIT 1
)
INSERT INTO menu_groups (menu_id, group_id)
SELECT nm.id, g.id
FROM new_menu nm CROSS JOIN groups g
WHERE g.role_code IN ('admin', 'manager')
ON CONFLICT (menu_id, group_id) DO NOTHING;
```

### 15.4 Rodar migration

```bash
pnpm --filter @elora/db db:migrate
```

### 15.5 Em dev, reseedar pra ter o catálogo de tags + system agent user

```bash
pnpm --filter @elora/db seed
```

### 15.6 Smoke test manual

Subir o core (`pnpm --filter @elora/core dev`), logar no admin do tenant `clinica`, navegar em **Configurações → Tags da conversa** (PR 8 vai trazer a UI; por ora valida via OpenAPI/Postman: `GET /conversation-tags` deve retornar as 5 tags seedadas).

Validar via psql que cada tenant tem um system agent user:
```sql
SELECT t.slug, u.username, u.is_system_agent
FROM users u JOIN tenants t ON t.id = u.tenant_id
WHERE u.is_system_agent = true;
```
Esperado: 1 row por tenant existente, todas com username `system_agent`.

---

## 16. PR 2 — pós-código: passos do usuário

Mudanças de código aplicadas:
- Novo workspace `apps/agent` (espelho de `apps/chat`): `package.json`, `tsconfig.json`, infra shared (logger pino com app=`agent`, sentry, requestContext com `agentTurnId`/`conversationId`, AppError, middlewares de erro, db, redis), `env.ts` com todas as configs (Anthropic, kill switch, rate limits, modelo padrão).
- `shared/anthropic/pricing.ts`: tabela de preços USD/Mtok pros 2 modelos suportados (sonnet-4-6, haiku-4-5) com colunas separadas pra cache_read e cache_creation; `calculateCostCents()` retorna decimal pra coluna `agent_turns.cost_cents`.
- `shared/anthropic/client.ts`: wrapper do SDK com singleton, `cache_control: { type: 'ephemeral' }` automático no último bloco de system + última tool, retry exponencial com jitter pra erros transientes (408/429/5xx/529), log estruturado por call. `pingAnthropic()` faz smoke test mínimo.
- `routes.ts`: 3 endpoints públicos — `GET /health` (db+redis), `GET /agent/kill-switch` (status da config), `GET /agent/diagnostics` (ping Anthropic real — custa ~$0.0001).
- `server.ts`: boot Express + workers placeholder (virão em PR 4+). Default: kill switch ON, agente não roda.

### 16.1 Variáveis de ambiente novas no `.env` do projeto

Adicionar ao `.env` raiz (mesmo arquivo que apps/core e apps/chat lêem):

```env
# Agente IA — apps/agent (V1, 2026-06)
AGENT_PORT=5504
ANTHROPIC_API_KEY=sk-ant-...          # https://console.anthropic.com/settings/keys
AGENT_GLOBAL_KILL_SWITCH=true         # true até go-live no PR 10 (default seguro)
AGENT_DEFAULT_MODEL=claude-sonnet-4-6
AGENT_FAST_MODEL=claude-haiku-4-5
# Opcionais (defaults razoáveis):
# AGENT_MAX_TOOL_ITERATIONS=5
# AGENT_RATE_LIMIT_HOURLY=10
# AGENT_RATE_LIMIT_DAILY=50
# AGENT_TENANT_DAILY_COST_CAP_CENTS=5000
# AGENT_JWT_EXPIRES_SEC=60
# ANTHROPIC_BASE_URL=                 # só se for proxy (Helicone/Langfuse)
# ANTHROPIC_MAX_RETRIES=3
# ANTHROPIC_DEFAULT_MAX_TOKENS=1024
```

### 16.2 Install + boot

```bash
pnpm install                                  # registra apps/agent no workspace
pnpm --filter @elora/agent dev                # tsx watch
```

Saída esperada no console (logger pino do agent):
```
INFO  Sentry inicializado                     # (se SENTRY_DSN setada)
INFO  Redis conectado
INFO  Agent ouvindo em http://localhost:5504
WARN  AGENT_GLOBAL_KILL_SWITCH=true — agente NÃO vai processar nenhuma conversation...
```

### 16.3 Smoke test (3 calls)

```bash
# 1) Liveness
curl http://localhost:5504/health
# → { "status": "ok", "app": "agent", "redis": "ok", ... }

# 2) Config snapshot
curl http://localhost:5504/agent/kill-switch
# → { "globalKillSwitch": true, "defaultModel": "claude-sonnet-4-6", ... }

# 3) Bate na Anthropic — confirma que a key funciona
curl http://localhost:5504/agent/diagnostics
# → { "anthropic": { "ok": true, "model": "claude-haiku-4-5", "latencyMs": 800, "costCents": 0.0001 }, ... }
```

Se `/agent/diagnostics` retorna `ok: true`, o setup do PR 2 está validado: SDK conecta, pricing calcula, retry/error handling estão no lugar. Próximo passo (PR 3) traz o CoreClient + pacote `@elora/agent-contracts`.

### 16.4 O que NÃO está pronto no PR 2 (intencional)

- Endpoint `/openapi.json` (`apps/agent` não expõe API pra Postman ainda — só admin local)
- Auth nos endpoints admin (`/agent/kill-switch`, `/agent/diagnostics` ficam públicos pra facilitar smoke test; PR 9 adiciona gate quando painel de traces entrar)
- Workers BullMQ (PR 4)
- Pacote `@elora/agent-contracts` (PR 3)
- Qualquer interação com Anthropic além do `pingAnthropic()` do diagnostics

---

## 17. PR 3 — pós-código: passos do usuário

Mudanças de código aplicadas:
- Novo workspace `packages/agent-contracts` (skeleton — sem schemas Zod ainda; PR 5+ popula).
- `apps/agent/src/env.ts` ganhou `chatBaseUrl` (`CHAT_INTERNAL_URL`, default `http://localhost:5502`) e `internalHostBase` (`AGENT_INTERNAL_HOST_BASE`, default `localhost`).
- `apps/agent/src/shared/coreClient/`:
  - `jwt.ts` — assina JWT efêmero (exp 60s) `{ userId, tenantId, username }` com o segredo compartilhado do `@elora/auth`. *(V1 usava `email`; alterado com a migração de login por username, arquitetura.md §26.)*
  - `tenantResolver.ts` — cache em memória `tenantId → TenantInfo` (slug, name, agentEnabled, agentIdleMinutes, agentPersona, businessHours, agentUserId, agentEmail). Load lazy via DB direto (`withTenant`); invalidação manual exposta pra futuro endpoint admin.
  - `CoreClient.ts` — interface + types (`CoreClientInfo`, `CoreProcedureInfo`, `CoreFreeSlot`, `CoreAppointmentSummary`, etc).
  - `HttpCoreClient.ts` — impl via `fetch` nativo do Node. Cada call: assina JWT, seta `Host: <slug>.<internalHostBase>:<port>` + `Authorization: Bearer <jwt>` + `X-Agent-Request: true`. Errors mapeados: 401/403 viram 500 (auth bug); 404→404; 5xx→502; 4xx restantes mantêm status.
  - `index.ts` — singleton `coreClient`.
- `apps/agent/src/routes.ts` — `/agent/diagnostics?tenant=<slug>` agora também testa o chain `tenantResolver → JWT → HTTP → core` chamando `GET /procedures`.

### 17.1 Variáveis novas no `.env` (opcionais — defaults razoáveis)

```env
# CHAT_INTERNAL_URL=http://localhost:5502    # já default; só override se chat for em outra porta
# AGENT_INTERNAL_HOST_BASE=localhost         # em prod: elora.app.br
```

### 17.2 Pré-condição

Apps/core precisa estar rodando (porta 5501) pra o smoke test funcionar:

```bash
pnpm --filter @elora/core dev
```

### 17.3 Install + boot

```bash
pnpm install                                  # registra packages/agent-contracts no workspace
pnpm --filter @elora/agent dev
```

### 17.4 Smoke test do chain CoreClient

```bash
curl.exe "http://localhost:5504/agent/diagnostics?tenant=clinica"
```

Saída esperada (campos relevantes):
```json
{
  "anthropic": { "ok": true, ... },
  "core": {
    "ok": true,
    "tenantSlug": "clinica",
    "tenantId": "00000000-...",
    "agentEnabled": false,
    "agentUserResolved": true,
    "proceduresFetched": 0,
    "totalLatencyMs": 35
  },
  ...
}
```

Se `core.ok === true`, o chain inteiro está validado:
1. Lookup do tenant pelo slug funcionou
2. `tenantResolver` carregou tenant info + system agent user do DB
3. `signAgentJwt` assinou token com payload válido
4. `fetch` mandou pro core com Host header sintético
5. `tenantContextMiddleware` do core extraiu slug
6. `ensureAuthenticated` validou JWT (mesmo secret)
7. `loadUserRoles` carregou role=`agent` do system agent user
8. `requirePermission('procedures:read')` aprovou (role agent foi adicionado em PR 1)
9. `ProceduresController.find` rodou e devolveu

`proceduresFetched: 0` é OK se o tenant não tem procedures cadastrados — o teste é do chain de auth, não do conteúdo.

### 17.5 Se algo falhar

- **`Auth do agent rejeitada pelo core (401)`** — JWT_SECRET pode estar diferente entre core e agent. Confere se `.env` é o mesmo (raiz do monorepo).
- **`Tenant <slug> não encontrado`** — slug precisa bater com `tenants.slug` no banco. Lista com: `psql -c "SELECT slug FROM tenants"`.
- **`Tenant ... sem system agent user — backfill incompleto`** — backfill do PR 1 não rodou pra esse tenant. Roda o INSERT do §15.3 manualmente OU re-seeda em dev.
- **`Auth do agent rejeitada pelo core (403)`** — role `agent` não tem `procedures:read`. Confere [permissions.ts](../apps/core/src/shared/permissions/permissions.ts) — a entrada deveria ter `'agent'` na lista.

### 17.6 O que NÃO está pronto no PR 3 (intencional)

- `assignConversationTags` e `sendMessage` — métodos da interface existem mas lançam 501. Implementação real:
  - `assignConversationTags`: PR 5 adiciona endpoint `POST /conversation-tags/assignments` no core
  - `sendMessage`: PR 6 wire na tool e chama `POST /conversations/:id/messages` no chat
- Tools do LLM em `@elora/agent-contracts` — pacote existe vazio até PR 5
- Endpoint admin pra invalidar tenant cache — PR 8 (UI de config) adiciona quando admin editar config

### 17.7 Gotcha resolvido durante a implementação

`Host` é header proibido na spec WHATWG do fetch — Node ignora silenciosamente qualquer override e usa o hostname do URL. Setamos `Origin` em vez disso porque é header livre, e o `tenantContextMiddleware` do core já consome Origin antes de Host na resolução do tenant (mecânica desenhada pro cross-origin do browser, reaproveitada aqui). Comentário no [HttpCoreClient.ts](../apps/agent/src/shared/coreClient/HttpCoreClient.ts) marca a decisão.

---

## 18. PR 4 — pós-código: passos do usuário

Mudanças de código aplicadas:
- `apps/agent/src/shared/redis/redis.ts` ganhou cliente dedicado `redisSubscriber` (`.duplicate()` da config principal, padrão idêntico ao apps/core — ioredis bloqueia comandos normais no client subscrito).
- `apps/agent/src/shared/workers/agentTrigger/` (queue + worker + types + index): fila BullMQ `agent-trigger`, jobId determinístico `agent-trigger-{conversationId}`, helpers `scheduleAgentTrigger(data, delayMs)` (remove + add pra resetar timer) e `cancelAgentTrigger(convId)`. Worker (concurrency 3, attempts 2, backoff exp 5s) **só loga** o que faria; AgentRunner real chega no PR 5.
- `apps/agent/src/modules/triggers/`:
  - `OutOfHoursDetector.ts` — `isOpenNow(businessHours, now?)`. Timezone-aware via `Intl.DateTimeFormat`; null businessHours = sempre "em horário" (idle-only). Janela `open <= now < close`, múltiplas janelas no dia OR entre si.
  - `IdleTriggerScheduler.ts` — orquestrador. `handleInbound(ctx)`: gate kill switch + agent_enabled + OutOfHoursDetector → enfileira com delay 0 (out_of_hours) ou idle*60_000 (idle). `handleHumanReply(ctx)`: cancela trigger pendente exceto quando author = system agent user.
  - `InboundSubscriber.ts` — assina `wa.message.received` → delega ao scheduler.
  - `HumanReplyCanceller.ts` — assina `message.created` → delega ao scheduler.
  - `index.ts` — `startTriggers()` / `stopTriggers()` em ordem (worker antes, subscribers depois; shutdown invertido).
- `apps/agent/src/server.ts` chama `startTriggers()` no listen callback e `stopTriggers()` no graceful shutdown.

### 18.1 Pré-requisitos pro smoke test

- Apps/chat e apps/core rodando (canal WhatsApp recebendo inbound real OU MockAdapter ativo).
- Tenant com `agent_enabled = true`. Pra ligar via psql:
  ```sql
  UPDATE tenants SET agent_enabled = true, agent_idle_minutes = 1
  WHERE slug = 'clinica';
  ```
  (idle de 1 min facilita observar o disparo sem esperar 15)
- Tenant cache do agent invalida automaticamente no próximo restart, OU rebootar o agent depois do UPDATE pra garantir.

### 18.2 Boot

```bash
pnpm --filter @elora/agent dev
```

Log esperado no boot:
```
INFO  Agent ouvindo em http://localhost:5504
WARN  AGENT_GLOBAL_KILL_SWITCH=true — triggers enfileiram, worker recebe e drop sem ação...
INFO  [agentTriggerWorker] iniciado
INFO  [inboundSubscriber] iniciado  { channel: 'wa.message.received' }
INFO  [humanReplyCanceller] iniciado  { channel: 'message.created' }
```

### 18.3 Smoke test (4 cenários)

**Importante**: o kill switch global está em **dois níveis** — `IdleTriggerScheduler` (early skip antes de enfileirar) e `agentTriggerWorker` (late drop quando job dispara). Pros cenários A e B validarem o pipeline completo de enqueue/cancel, **temporariamente** seta `AGENT_GLOBAL_KILL_SWITCH=false` no `.env`. Depois de validar, **volta pra `true`** — esse é o estado seguro até PR 10.

**Cenário 0 — kill switch global bloqueia cedo (estado padrão):**
1. Com `AGENT_GLOBAL_KILL_SWITCH=true`, manda inbound.
2. Log:
   ```
   DEBUG [inboundSubscriber] inbound ignorado  { reason: 'global_kill_switch' }
   ```
3. Nada vai pra fila — gate cedo cumprido.

**Cenário A — inbound de cliente dispara enqueue (kill switch OFF):**
1. `AGENT_GLOBAL_KILL_SWITCH=false`, restart do agent.
2. Mandar inbound pra cliente no tenant `clinica`.
3. Log imediato:
   ```
   DEBUG [idleTriggerScheduler] inbound → trigger agendado  { triggerType: 'idle', delayMs: 60000 }
   DEBUG [agentTriggerQueue] enfileirado
   ```
4. Após 60s (com `agent_idle_minutes = 1`):
   ```
   INFO  [agentTriggerWorker] would trigger AgentRunner here (PR 5+)
   ```

**Cenário B — humano respondeu antes do trigger disparar (kill switch OFF):**
1. Mesma mensagem inbound (enfileira).
2. Antes dos 60s passarem, manda outbound via UI do chat (POST /conversations/:id/messages, qualquer staff user).
3. Log:
   ```
   INFO  [idleTriggerScheduler] humano respondeu — trigger cancelado
   ```
4. Aos 60s, NADA acontece — job foi removido da fila.

**Cenário C — tenant sem `agent_enabled`:**
1. `UPDATE tenants SET agent_enabled = false WHERE slug = 'clinica';` + restart do agent (limpar cache).
2. Inbound novo.
3. Log:
   ```
   DEBUG  [inboundSubscriber] inbound ignorado  { reason: 'tenant_disabled' }
   ```

### 18.4 Validar BullMQ no Redis

Pra confirmar que o job foi enfileirado:
```bash
redis-cli KEYS 'bull:agent-trigger:*'
# Esperar ver chaves como bull:agent-trigger:delayed, bull:agent-trigger:waiting, etc.
```

Pra inspecionar um job específico (jobId conhecido):
```bash
redis-cli HGETALL 'bull:agent-trigger:agent-trigger-<conversationId>'
```

### 18.5 O que NÃO está pronto no PR 4 (intencional)

- AgentRunner — worker só loga o "would trigger" (PR 5 substitui).
- Conexão com tools / Anthropic dentro do trigger — kill switch global e ausência do runner garantem zero custo de IA.
- Endpoint admin pra invalidar tenant cache — restart é o caminho até PR 8 (UI de config) trazer o endpoint.
- Gate `conversations.agent_paused_until` no worker — entra no PR 6 junto com a UI de "Assumir conversa".

---

## 19. PR 5 — pós-código: passos do usuário

Mudanças aplicadas:

**`packages/events-contracts`**: novo canal `conversationTagsUpdated` (`conversation.tags_updated`) + interface `ConversationTagsUpdatedEvent` (tenantId, conversationId, tagIds, source: 'agent'|'human', agentTurnId, updatedAt).

**`apps/core/src/modules/conversationTags`**:
- Novo endpoint `POST /conversation-tags/assignments` em **modo REPLACE** (body: `{ conversationId, tagIds[], agentTurnId? }`). Permissão `conversationTags:write` já cobre role `agent`.
- Service valida que todos os `tagIds` existem + estão ativos (RLS filtra por tenant). Body inválido → 400 com `missing` no detail.
- Em sucesso, publica `conversation.tags_updated` via core's eventBus.
- Source inferida: `agent` se `agentTurnId` preenchido; `human` caso contrário.

**`apps/core/src/shared/realtime/redisSubscriber.ts`**: canal novo no array subscrito + dispatch case (forward pra sala da conversa + sala do tenant).

**`apps/agent/src/shared/coreClient/HttpCoreClient.ts`**: `assignConversationTags` agora implementa (era stub 501).

**`apps/agent/src/modules/tools/`** (novo módulo):
- `types.ts` — `ToolDefinition`, `ToolHandlerContext`, `ExecutedToolCall`.
- `definitions/tagConversation.ts` — schema JSON pro LLM + validador Zod + handler que chama `coreClient.assignConversationTags`.
- `ToolRegistry.ts` — registry estático (1 tool por enquanto).
- `executeToolCall.ts` — valida input com Zod, chama handler, NUNCA lança (erro vira `ExecutedToolCall` com `result: 'error'`).

**`apps/agent/src/modules/prompts/`** (novo módulo):
- `versions/classifier.v1.ts` — `prompt_version = 'classifier.v1'`. System prompt curto, tags listadas como `<UUID> | "<name>"\n  Aplicar quando: <agentInstruction>`.
- `PromptBuilder.ts` — `PromptBuilder.classifier({tenantName, tags, history})` retorna `{ promptVersion, system, messages[] }`. História formatada como `[ISO | cliente|atendente|nota interna] body`.

**`apps/agent/src/modules/conversations/`** (novo módulo):
- `ContextBuilder.ts` — carrega tudo do DB direto via `withTenant`: conversation + cliente + últimas 30 mensagens (com `users` join pra nome do atendente) + tags ativas com `agentInstruction`. Filtra tags humano-only.
- `AgentTurnsRepo.ts` — INSERT em `agent_turns` (append-only).
- `AgentRunner.ts` — orquestra a rodada: pre-gera `agentTurnId` UUID, carrega contexto, chama Anthropic com `tool_choice: { type: 'tool', name: 'tagConversation' }`, executa tool, persiste turn. `finally` garante turn salvo mesmo em erro (com `error` populado). `requestContextStorage.run()` propaga agentTurnId pros logs.

**`apps/agent/src/shared/workers/agentTrigger/worker.ts`**: substitui o log "would trigger" pela chamada real `AgentRunner.run(jobData)`.

### 19.1 Pré-requisitos pro smoke test

- Tenant com `agent_enabled = true` E pelo menos 1 tag em `conversation_tags` com `agent_instruction` não-vazio. O seed do PR 1 cria 5 tags pro tenant `clinica` com instruções — está pronto.
- `AGENT_GLOBAL_KILL_SWITCH=false` no `.env` (agora vai chamar Anthropic — custo ~$0.005 por turn).
- `ANTHROPIC_API_KEY` válida com saldo.
- Core + chat + agent rodando.

### 19.2 Smoke test do classificador

1. Manda mensagem inbound real de um cliente (ex.: "Oi, quanto custa laser virilha?").
2. Espera idle (60s com `agent_idle_minutes = 1`).
3. Log esperado do agent:
   ```
   INFO  [agentTriggerWorker] disparando AgentRunner
   INFO  [agentRunner] turn iniciado  { agentTurnId: 'abc...', triggerType: 'idle' }
   DEBUG [anthropic] createMessage ok  { model: 'claude-sonnet-4-6', inputTokens: 800, outputTokens: 40, costCents: 0.0030 }
   DEBUG [executeToolCall] ok  { tool: 'tagConversation' }
   INFO  [agentRunner] turn ok  { agentTurnId, totalLatencyMs: 1800, costCents: 0.0030, appliedTagsCount: 2 }
   ```
4. Log esperado do core:
   ```
   POST /conversation-tags/assignments  →  200
   DEBUG [eventBus] publish conversation.tags_updated
   ```

### 19.3 Validar persistência

```sql
-- Turno persistido
SELECT id, trigger_type, model, prompt_version, input_tokens, output_tokens,
       cost_cents, latency_ms, classification_tag_ids, error
FROM agent_turns ORDER BY created_at DESC LIMIT 5;

-- Assignments aplicadas (replace mode — só as do último turn ficam)
SELECT a.conversation_id, t.name, a.assigned_by_agent_turn_id, a.assigned_at
FROM conversation_tag_assignments a
JOIN conversation_tags t ON t.id = a.tag_id
WHERE a.conversation_id = '<id>';
```

### 19.4 Cenário de erro esperado

Se você passar um tagId inválido no prompt (LLM alucinou), o flow se comporta assim:
- `assignConversationTags` → core devolve 400 com `{ missing: [...] }`
- `executeToolCall` captura → `ExecutedToolCall.result = 'error'`
- `AgentRunner` registra turn com `error`, custos preservados, classificationTagIds=null
- Cliente NÃO recebe nada (PR 5 não responde mesmo).

Tags só somem dos chips se LLM passou array vazio — não confunde com erro.

### 19.5 O que NÃO está pronto no PR 5 (intencional)

- **Agente não responde ao cliente** — só classifica. Resposta de texto chega no PR 6.
- **Loop de tool_use → tool_result → re-call** — PR 5 fecha em 1 call (tool_choice forçada). PR 6 abre o loop pra conversa real.
- **Pacote `@elora/agent-contracts` populado** — continua skeleton. Tools moram no agent. Promove quando PR 6 trouxer múltiplas tools que core também precisa validar.
- **UI de chips no chat** — backend publica `conversation.tags_updated`, mas frontend ainda não escuta. PR 8 cobre.
- **Rate limits / cost cap** — sem teto V1. PR 10 adiciona.
- **Pause por conversation** — PR 6 cria coluna + checagem no AgentRunner.

---

## 20. PR 6 — pós-código: passos do usuário

Mudanças aplicadas:

**Schema** ([packages/db/src/schema.ts](../packages/db/src/schema.ts))
- `conversations.agent_paused_until timestamp nullable` — coluna nova. Default NULL = agente ativo.

**CoreClient** ([HttpCoreClient.ts](../apps/agent/src/shared/coreClient/HttpCoreClient.ts))
- `sendMessage` implementado (era stub 501). POST `/conversations/:id/messages` no apps/chat com body `{ kind: 'text', body }`.
- `listProcedures` mapping corrigido: lê `defaultPrice` (string "450.00") + multiplica por 100 → `priceCents`; expõe `defaultSessions`. Antes assumia `priceCents` direto que nunca vinha do core.

**Tools novas** ([apps/agent/src/modules/tools/definitions/](../apps/agent/src/modules/tools/definitions/))
- `getClientInfo` — sem input; retorna `{id, name, phoneE164}` do client da conversa (via CoreClient HTTP).
- `getProcedureInfo({search?})` — lista procedimentos ativos do tenant com nome, descrição, `priceCents`, `defaultSessions`.
- `getBusinessHours` — retorna horário + `isOpenNow`; quando `tenant.businessHours = null`, devolve `configured: false` pro LLM dizer "não sei" em vez de inventar.
- `handoffToHuman({reason, urgency?})` — escreve `conversations.agent_paused_until = now + 1h` direto no DB (withTenant); registra reason pro `agent_turns.handoff_reason`.

**ResponseDispatcher** ([ResponseDispatcher.ts](../apps/agent/src/modules/conversations/ResponseDispatcher.ts))
- `sendText(tenantId, conversationId, body)` — envia 1 mensagem de texto via CoreClient e retorna `{id, body, createdAt}` pro AgentRunner coletar em `outputMessageIds`.

**PromptBuilder** ([PromptBuilder.ts](../apps/agent/src/modules/prompts/PromptBuilder.ts) + [versions/conversational.v1.ts](../apps/agent/src/modules/prompts/versions/conversational.v1.ts))
- Novo modo `PromptBuilder.conversational({tenantName, tenantPersona, tags, procedures, client, history})`.
- `prompt_version = 'conversational.v1'`. System inclui catálogo + tags + regras (NÃO marca agendamento, sempre tagConversation no início, handoff em casos sensíveis).

**ContextBuilder** ([ContextBuilder.ts](../apps/agent/src/modules/conversations/ContextBuilder.ts))
- Agora carrega `procedures` (ativos, RLS-filtered) + `pausedUntil` da conversation.

**AgentRunner** ([AgentRunner.ts](../apps/agent/src/modules/conversations/AgentRunner.ts)) — refatoração grande
- **Pause check** logo após `ContextBuilder.load`: se `pausedUntil > now`, retorna sem chamar Anthropic (turn persistido com `error: 'Agente pausado até ...'`).
- **Modo conversational**: monta prompt + 5 tools (tagConversation, getClientInfo, getProcedureInfo, getBusinessHours, handoffToHuman) — SEM `tool_choice` forçado, agente decide.
- **Loop tool_use → tool_result**: até `stop_reason === 'end_turn'` OU `iter === maxToolIterations` (5). Anexa `assistant.content` + `user.content (tool_result)` a cada iteração.
- **Envia texto** quando o loop fecha: cada `TextBlock` da resposta final vira uma `messages` outbound separada via `ResponseDispatcher.sendText`.
- **Agregação**: tokens/custo/latência somados across iterations; tool_calls acumulados; handoffReason capturado da tool `handoffToHuman`.

### 20.1 Pré-requisitos

```bash
pnpm --filter @elora/db db:generate
```

Editar a migration gerada — `conversations.agent_paused_until` é só `ADD COLUMN`, sem FORCE RLS pendente (conversations já tinha RLS forçado). Migration esperada: 1 linha
```sql
ALTER TABLE "conversations" ADD COLUMN "agent_paused_until" timestamp;
```

```bash
pnpm --filter @elora/db db:migrate
```

### 20.2 Tenant config

Em dev no tenant `clinica`, opcionalmente preencher `business_hours` pra testar `getBusinessHours`:

```sql
UPDATE tenants
SET business_hours = '{
  "timezone": "America/Sao_Paulo",
  "schedule": [
    { "dayOfWeek": 1, "open": "09:00", "close": "18:00" },
    { "dayOfWeek": 2, "open": "09:00", "close": "18:00" },
    { "dayOfWeek": 3, "open": "09:00", "close": "18:00" },
    { "dayOfWeek": 4, "open": "09:00", "close": "18:00" },
    { "dayOfWeek": 5, "open": "09:00", "close": "18:00" }
  ]
}'::jsonb,
agent_persona = 'Você é gentil, próximo e direto. Pode usar "você" mas evita gírias.'
WHERE slug = 'clinica';
```

Restart do agent depois (tenantResolver cacheia config no boot).

### 20.3 Smoke test conversacional

**Cenário A — pergunta de preço:**
1. Inbound do cliente: "Quanto custa laser de virilha?"
2. Após 60s, agent dispara.
3. Log esperado:
   ```
   INFO  [agentRunner] turn iniciado
   DEBUG [anthropic] createMessage ok  (1ª call — tool_use tagConversation + getProcedureInfo)
   DEBUG [coreClient] ok POST /conversation-tags/assignments
   DEBUG [coreClient] ok GET /procedures
   DEBUG [executeToolCall] ok  { tool: 'tagConversation' }
   DEBUG [executeToolCall] ok  { tool: 'getProcedureInfo' }
   DEBUG [anthropic] createMessage ok  (2ª call — stop_reason=end_turn, texto)
   DEBUG [coreClient] ok POST /conversations/:id/messages
   DEBUG [responseDispatcher] outbound enviada
   INFO  [agentRunner] turn ok  { outputMessagesCount: 1, appliedTagsCount: 2 }
   ```
4. Cliente recebe resposta tipo: "Olá! O laser de virilha sai R$ 150 por sessão (pacote de 6 sessões). Quer agendar uma avaliação?"

**Cenário B — pedido pra falar com alguém:**
1. Inbound: "Quero falar com a recepção."
2. Agent dispara. Log mostra `handoffToHuman` chamada → `handoff_reason = "cliente_quer_falar_humano"` (ou similar).
3. Cliente recebe resposta: "Claro, vou pedir pra alguém da equipe te atender. Em breve."
4. SQL: `SELECT agent_paused_until FROM conversations WHERE id = '<id>'` → ~now + 1h.

**Cenário C — segundo inbound DURANTE pausa:**
1. Continua o Cenário B.
2. Cliente manda nova mensagem antes do pause expirar.
3. InboundSubscriber enfileira o trigger normalmente.
4. Worker dispara após idle delay.
5. `AgentRunner.run` chama `ContextBuilder.load`, vê `pausedUntil > now`, log:
   ```
   INFO  [agentRunner] skip — conversa pausada  { pausedUntil: ... }
   ```
6. Turn persistido com `error: 'Agente pausado até ...'`, custo zero (sem call Anthropic).

### 20.4 Validar persistência

```sql
-- Turno do PR 6 inclui múltiplas calls + tool calls
SELECT id, prompt_version, model, input_tokens, output_tokens, cost_cents,
       latency_ms, jsonb_array_length(tool_calls) AS tool_call_count,
       array_length(output_message_ids, 1) AS outbound_count,
       handoff_reason, error
FROM agent_turns
ORDER BY created_at DESC LIMIT 5;
```

### 20.5 O que NÃO está pronto no PR 6 (intencional)

- **`searchAvailableSlots`** — adiada pra PR 7 junto com o fluxo completo de agendamento (proposeAppointment + confirmAppointment com 2 fases).
- **UI** — bolha com badge "IA", botão "Assumir conversa", indicador de pausa: PR 8.
- **Endpoint pra invalidar tenant cache** quando admin editar config — PR 8.
- **Rate limits / cost cap** — PR 10.
- **Cancel automático do trigger quando o próprio agente envia** — não precisa: `HumanReplyCanceller` já detecta `authorUserId === systemAgentUserId` e mantém o job (`'authored_by_agent'`).

### 20.6 Bugs corrigidos durante a validação do PR 6

- **`maxTokens` vazando pra Anthropic** (PR 2 latente) — `...input` no createMessage incluía o campo camelCase custom; Anthropic rejeita extra fields com 400. Fix: destructure `model` + `maxTokens` antes do spread.
- **`Host` header é forbidden no fetch nativo do Node** (PR 3) — qualquer override silencioso. Trocado por `Origin`, que o `tenantContextMiddleware` do core já consome ANTES de Host.
- **Backtick dentro de template literal** ([conversational.v1.ts](../apps/agent/src/modules/prompts/versions/conversational.v1.ts)) — fechou a string prematuramente. Trocado por aspas duplas.
- **`host is not defined`** ReferenceError no logger de erro do HttpCoreClient — uma linha do log ficou stale após o rename `host`→`origin`. Cosmético, mas mascarava o root cause abaixo.
- **FK violation em `conversation_tag_assignments.assigned_by_agent_turn_id`** — `agent_turns` era inserido só no `finally`, mas tools (especialmente `tagConversation`) referenciam o `agent_turn_id` durante a rodada. Refator: `AgentTurnsRepo.createPlaceholder` cedo (logo após pause check) + `AgentTurnsRepo.finalize` no fim. Defaults da tabela cobrem campos não-conhecidos no momento do placeholder.

---

## 21. Pausa em 2026-06-17 — estado atual e como retomar

Trabalho pausado pra fase de teste/refinamento. Próxima sessão pega daqui.

### 21.1 O que está em pé end-to-end

**Pipeline funcional**: cliente manda WhatsApp → `apps/chat` persiste + publica `wa.message.received` → `apps/agent` enfileira trigger BullMQ → após `tenant.agentIdleMinutes` (idle) OU imediato (fora do horário) → worker dispara `AgentRunner` → contexto carregado (DB) → loop tool_use/tool_result com Anthropic Sonnet 4.6 → resposta de texto enviada via `apps/chat` → outbound entrega WhatsApp.

**Tools registradas** ([modules/tools/definitions/](../apps/agent/src/modules/tools/definitions/)):
| Tool | Faz | Side effect |
|---|---|---|
| `tagConversation` | classifica conversa (REPLACE no conjunto de tags) | HTTP `POST /conversation-tags/assignments` no core; publica `conversation.tags_updated` |
| `getClientInfo` | retorna `{id, name, phoneE164}` do cliente da conversa | HTTP `GET /clients/:id` |
| `getProcedureInfo` | lista procedimentos ativos (com `priceCents` + `defaultSessions`) | HTTP `GET /procedures` |
| `getBusinessHours` | retorna horário + `isOpenNow`; `configured: false` quando ausente | sem side effect (cache do tenantResolver) |
| `handoffToHuman` | pausa agente por 1h + registra reason | UPDATE `conversations.agent_paused_until` |

**Triggers**:
- `wa.message.received` no Redis → `InboundSubscriber` → `IdleTriggerScheduler.handleInbound`
- `message.created` no Redis → `HumanReplyCanceller` → cancela job (exceto se author = system agent)

**Guardrails ativos no PR 6**:
- `AGENT_GLOBAL_KILL_SWITCH=true` desliga tudo
- `tenant.agent_enabled=false` skip silencioso por tenant
- `conversations.agent_paused_until > now` skip antes de gastar token de IA
- `tagConversation` valida tagIds via Zod + RLS no core
- `AgentTurnsRepo.createPlaceholder` cedo + `finalize` no fim — sem janela de FK violation
- `executeToolCall` nunca lança — erro de tool vira `tool_result.is_error: true` pro LLM se recuperar

**Custo observado** (Sonnet 4.6, cache caching ativo no PR 6):
- ~1 cent USD por turn com 2-3 calls Anthropic + tool calls
- `cacheReadTokens` ~2000-4000 (cache HIT em system + tools)
- Estimativa pra clínica média: < $3/mês

### 21.2 Como subir o ambiente (refresher)

```bash
# 1. Subir infra
pnpm infra:up   # Postgres + Redis + MinIO

# 2. Build/migrate quando schema mudou
pnpm db:migrate
pnpm db:seed    # opcional — re-popula dados de demo

# 3. Subir tudo (core + chat + agent + frontend)
pnpm dev
```

`.env` obrigatório pro agente:
```env
ANTHROPIC_API_KEY=sk-ant-...
AGENT_GLOBAL_KILL_SWITCH=false  # true em prod até PR 10
```

Tenant `clinica` com agente ligado:
```sql
UPDATE tenants
SET agent_enabled = true,
    agent_idle_minutes = 1,
    agent_persona = 'Você é gentil, próximo e direto. Pode usar "você" mas evita gírias.',
    business_hours = '{"timezone":"America/Sao_Paulo","schedule":[
      {"dayOfWeek":1,"open":"09:00","close":"18:00"},
      {"dayOfWeek":2,"open":"09:00","close":"18:00"},
      {"dayOfWeek":3,"open":"09:00","close":"18:00"},
      {"dayOfWeek":4,"open":"09:00","close":"18:00"},
      {"dayOfWeek":5,"open":"09:00","close":"18:00"}
    ]}'::jsonb
WHERE slug = 'clinica';
```

Restart o agent depois (tenantResolver cacheia no boot).

### 21.3 O que dá pra refinar sem mexer em estrutura

Áreas de iteração rápida sem migration / sem refactor:

- **Prompt conversacional** — [conversational.v1.ts](../apps/agent/src/modules/prompts/versions/conversational.v1.ts). Mudou? Cria `conversational.v2.ts` + atualiza import em [PromptBuilder.ts](../apps/agent/src/modules/prompts/PromptBuilder.ts). Cada versão registra em `agent_turns.prompt_version` automaticamente — bom pra A/B futuro.
- **Persona por tenant** — campo `tenants.agent_persona` (texto livre) é injetado no system prompt. Editável via SQL ou (futuro PR 8) UI.
- **Tags + agentInstruction** — endpoint REST já existe (`/conversation-tags`). Editar instrução muda direto o que o LLM vê. Tags com `agent_instruction` vazio = humano-only.
- **`agent_idle_minutes`** — quanto tempo esperar antes do agente assumir.
- **Modelo** — `AGENT_DEFAULT_MODEL=claude-haiku-4-5` no `.env` baratea ~3x (mais simples mas menos bom em raciocínio). Útil pra smoke test em escala.

### 21.4 Pontos de atenção pra observar nos testes

- **`cacheReadTokens` aparecendo** — confirma que prompt caching está ativo. Sem cache, custo dobra.
- **`appliedTagsCount`** — se o LLM nunca aplica tags, revisar `agent_instruction` (talvez restritivas demais).
- **`stopReason`** no log do `[anthropic] createMessage ok` — `end_turn` = ok; `max_tokens` = truncou resposta (subir `maxTokens` no AgentRunner); `tool_use` no meio de loop é esperado.
- **`drift_ms`** no `[agentTriggerWorker] disparando AgentRunner` — deve estar próximo de `idle_minutes * 60_000`. Drift grande = worker concurrency baixa, jobs empilhando.
- **Latência** — turn típico hoje: 2-10s. Pra > 30s investigar (Anthropic lento OU tool HTTP lenta OU loop atingindo iterations).

### 21.5 O que vem depois (resumo)

- **PR 7 — Agendamento em 2 fases**: tabela `agent_proposals` + tool `searchAvailableSlots` + `proposeAppointment` + `confirmAppointment` com idempotency_key. Agente passa a marcar de fato.
- **PR 8 — UI**: tag chips na conversa (já temos socket `conversation.tags_updated`), badge "IA" nas bolhas outbound (`authorUserId === systemAgentUserId`), botão "Assumir conversa" (POST que seta `agent_paused_until`), página de config do agente em Settings.
- **PR 9 — Painel de traces + observabilidade**: `/agente/traces` lista `agent_turns` com filtros (custo, erro, handoff), Sentry context, aggregação diária por tenant.
- **PR 10 — Go-live**: rate limit Redis por conversation + hard cap diário por tenant + smoke test em piloto + `AGENT_GLOBAL_KILL_SWITCH=false` em prod.

Plano detalhado de cada um já vive nas §7-13 deste doc — quando retomar, atualizar o checklist da §14 conforme PR for fechando.
