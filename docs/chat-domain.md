# Chat & Jornada do Cliente — Modelo de Domínio

> Documento fonte-de-verdade pra como o Elora modela o ciclo de vida do cliente (`lead → evaluation → sale → treatment → result`) e como o canal WhatsApp alimenta esse ciclo. Toda decisão de schema, UX e automação se ancora aqui. Quando algo nesse documento mudar, atualize a entrada e propague pro schema/serviços.

---

## 1. Contexto e motivação

O par Corpo-Bueno + Chatwoot, hoje em produção, sofre de três dores estruturais:

1. **Duas verdades parciais.** Corpo-Bueno tem clientes/agenda/orçamentos. Chatwoot tem conversas/contatos/atribuições. A integração reaminetada pelo banco gera inconsistências silenciosas.
2. **Schema do Chatwoot genérico demais.** "Plataforma de chat genérica" não enxerga "ciclo de cliente de clínica de estética". Automações e métricas reais ficam inviáveis sem reescrever lógica em SQL bruto.
3. **Conhecimento operacional fragmentado.** Equipe aprende dois sistemas, alterna abas, mantém duas mentes sobre o mesmo cliente.

O Elora rompe esse padrão modelando o **domínio** primeiro e tratando o WhatsApp como **transporte**. A conversa é fonte de evento, não a entidade-mãe.

---

## 2. Princípios fundadores

1. **Jornada é a entidade-mãe.** Cliente, conversa e mensagem orbitam jornada. Métricas comerciais (conversão, ticket, ciclo de fechamento) saem de `journeys`, não de `conversations`.
2. **1 cliente → N jornadas.** Reaproveitamento é proposta-core do produto. Cliente que fez laser axila em 2024 e volta em 2026 pra facial tem **duas jornadas independentes** com **um histórico unificado** dentro do mesmo canal.
3. **Conversa é por (cliente, canal-whatsapp).** *Atualizado 2026-05.* Cada par (cliente, canal) tem **sua própria conversation**, separada. Mesma pessoa que falou com 2 números da clínica = 2 conversations distintas. Justificativa: cada canal tem identidade própria (número, equipe, cor, lifecycle de pareação), histórico misturado confunde a operação. Cada mensagem tem `journey_id` opcional pra filtragem e distinção visual.
4. **Estágios são fixos (enum), origens são abertas (jsonb).** Os 5 estágios cobrem o ciclo comercial; o `source_metadata` absorve qualquer fonte de lead presente ou futura.
5. **Etapas opcionais via config do tenant.** Avaliação obrigatória por default, mas pulável (`tenants.skip_evaluation = true`). Quando o flag está `false`, jornadas que pulam avaliação ainda são aceitas — o sistema apenas emite alerta no log (operação não-padrão, não bloqueada).
6. **3 níveis de controle de conversa.** Lembretes automáticos (admin configura) + templates sugeridos (atendente decide) + guard rails (app impõe). Cada nível tem seu lugar.

---

## 3. Visão de conjunto

```
clients (1) ────────── (N) journeys ──── current stage [enum]
   │                       │
   │                       ├─ source         enum: whatsapp | form | sheets | manual | recycling | ...
   │                       ├─ source_metadata jsonb
   │                       ├─ status         enum: active | won | lost
   │                       ├─ created_at, closed_at
   │                       │
   │                       ├─ (N) journey_events             audit trail de transições
   │                       ├─ (N) evaluations                eventos clínicos de avaliação
   │                       │           └─ (0..N) client_forms        1 por (evaluation, form_template)
   │                       │                     └─ (N) form_answers uma resposta por pergunta
   │                       ├─ (N) appointments               agenda unificada (kind=evaluation|procedure)
   │                       ├─ (N) quotes                     + origin: evaluation | referral | direct_sale
   │                       ├─ (0..N) treatments        + status: active | completed | abandoned | manually_closed
   │                       │           │
   │                       │           └─ (M:N) procedure_sessions  via treatment_procedures
   │                       │
   │                       └─ (0..1) active_in_conversation   indica qual jornada está "em foco" no chat
   │
   └─ (N) conversations                         1 por par (cliente, whatsapp_channel)
              ├─ whatsapp_channel_id            FK — canal de origem (cor, nome, lifecycle)
              └─ (N) messages                   cada uma com journey_id opcional

whatsapp (transporte — arquitetura.md §7)
   ├─ whatsapp_channels                          + connection_state, color
   ├─ whatsapp_contacts ◄────►  clients (link N:1 quando aplicável)
   ├─ whatsapp_conversations ◄────► conversations  (1:1 por par cliente×canal)
   └─ whatsapp_messages ◄────► messages  (1:1 quando a msg veio do WhatsApp)

regras
   ├─ automations               rule + trigger + template + filtros (stage, source, etc.)
   ├─ recycling_rules           caso especial — segmento que gera novas journeys
   └─ message_templates         body + variáveis + surface_in_stage[]

catálogo (por tenant)
   ├─ form_templates            ficha cadastrada pela clínica (ex: "Avaliação Laser")
   │     └─ (N) form_questions  perguntas do template
   └─ procedures                catálogo de procedimentos (laser X, facial Y...)
```

---

## 4. Entidades

### 4.1 `clients`

Entidade da pessoa física. Independente de quantas jornadas tenha.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `name` | varchar | Obrigatório no lead já |
| `phone_e164` | varchar | Chave de matching com WhatsApp contact |
| `email` | varchar | Opcional no lead, obrigatório pós-avaliação (se a clínica usa avaliação) |
| `birth_date` | date | Preenchido na avaliação, opcional |
| `notes` | text | Observações livres da recepção |
| `active` | boolean | Soft delete / arquivamento |
| timestamps | | |

**Profile básico vs profile rico**: `clients` guarda só o suficiente pra falar com a pessoa. Dados clínicos densos (fototipo, contraindicações, anamnese) ficam em [`client_forms`](#43-fichas-form_templates--form_questions--client_forms--form_answers) — instâncias preenchidas a partir de templates configurados pelo tenant.

### 4.2 `journeys`

Cada "venda completa rastreável". Onde mora o estágio, a origem, o resultado.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `client_id` | uuid | FK |
| `stage` | enum | `lead`, `evaluation`, `sale`, `treatment`, `result` |
| `source` | enum | `whatsapp`, `form`, `sheets`, `manual`, `recycling`, `imported`, `other` |
| `source_metadata` | jsonb | Payload da origem — flexível por fonte |
| `status` | enum | `active`, `won`, `lost` |
| `lost_reason` | varchar | Quando `status = lost`. Enum interno: `no_show`, `price`, `disqualified`, `timeout`, etc. |
| `last_activity_at` | timestamp | Atualizado por qualquer ação de staff (mensagem outbound, quote editado, agendamento criado/movido, transição de stage). **Não** muda em inbound do cliente. Base pra fila manual de orçamentos parados e pra `recycling_rules` por inatividade |
| `created_at`, `closed_at` | timestamps | |

**source_metadata** — exemplos:
- `source=whatsapp` → `{ first_message_id, channel_id, contact_phone }`
- `source=form` → `{ form_provider: "RD Station", form_id, lead_data }`
- `source=sheets` → `{ sheet_id, row_number, imported_at }`
- `source=recycling` → `{ recycling_rule_id, previous_journey_id }`

**Por que `status` separado de `stage`**: estágio é onde-estou-no-funil. Status é resultado-final. Uma journey pode estar `stage=sale` + `status=active` (ainda fechando) ou `stage=sale` + `status=lost` (cliente recusou orçamento).

### 4.3 Fichas (`form_templates` + `form_questions` + `client_forms` + `form_answers`)

Modelo de questionário reutilizável adaptado do `anamneses` do Corpo-Bueno. Tenant cadastra **N templates** de ficha (cada um com suas perguntas); cada `evaluation` (avaliação clínica — ver §4.4) tem **1 ficha por template** preenchido naquela ocasião. Reavaliação = nova `evaluation` = novo conjunto de fichas, preservando o histórico evolutivo (ex: comparar fototipo declarado na avaliação inicial vs reavaliação 6 meses depois).

> **Decisão revisada em 2026-05-25**: ancoragem das fichas mudou de `client_id` pra `evaluation_id`. Modelo anterior tinha unique `(client_id, form_template_id)` — atualizar ficha sobrescrevia o passado. Modelo atual preserva snapshot por evento clínico. Migration: `client_forms_evaluation_template_unique` substitui `client_forms_client_template_unique`.

```
tenant ─→ (N) form_templates ─→ (N) form_questions
                                        ▲
client ─→ (N) evaluations ─→ (0..N) client_forms ─→ (N) form_answers
                              [unique:                       │
                               evaluation × template]        └── FK pra form_questions
```

**`form_templates`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `name` | varchar | Ex: "Avaliação Laser", "Pós-procedimento", "Anamnese facial" |
| `description` | text | Opcional |
| `required_for_evaluation` | boolean | Quando true, guard rail N3 exige uma ficha desse template antes de mover journey `evaluation → sale` |
| `active` | boolean | Soft delete; preserva fichas existentes |
| timestamps | | |

Unique `(tenant_id, name)`. Múltiplos templates ativos coexistem — uma clínica de laser pode ter "Avaliação Laser" + "Anamnese facial" + "Termo de consentimento" em paralelo.

**`form_questions`**

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `form_template_id` | uuid | FK — pergunta pertence a um template específico (não há catálogo compartilhado) |
| `prompt` | text | Enunciado |
| `question_type` | enum | `text`, `yes_no`, `multiple_choice`, `scale`, `number`, `date` |
| `options` | jsonb | Pra `multiple_choice`/`scale`. Null pra outros tipos |
| `section` | varchar | Agrupamento visual livre (ex: "Histórico", "Medicações") |
| `position` | int | Ordem de apresentação |
| `required` | boolean | Pergunta obrigatória pra marcar `client_form.status = completed` |
| `active` | boolean | Soft delete por pergunta |
| timestamps | | |

**`client_forms`** (ficha preenchida — 1 por evaluation, por template)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `evaluation_id` | uuid | FK — `CASCADE` no delete. Ancora a ficha no evento clínico |
| `client_id` | uuid | FK denormalizado (derivado de `evaluation.client_id`). Mantido pra listagem agregada "todas as fichas do cliente" sem JOIN |
| `form_template_id` | uuid | FK — `RESTRICT` no delete (template com fichas não some) |
| `status` | enum | `draft`, `completed`, `archived` |
| `filled_at` | timestamp | Quando a avaliadora bateu "salvar" pela primeira vez |
| `completed_by_user_id` | uuid | FK pra users (quem completou) |
| timestamps | | |

Unique `(evaluation_id, form_template_id)` — atualizar respostas da ficha = update no `form_answers`, não nova linha. Reavaliação cria nova `evaluation` que pode reusar os mesmos templates (1 ficha nova por template, snapshot independente).

> **Sem `general_observations` na ficha.** Anteriormente existia um campo livre por ficha pra contexto geral, mas sobrepunha o `evaluations.general_notes` (que cobre o mesmo nível semântico — observações por evento clínico). Removido pra eliminar o "qual dos dois é o canônico" pro operador. Notas específicas por pergunta ficam em `form_answers.professional_observation`. Notas do evento como um todo, em `evaluations.general_notes`.

**`form_answers`** (uma resposta por pergunta da ficha)

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `client_form_id` | uuid | FK — cascade delete |
| `question_id` | uuid | FK — cascade delete |
| `answer_text` | text | Pra `text` |
| `answer_option` | varchar | Pra `multiple_choice` (chave da opção escolhida) |
| `answer_boolean` | boolean | Pra `yes_no` |
| `answer_number` | numeric(18,4) | Pra `number`/`scale` |
| `answer_date` | date | Pra `date` |
| `answer_data` | jsonb | Saída livre pra tipos compostos (múltipla seleção, escala com nota+texto, etc.) |
| `professional_observation` | text | Observação da avaliadora sobre essa resposta |
| `answered_at` | timestamp | |
| timestamps | | |

Unique `(client_form_id, question_id)` — update sobrescreve. CB usava `ON DUPLICATE KEY UPDATE`; aqui é upsert via Drizzle.

**Por que esse modelo:**
- **Templates reusáveis por vertical** — clínica que faz laser + facial cadastra fichas diferentes pra cada vertical sem campo "vazio" pro outro.
- **Evolução flexível do template** — admin do tenant adiciona pergunta nova sem migration; fichas existentes ficam sem resposta pra essa pergunta (válido, é histórico).
- **Histórico evolutivo por evento clínico** — ancorar em `evaluation_id` (e não `client_id`) preserva snapshots independentes: avaliação inicial em janeiro vs reavaliação em julho ficam lado a lado, comparáveis. Atualização da ficha = update no mesmo `client_form`; reavaliação = nova `evaluation` + novo `client_form`.
- **Apaga decisão de schema pendente** — não dependemos mais de "definir fototipo, contraindicações, medicações como colunas". Tudo vira pergunta com `question_type`.

**Fluxo na UI**:
1. Cliente entra em avaliação → cria `evaluation` (kind=`initial`).
2. Avaliadora abre `/evaluations/:id/forms` — vê lista de todos os templates ativos com badge "Não iniciada" / "Rascunho" / "Finalizada" pra essa eval.
3. Clica em "Preencher" → backend cria `client_form` lazy (status `draft`) e abre o sheet de respostas.
4. Finalizar valida required questions + emite `journey_event form_completed`.
5. Reavaliação (`evaluation` kind=`reevaluation` na mesma journey) repete o ciclo — novo conjunto, comparação preservada.

**Campos clínicos sugeridos pra template "Avaliação Laser"** (seed inicial — admin customiza depois):
- Fototipo (multiple_choice: I, II, III, IV, V, VI)
- Contraindicações conhecidas (text)
- Medicações em uso (text)
- Histórico de tratamentos (text)
- Área(s) tratada(s) (multiple_choice, options vindas do mapa corporal — quando definido)
- Potencial comercial (scale 1-5)
- Protocolo sugerido (text)

### 4.4 `evaluations` (entidade clínica)

Decisão **revisada em 2026-05-20**: avaliação deixa de ser um "appointment de avaliação" e vira entidade clínica própria. O slot (agenda) é separado — ver §4.5. Reflete o insight de que slot e evento clínico têm ciclos paralelos diferentes:

- Slot: agendado → confirmado → atendido / no_show / cancelado
- Evento clínico: pending → performed / cancelled

Fundir os dois numa coluna `status` única (modelo antigo) misturava as semânticas. Agora cada tabela tem seu próprio enum.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `journey_id` | uuid | FK |
| `client_id` | uuid | FK denormalizado |
| `kind` | enum | `initial`, `reevaluation`, `return` (classificação do tipo de avaliação) |
| `status` | enum | `pending`, `performed`, `cancelled` |
| `performed_at` | timestamp? | Set automaticamente quando `appointment.attended` com `kind=evaluation` |
| `performed_by_user_id` | uuid? | FK users — a avaliadora que executou |
| `general_notes` | text | Observações qualitativas (alergias percebidas, contexto, etc) |
| timestamps | | |

Sem `scheduled_at`/`duration_minutes`/`professional_id`/`unit_id` — esses vivem no appointment associado. Uma evaluation pode ter múltiplos appointments (reagendamento, no_show), mas só um ativo por vez.

Status `performed` é setado pela cascata do `appointments.attend` (não por endpoint próprio). `cancelled` é manual via `POST /evaluations/:id/cancel` quando staff decide que essa avaliação não vai mais acontecer (independente de cancelar o slot).

**Dois caminhos pra criar a evaluation:**
1. **Pelo agendamento** — `POST /appointments` com `kind=evaluation` cria evaluation inline (status `pending`) + appointment ligando. Emite `journey_event evaluation_scheduled`. Caminho padrão pra avaliação programada.
2. **Standalone** — `POST /evaluations` cria só a entidade clínica (sem slot). Status `pending`. Emite `journey_event evaluation_created` **e dispara `lead → evaluation`** se a journey ainda estiver em `lead` (mesmo com a evaluation `pending`). Caminho pra avaliação retroativa / walk-in, ou pra preparar fichas antes do appointment existir — em ambos os casos, a journey já avança porque "abrir ficha" sinaliza intenção clínica concreta. UI: botão "Nova avaliação" no ClientDetailPage. Pra agendar slot depois, criar appointment vinculando manualmente é caminho válido (V1: UI ainda não conecta — fica como TODO quando dor concreta aparecer).

### 4.5 `appointments` (agenda unificada)

Agenda única polimórfica via discriminador `kind` + um dos FKs (`evaluation_id` XOR `procedure_session_id`). CHECK constraint no DB enforça a regra. Substitui as duas tabelas separadas (`evaluation_appointments` + `procedure_appointments`) do modelo anterior.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `journey_id` | uuid | FK |
| `client_id` | uuid | FK denormalizado |
| `kind` | enum | `evaluation`, `procedure` |
| `evaluation_id` | uuid? | FK → `evaluations`. NOT NULL quando `kind=evaluation` |
| `procedure_session_id` | uuid? | FK → `procedure_sessions`. NOT NULL quando `kind=procedure` |
| `professional_id` | uuid? | FK users (avaliadora ou aplicadora) |
| `unit_id` | uuid? | FK units |
| `equipment_id` | uuid? | Sem FK ainda — quando módulo `equipments` chegar. Só preenchido em `kind=procedure` |
| `scheduled_at` | timestamp | |
| `duration_minutes` | int | Default 30 |
| `status` | enum | `scheduled`, `confirmed`, `attended`, `no_show`, `cancelled` |
| `notes` | text | |
| timestamps | | |

**Por que unificar (revisão da decisão anterior).** O modelo antigo justificava tabelas separadas por "lifecycle ligeiramente diferente" — mas a real diferença era misturar o ciclo do slot com o ciclo do evento. Separando em duas tabelas (`appointments` + `evaluations`/`procedure_sessions`), o ciclo de cada coisa fica claro e independente. Vantagens concretas:

- **UI de calendário única**: clínicas operam com uma agenda só, não duas. Mistura natural de evaluation+procedure no mesmo dia/profissional.
- **Conflict-check único**: profissional sobreposto entre kinds vira validação direta na mesma tabela, sem helper cross-table.
- **Audit consistente**: histórico de reagendamentos (cancelled, no_show + novos slots pra mesma evaluation/session) fica numa série temporal coesa em `appointments`.

**Cancelar slot ≠ cancelar evento.** Cancelar o appointment libera a evaluation/session pra novo agendamento. Pra realmente declarar "essa avaliação/sessão não vai mais acontecer", chame o endpoint de cancel da própria entity (`POST /evaluations/:id/cancel` ou `POST /procedure-sessions/:id/cancel`).

**Conflict warning de profissional.** Quando agendamento criado pisa em outro slot do mesmo professional_id (status não-terminal), UI mostra alerta soft. Não bloqueia — clínica pode legitimamente sobrepor (ex: aval. rápida durante intervalo de procedimento).

### 4.6 `quotes`

Orçamento. O Corpo-Bueno tem três origens reais — modelamos isso explicitamente:

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `journey_id` | uuid | FK |
| `origin` | enum | `evaluation`, `referral`, `direct_sale` |
| `total_amount` | decimal(12,2) | |
| `discount_amount` | decimal(12,2) | |
| `status` | enum | `draft`, `sent`, `accepted`, `rejected`, `expired` |
| `valid_until` | timestamp | |
| `notes` | text | |
| created_by_user_id, sent_at, accepted_at | | audit |

**Origens** (impacta comissionamento e métricas):
- `evaluation` — fluxo padrão, sai da avaliadora após avaliação.
- `referral` — criado pela aplicadora durante tratamento (cross-sell). Comissão diferente.
- `direct_sale` — recepção criou fora do fluxo padrão. Comum no Corpo-Bueno pra fechar venda no balcão, manobras de ticket médio. Aceitamos a realidade, mas categorizamos pra dar visibilidade.

**`quote_items`** (tabela filha):
- `quote_id`, `procedure_id`, `quantity_sessions`, `unit_price`, `discount_pct`
- Liga cada item ao procedimento do catálogo + quantas sessões foram contratadas.

### 4.7 `treatments`

**Entidade NOVA, inexistente no Corpo-Bueno.** Resolve a dor atual de "procedimentos soltos vinculados só a fechamentos".

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `journey_id` | uuid | FK |
| `client_id` | uuid | FK denormalizado |
| `name` | varchar | "Laser axila completo", "Facial 10 sessões", etc. |
| `status` | enum | `active`, `completed`, `abandoned`, `manually_closed` |
| `started_at`, `completed_at` | timestamps | |
| `notes` | text | |

**Status transitions:**

```
[create]
   │
   ↓
 active ──aplicadora evolui última sessão──→ completed
   │
   ├──N dias sem sessão (automação)─────────→ abandoned
   │
   └──botão "fechar manualmente"─────────────→ manually_closed
```

**Importante**: `completed`, `abandoned` e `manually_closed` não são locks. Edição (fotos antes/depois, observações, evolução clínica) segue permitida em qualquer status. Status é **tag operacional pra gestão**, não trava de UX.

**Relação com procedimentos** — `treatments` e `procedure_sessions` são M:N via `treatment_procedures`. Isso reflete a realidade já observada no Corpo-Bueno:
- 1 tratamento pode ter sessões que apareceram em quotes/fechamentos diferentes.
- 1 fechamento pode produzir sessões pra 2 tratamentos paralelos.
- A "interpretação humana" que existe hoje vira relação explícita no banco.

### 4.8 `procedure_sessions`

Sessão individual de procedimento (uma aplicação de laser, uma sessão de facial, etc.). Lifecycle desacoplado da agenda. O link com o slot é via `appointments.procedure_session_id` (reverso) — uma session pode ter múltiplos appointments ao longo da vida (reagendamento, no_show). Pra encontrar o "appointment atual" de uma session pendente, query reversa filtrando appointments por status não-terminal.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `client_id` | uuid | FK |
| `procedure_id` | uuid | FK pro catálogo |
| `status` | enum | `pending`, `signed`, `done`, `cancelled` (ver §23) |
| `executed_at` | timestamp? | Carimbado quando vira `signed` (presença assinada) ou `done` (override admin) |
| `executed_by_user_id` | uuid? | Idem |
| `evolution_notes` | text | Observações da aplicadora — escritas quando a sessão vai de `signed → done` |

**Lifecycle.** `pending → signed` quando cliente assina presença via link público (`signed = compareceu + foto + assinatura registrada`); `signed → done` quando aplicadora registra a evolução clínica via `POST /procedure-sessions/:id/evolve` (nota obrigatória + gate `canApplyProcedures`). `cancelled` desde qualquer estado pré-terminal. Detalhes: [arquitetura.md §23](./arquitetura.md#23-presença-assinada-de-sessões-procedure_session_attendances) (assinatura) e [§23.1](./arquitetura.md#231-evolução-clínica-signed--done) (evolução).

Junção com treatment via `treatment_procedures`:
- `treatment_id`, `procedure_session_id`
- PK composta

### 4.9 `conversations` e `messages`

**Camada domain-level**, separada da transport-level do WhatsApp.

`conversations`:
- **1 por par (cliente, whatsapp_channel)** — unique `(client_id, whatsapp_channel_id)`. Mesma pessoa atendida em 2 canais distintos = 2 conversations separadas. *Migrado em 2026-05 — versão anterior tinha 1 por cliente atravessando todos os canais.*
- Campos: `id`, `tenant_id`, `client_id`, `whatsapp_channel_id` (FK, NOT NULL), `last_message_at`, `last_staff_seen_at`, timestamps.
- API expõe `channel: {id, name, color}` embedded — UI usa cor pra diferenciar visualmente cards minimizados e janela flutuante.
- Quando outros providers (Instagram, email) entrarem, ou `whatsapp_channel_id` vira nullable + adiciona `instagram_channel_id`, ou generaliza num `channel_id` polimórfico. Repensar quando virar dor real.

`messages`:
| Campo | Tipo | Notas |
|---|---|---|
| `id` | uuid | PK |
| `tenant_id` | uuid | RLS |
| `conversation_id` | uuid | FK |
| `journey_id` | uuid? | FK opcional — quando dá pra identificar a qual jornada a msg pertence |
| `direction` | enum | `inbound`, `outbound`, `internal_note` |
| `kind` | enum | `text`, `media`, `template`, `system`, `sticker`, `call` |
| `body` | text | Caption pra mídia, texto pra `kind='text'`, body renderizado pra template |
| `media_url` | varchar? | **ObjectKey** do MinIO (não URL de download). Frontend pede presigned via `GET /messages/:id/media-url` |
| `media_type` | enum? | `image`/`audio`/`video`/`document`/`sticker`. Null quando `kind` é text/template/system/call |
| `call_payload` | jsonb? | `{direction, status: missed\|received\|declined, durationSec?, startedAt}` quando `kind='call'`. Ver arquitetura.md §7.4 |
| `edited_at` | timestamp? | Set quando msg foi editada (cliente OU staff). UI mostra badge "editada". Body é sobrescrito in-place; sem histórico de versões |
| `deleted_at` | timestamp? | Soft delete. Body/mediaUrl ficam intactos (auditoria); UI esconde |
| `deletion_origin` | enum? | `client` (cliente apagou) \| `staff` (staff revogou) \| `system` (reservado pra retention futura). UI usa pra escolher texto exibido |
| `template_id` | uuid? | FK quando `kind=template` |
| `template_variables` | jsonb? | Variáveis usadas na renderização do template — preservadas pro worker outbound usar quando construir payload Cloud API. Null pra kind != 'template' |
| `whatsapp_message_id` | uuid? | FK pra `whatsapp_messages` (transport layer) |
| `delivery_status` | enum | `pending` \| `sent` \| `failed` \| `rejected`. Inbound/internal_note nascem `sent`; outbound da UI nasce `pending` até worker confirmar. Ver [arquitetura.md §7.11](./arquitetura.md) |
| `failure_reason` | enum? | Quando `delivery_status ∈ ('failed','rejected')`: `no_opt_in` \| `channel_disconnected` \| `window_24h_expired` \| `invalid_template` \| `rate_limited` \| `provider_error` \| `worker_timeout` \| `unknown`. Frontend mapeia pra label PT-BR + ação contextual |
| `failure_detail` | jsonb? | Contexto rico do erro (status code provider, retryAfterSec, mensagem bruta). Usado em tooltips/audit; UI principal usa só `failure_reason` |
| `sent_at`, `delivered_at`, `read_at` | timestamps | |
| `author_user_id` | uuid? | Quem mandou (outbound/internal_note). Null em outbound capturado do celular pareado |
| `authored_on_device` | boolean | True quando outbound foi via celular pareado (não pela UI) |

**Por que duas tabelas (`messages` vs `whatsapp_messages`)?**
- `whatsapp_messages` (transport, arquitetura.md §7) tem `external_id`, status do provider, payload bruto. Genérico WhatsApp.
- `messages` (domain) tem `journey_id`, `direction`, `internal_note`. Conhece o ciclo.
- Mensagem que veio do WhatsApp tem registro nas duas, ligadas por `whatsapp_message_id`.
- Mensagem `internal_note` (anotação entre staff) só existe em `messages`. Future-proof pra outros canais (email, Instagram).
- Mensagem `kind='call'` também só vive em `messages` — chamada não é msg no protocolo WhatsApp, é evento à parte registrado como notificação na timeline.

**Storage de mídia** vive na arquitetura — ver [arquitetura.md §7.9](./arquitetura.md). Resumo: `media_url` aqui guarda objectKey estável; presigned URL é gerada on-demand pelo backend quando frontend renderiza.

**Lifecycle (edit + revoke)** — ver [arquitetura.md §7.10](./arquitetura.md). Resumo: soft delete sempre; cliente e staff podem ambos editar/apagar mensagens; eco do nosso outbound é filtrado no adapter pra não duplicar a operação local.

**Envio outbound** — ver [arquitetura.md §7.11](./arquitetura.md). Resumo: controller HTTP só faz INSERT `delivery_status='pending'` + publica `message.created` + enfileira BullMQ; worker dedicado faz pre-flight + adapter + UPDATE pra `sent/failed/rejected` + publica `wa.message.status_changed`. UI mostra bolha imediatamente (spinner pending → check sent OU bolha laranja/vermelha com motivo da falha). Pre-flight rejeitado também vira linha em `messages` (audit completo, sem perda).

**Tag visual de jornada (cor)** — frontend deriva. Lista as journeys do cliente ordenadas por `created_at`, atribui paleta fixa por posição (1ª = azul, 2ª = roxo, 3ª = rosa, ...). Sem persistência no schema. Mudou de paleta? Só atualiza o frontend.

### 4.10 `automations` e `message_templates`

`message_templates`:
- `id`, `tenant_id`, `name`, `body` (com `{{variáveis}}`), `kind` (`text`, `media`), `surface_in_stage[]` (array de stages onde aparece como sugestão).
- Cloud API futuro adiciona `meta_template_id` + `meta_approval_status`.

`automations`:
- `id`, `tenant_id`, `name`, `trigger_type`, `trigger_config` (jsonb), `template_id`, `filters` (jsonb), `active`.
- `trigger_type` enum:
  - `time_before_evaluation_appointment` (D-1, D-0)
  - `time_after_evaluation_appointment` (NPS pós-avaliação)
  - `time_before_procedure_appointment` (D-1, D-0)
  - `time_after_procedure_appointment` (cuidados pós-procedimento, NPS)
  - `time_since_last_session` (reciclagem por inatividade)
  - `time_since_last_activity` (orçamento parado — usa `journeys.last_activity_at`)
  - `journey_stage_changed`
  - `client_birthday`
  - `quote_status_changed`
- `filters` permite limitar por estágio, origem, tipo de cliente (VIP), etc.

`recycling_rules` (caso especial de automation):
- Filtros: "clientes com `last_treatment.completed_at` há mais de 90 dias", "clientes com `is_vip = true`", "agendamentos com `status=no_show`".
- Ação: criar nova `journey` com `source=recycling` + `source_metadata.recycling_rule_id` apontando pra esta regra.
- Dispara também (ou só) uma mensagem (template).

---

## 5. Estágios da jornada

```
lead ──┬─→ evaluation ──→ sale ──→ treatment ──→ result
       │                  ↑
       └──────────────────┘  (skip evaluation — sempre permitido; alerta no log se tenants.skip_evaluation = false)

OFF-RAMPS (a qualquer momento):
   stage atual → status=lost + lost_reason='disqualified'|'price'|'timeout'|'no_show'|...
```

### 5.1 `lead`

**O que é**: cliente potencial recém-capturado, ainda sem compromisso firme. Cobre desde "acabou de mandar primeira mensagem" até "já tem orçamento mas ainda não aceitou".

**Entrada**: criada automaticamente pela primeira mensagem WhatsApp + automação que vincula `client + journey` ao contato; criada por sync com fonte externa (form, sheets); criada manualmente via `POST /leads`; reciclada via `POST /leads/:previousJourneyId/recycle` (source='recycling').

**Saída pra `evaluation`**: (a) appointment de kind=evaluation atendido (presença assinalada); ou (b) evaluation criada via `POST /evaluations` (standalone), mesmo em `status='pending'` — abrir ficha clínica avulsa sinaliza intenção concreta de avaliar. Criar evaluation inline via `POST /appointments kind=evaluation` **não** transiciona — segue padrão (a).
**Saída pra `sale`**: quote enviado a partir desta journey é ACEITO pelo cliente (closeSale). A journey pode ir direto lead→sale sem passar por evaluation, contanto que tenha quote em `status='accepted'`. Se o tenant tem `skip_evaluation=false`, a transição acontece mesmo assim e o sistema emite alerta no log — não é bloqueada.
**Saída pra `lost`**: timeout sem resposta (automação); manual ("não tem interesse"); auto-disparado quando todas as quotes da journey estão em `rejected` ou `expired` (ver §5.6).

**Dados obrigatórios**: nome + telefone. Resto opcional.

**Lead substage** (campo `journeys.lead_substage`): sub-etapa fina dentro de `lead`, mantida por cascata idempotente. Valores e precedência (maior vence):

```
quoted > rescheduled > no_show > scheduled > contact > template > new
```

- `new` — não há outbound de staff ainda (pode ou não haver inbound do cliente esperando primeira resposta).
- `template` — staff já enviou ≥1 outbound e cliente **nunca** respondeu (outreach frio sem resposta).
- `contact` — existe ao menos um outbound de staff E ao menos um inbound do cliente (em qualquer ordem) — comunicação bidirecional estabelecida. Inclui o caso "cliente iniciou + staff respondeu" e o caso "staff iniciou + cliente respondeu + staff voltou a falar" (não regride pra template).
- `scheduled` — appointment kind=evaluation futuro existe (`status≠cancelled/no_show`).
- `no_show` — appointment kind=evaluation foi marcado `no_show` e não há reagendamento futuro.
- `rescheduled` — houve no_show E há novo appointment futuro ativo.
- `quoted` — existe quote da journey em `status='sent'` ou `'accepted'`. Quote `rejected/expired` NÃO mantém o substage — volta pro estado anterior.

Reset: ao sair de stage='lead' (lead→evaluation ou lead→sale), substage volta pra null.

**Ordenação no board (UX, ext. 2026-05-25).** Em qualquer coluna do kanban, os leads em que **a última mensagem da conversa veio do cliente** (`lastMessageDirection = 'inbound'`) sobem ao topo, independentemente do `sortBy` escolhido — a clínica está devendo retorno e a urgência operacional pesa mais que a recência. Empate dentro do bucket cai pro `orderBy` normal (`lastActivityAt DESC` por default). Leads sem conversa associada (`direction=null`) entram no bucket "outros". Implementado em `LeadsQuery.findCards`, ordering combinado `(direction='inbound') DESC NULLS LAST, <sortBy>`. O card recebe destaque visual (borda warning + preview em foreground) — ver [frontend-design-system.md](frontend-design-system.md).

### 5.2 `evaluation`

**O que é**: existe avaliação clínica registrada pra esta journey — seja porque o cliente compareceu, seja porque a clínica abriu ficha avulsa (walk-in / retroativa / preparação). A avaliação pode estar `pending` ou `performed`; o que importa pra estar nesse stage é a existência da entidade clínica.

**Entrada**: (a) `appointment` (kind=evaluation) com `status=attended` → cascata move journey pra `evaluation`; ou (b) `POST /evaluations` (standalone) cria evaluation `pending` → dispara transição imediatamente, mesmo sem appointment. `POST /appointments kind=evaluation` cria evaluation `pending` inline mas **não** transiciona — fica em lead com `substage='scheduled'` até a presença ser assinalada.
**Saída pra `sale`**: quote criado (`origin=evaluation`) e enviado.
**Saída pra `lost`**: avaliadora marca "não qualificado" no form, ou cliente recusa avaliação.

**Dados obrigatórios pra sair**: pelo menos uma `client_form` em `status=completed` cujo template tenha `required_for_evaluation=true` (guard rail N3). Tenant que não usa esse fluxo deixa nenhum template marcado e a regra é vácua.

### 5.3 `sale`

**O que é**: VENDA FECHADA — cliente aceitou o orçamento mas ainda não iniciou o tratamento.

> **Mudança 2026-05** — antes desta data, `sale` representava "quote em mãos do cliente, negociação ativa", e a transição lead/evaluation → sale acontecia em `quote.send`. A interpretação atual é mais estrita: a journey só vira `sale` quando o cliente **aceita** o orçamento (`quote.status='accepted'`, disparado por `closeSale`). Enquanto isso, a journey permanece em `lead` (com `lead_substage='quoted'`) ou em `evaluation`.

**Entrada**: closeSale dispara — quote em status `sent` vira `accepted`, eagerly cria as `procedure_sessions` em `pending` a partir de `quote_items`, e a journey transita lead/evaluation → sale (guard rail N3 valida que existe quote em `accepted`).
**Saída pra `treatment`**: a transição `sale → treatment` dispara quando a **1ª presença é assinalada** (aplicadora marca presença + colhe assinatura + foto do dia) — momento em que o `treatment` é criado com `started_at=now()`. Ver §16 (matriz canônica de transições).
**Saída pra `lost`**: timeout sem resposta entre venda fechada e 1ª sessão; cliente desistiu antes de começar (manual).

**Dados obrigatórios**: quote anexado à jornada com `status='accepted'` (guard rail N3 — não basta mais ter quote enviado).

### 5.4 `treatment`

**O que é**: tratamento em andamento, sessões sendo executadas.

**Entrada**: ver acima.
**Saída pra `result`**: aplicadora evoluiu a última sessão (treatment muda pra `completed`) → jornada move pra `result`.

**Múltiplos treatments paralelos**: jornada pode ter mais de um treatment ativo simultaneamente. Move pra `result` quando **todos os treatments da jornada** estão fora de `active` (`completed`/`abandoned`/`manually_closed`).

### 5.5 `result`

**O que é**: tratamento(s) encerrado(s), fotos antes/depois, evolução final registrada.

**Entrada**: todos os treatments saíram de `active`.
**Saída pra `won`**: profissional/admin clica em "concluir jornada" depois de revisar resultado.
**Edição pós-finalização**: sempre permitida — fotos, observações, evolução clínica.

**Reciclagem possível**: cliente em `result` é candidato natural a entrar em `recycling_rules` futuras.

### 5.6 Reabertura por inbound + reciclagem (ext. 2026-05)

Regra geral: journey perdida (`status='lost'`) é **fechada** — não reabre. Duas exceções:

#### 5.6.1 Reabertura por inbound espontâneo

Se o cliente perdeu o contato e volta a **mandar mensagem por iniciativa própria** dentro de uma janela de `REOPEN_WINDOW_DAYS=60` dias após o `closedAt`, a journey lost mais recente é **reaberta** em vez de criar nova. Inferência: o cliente está retomando o contexto anterior, não começando do zero.

Implementação em `tryReopenJourneyForClient` (`@elora/db`), chamado pelo `LocalCoreGateway.journeysFindOrCreateActive` quando `input.source='whatsapp'`. Outras fontes (form, manual, sheets, imported) **sempre criam** journey nova — porque expressam decisão deliberada de iniciar nova jornada.

O que muda na reabertura:
```
status:         lost → active
closedAt:       set → null
lostReason:     PRESERVADO (vira flag UI "lead reaberto")
lastActivityAt: NOW()
leadSubstage:   recomputado pela cascata do MessagesService
```

Audit: registra `journey_event` tipo `reopened_from_inbound` com payload `{previousLostReason, previousClosedAt, daysClosed}`.

**`won` nunca reabre** — selo final de sucesso. Cliente que terminou tratamento e volta abre journey nova (princípio 1 cliente : N journeys).

**Janela > 60 dias**: cliente é tratado como novo. Inbound cria journey nova com `source='whatsapp'`.

#### 5.6.2 Reciclagem (iniciativa da empresa)

Quando a **recepcionista decide retomar** um cliente perdido (ela toma a iniciativa, não o cliente), usa o endpoint `POST /leads/:previousJourneyId/recycle`. Cria journey **nova** com:

```
stage='lead'
substage='new'
status='active'
source='recycling'
sourceMetadata={ previous_journey_id, recycled_by_user_id, recycled_at }
```

Audit: registra `journey_event` tipo `recycled_from` na nova journey, payload `{previousJourneyId}`.

Pré-requisitos:
- `previousJourneyId` existe no tenant E está em `status='lost'`
- Cliente NÃO tem journey ativa atual (invariante "1 active por cliente")

#### 5.6.3 Distinção operacional

| Gatilho | Mecanismo | Resultado |
|---|---|---|
| Cliente manda mensagem espontânea | Pipeline inbound (`source='whatsapp'`) → `tryReopenJourneyForClient` | **Reabre** journey lost se < 60d |
| Recepcionista decide reofertar | UI → `POST /leads/:id/recycle` | **Cria** journey nova `source='recycling'` |
| Cliente preenche form de site | Pipeline form (`source='form'`) | **Cria** journey nova (sem reopen) |
| Importação em lote (sheets/CSV) | Worker (`source='sheets'/'imported'`) | **Cria** journey nova |

#### 5.6.4 Auto-lost por quote

A journey vai para `status='lost'` automaticamente quando **todas** as quotes não-draft da journey ficam em `rejected` ou `expired` (nenhuma em `sent` ou `accepted`):

- `quote.reject` → checa: existe quote `sent/accepted` na journey? Se zero, `markJourneyLost(reason='quote_rejected')`.
- `quote.expire` → mesma checagem, `reason='quote_expired'`.

Implementação em `autoLostIfAllQuotesClosed` (`QuotesService.ts`). Comportamento intencional pra manter o kanban limpo. Recepcionista que vai mandar 2º quote deve criar o draft **antes** de rejeitar o 1º, OU reciclar via `/leads/:id/recycle` depois.

---

## 6. Estados do `treatment`

Independente dos estágios da jornada.

```
        ┌──────────────────────────────────────┐
        │                                      │
        ↓                                      │
[create] active ──completed──────────────→ completed
            │
            ├──N dias sem sessão (auto)──→ abandoned
            │
            └──botão fechar──────────────→ manually_closed

Edição (fotos, observações) permitida em QUALQUER status.
```

**Distinções importantes:**
- `completed` ≠ `abandoned`. `completed` = aplicadora chegou ao fim. `abandoned` = automação detectou ausência (problema operacional, oportunidade de reciclagem).
- `manually_closed` é a "fuga" — cliente desistiu, mudou-se, problema clínico. Não conta como conversão.
- Pra métrica de conversão, só `completed` conta.

---

## 7. Origens de lead

Enum + jsonb pra flexibilidade. Novos canais entram via:
1. Novo valor no enum (migration trivial).
2. Lógica de criação da journey específica (pode ser endpoint, worker, integração).
3. Schema do `source_metadata` documentado em código (Zod schema por source).

Casos previstos:
- `whatsapp` — primeira inbound, contato sem journey ativa → cria journey + client se necessário.
- `form` — webhook de RD Station / form embed no site → POST `/leads/inbound`.
- `sheets` — worker BullMQ que sincroniza periodicamente uma planilha → diff + inserts.
- `manual` — recepcionista cadastra direto no sistema.
- `recycling` — gerado por `recycling_rules`.
- `imported` — onboarding de tenant com base de clientes pré-existente.
- `other` — sentinela pra fontes ad-hoc, com `source_metadata.description`.

---

## 8. Tipos de quote (origin)

| Origem | Quem cria | Quando | Comissão | Visibilidade na métrica |
|---|---|---|---|---|
| `evaluation` | Avaliadora | Pós-avaliação presencial | Padrão (configurável por tenant) | "Conversão de avaliação" |
| `referral` | Aplicadora | Durante tratamento (cross-sell) | Diferenciada (incentivo) | "Indicação interna" |
| `direct_sale` | Recepcionista | Fora do fluxo padrão | Padrão ou outra | "Venda direta" — fica visível separado, evita esconder a manobra |

Cada origem permite filtros nos painéis. Tenant que **não usa avaliação** terá só `referral` e `direct_sale` ativos.

---

## 9. Camadas de controle de conversa

### Nível 1 — Lembretes automáticos

**Quem configura**: admin do tenant via UI de Automações.
**Quem dispara**: scheduler do sistema (BullMQ jobs).
**Onde mora**: `automations` table.

Exemplos canônicos:
- `time_before_evaluation_appointment(24h)` → "Amanhã às {{hora}} sua avaliação na {{unidade}}."
- `time_after_procedure_appointment(2h)` → "Como você está se sentindo? {{cuidados_procedimento}}"
- `time_since_last_activity(7d)` + filtro `stage=sale, status=active` → recycling de orçamento parado (após janela manual de 3 dias).
- `time_since_last_session(90d)` + filtro `client.is_vip=true` → reciclagem VIP.
- `client_birthday` → mensagem de aniversário.

### Nível 2 — Templates sugeridos

**Quem configura**: admin do tenant via UI de Templates.
**Quem dispara**: atendente clica.
**Onde mora**: `message_templates.surface_in_stage[]`.

UI do chat puxa templates onde `surface_in_stage` inclui o estágio atual da journey ativa. Mostra como botões/dropdown no compose. Atendente clica → texto preenche o input → edita se quiser → envia.

Útil pra:
- Padronizar tom da clínica.
- Garantir que apenas templates registrados são usados em mensagem ativa (em canal `meta_cloud`, esses templates passaram por aprovação Meta; em canal `baileys`, são auto-aprovados no Elora — ver [arquitetura.md §7.3](arquitetura.md)).
- Reduzir erro/typo em mensagens repetitivas.

### Nível 3 — Guard rails

**Quem configura**: dev (código).
**Quem dispara**: validação no Service de cada módulo.
**Onde mora**: lógica de negócio.

Regras inicialmente previstas:
- Não move journey pra `sale` sem quote `status!=draft` anexado.
- Não move journey pra `evaluation→sale` sem `client_form.status=completed` de algum template `required_for_evaluation=true` (se o tenant configurou pelo menos um).
- Não fecha `treatment` como `completed` sem todas as sessões prescritas executadas (ou botão manual aceita).
- **Mensagem ativa fora da janela de 24h só com template aprovado — APENAS no track Cloud API.** Meta enforça no protocolo; backend valida pra dar erro amigável (`requiresWindowGate()=true` no adapter). Baileys/mock NÃO têm gate de janela 24h nem conceito de template aprovado — defesa contra banimento mora no `OutboundGuard` (próxima regra). Decisão revisada em 2026-05-25; histórico em [arquitetura.md §7.3](arquitetura.md).
- **OutboundGuard em providers não-Cloud (Baileys, mock).** `apps/chat/src/shared/outboundGuard` aplica rate limit por canal (20/min, 200/hora) + dedupe de body normalizado (>10 destinatários distintos pro mesmo conteúdo em 30min vira `429 dedupe_mass`). Pega o padrão real de banimento WhatsApp (disparo em massa, conteúdo repetitivo) sem amarrar conversa humana natural. Backed por Redis (atomic INCR + SADD), fail-open quando Redis indisponível.
- **Templates ocultos em canais não-Cloud.** UI esconde `TemplateComposer` quando `channel.providerType != 'meta_cloud'`; backend rejeita `kind='template'` com 400. Templates Baileys seriam mensagens livres rebatizadas — sem aprovação Meta, sem benefício, com risco de pattern de spam.
- **Opt-in obrigatório antes de qualquer mensagem ativa em AMBOS os tracks.** `whatsapp_contacts.opted_in_at` precisa estar setado. Sem opt-in, Service rejeita.
- **Opt-in implícito via inbound.** Toda mensagem inbound captura consentimento: pipeline chama `WhatsappContactsService.ensureInboundOptIn(contactId, message.receivedAt)` no mesmo passo que `touchInbound`. Regra é **conservadora**: só grava se `opted_in_at` ainda era null — preserva o timestamp do primeiro inbound como auditoria de "quando o consentimento começou", em vez de mover a data a cada mensagem nova. `opt_in_source` fica `'inbound_initiated'` (distingue do caminho manual/admin, que usa `'manual'`/`'form'`/etc via `recordOptIn`).
- Não deleta journey com treatment `active` — desativa em vez de deletar.

Cada uma vira teste de integração.

**Por que regras DIFERENTES por track agora** (revisão 2026-05-25): a versão anterior aplicava janela 24h + template-only em AMBOS os tracks ("defesa em profundidade"). Na prática, forçar template em todo re-engajamento aumenta o risco no Baileys em vez de reduzir — heurísticos de spam do WhatsApp olham conteúdo repetitivo entre destinatários + baixa taxa de resposta, exatamente o padrão que o template gera. Uma mensagem humana ("Oi Maria, lembrei da nossa conversa…") passa batida; vinte clientes recebendo "Olá {{nome}}, retomando…" no mesmo dia acende o farol. A defesa correta pra Baileys é detectar o pattern REAL perigoso (disparo em massa), o que `OutboundGuard` faz. Cloud segue regulado pelo Meta — não é nossa escolha lá.

**Como guard rail outbound se manifesta na UI** (revisão 2026-05-26): as regras desta seção (opt-in, janela 24h, OutboundGuard) continuam valendo, mas NÃO devolvem mais HTTP 403/409 inline pro composer. O controller `enqueueOutbound` aceita o INSERT com `delivery_status='pending'` independentemente; o `OutboundDeliveryWorker` é quem aplica as regras e marca a row como `delivery_status='rejected'` + `failure_reason=<motivo>` em vez de rejeitar. Frontend renderiza bolha laranja com a mensagem PT-BR mapeada do reason. Vantagem: audit completo de todas as tentativas (incluindo as bloqueadas), uniformidade de erro UX (todos os tipos de falha viram a mesma estética de bolha). Detalhamento completo em [arquitetura.md §7.11](./arquitetura.md).

---

## 10. Reciclagem

**Não é um sexto estágio.** É um conjunto de regras que criam **novas jornadas** com `source=recycling` ou disparam mensagem dentro de jornadas existentes.

Tipos previstos:
- **VIP inativo**: clientes marcados como VIP sem agendamento há X dias.
- **Avaliação no-show**: cliente que agendou avaliação mas faltou.
- **Aniversariante**: cliente com `birth_date` no mês.
- **Orçamento expirado sem decisão**: quote `expired` há mais de Y dias.
- **Cross-sell pós-tratamento**: cliente com treatment `completed` há mais de Z dias.
- **Orçamento parado** (jornada em `stage=sale, status=active` sem ação de staff há mais de Y+Z dias). Caso especial — descrito a seguir.

**Cada regra**:
1. Define um segmento (filtros sobre clients + journeys + appointments + evaluations + quotes).
2. Define uma ação (criar nova journey, mandar mensagem, ou ambos).
3. Roda periodicamente (worker BullMQ — diário, semanal).

**Como rastrear**: nova `journey.source = recycling`, `journey.source_metadata.recycling_rule_id` = qual regra disparou + `journey.source_metadata.previous_journey_id` = jornada anterior. Permite responder "qual % de reciclagem VIP converteu?".

### 10.1 Janela de triagem manual antes da automação

Padrão de regra híbrida: **antes** da automação disparar, dar uma janela de Z dias pra equipe trabalhar manualmente a lead.

Modelo puramente temporal — não tem entidade nova nem flag persistida. Tudo deriva de `journeys.last_activity_at` (atualizado por qualquer ação de staff):

```
T = now() - journey.last_activity_at

T < Y dias               → lead "fresco" — não aparece em queue
Y ≤ T < Y + Z dias       → aparece na "fila de triagem manual"
T ≥ Y + Z dias           → recycling_rule dispara automação
```

**Ação de staff** que zera (atualiza) `last_activity_at`:
- Mensagem outbound enviada (manual ou template clicado).
- Mensagem outbound capturada do celular pareado (`message.authored_on_device=true`) — ver [arquitetura.md §7.4](arquitetura.md). Conta exatamente como outbound da UI: foi a equipe respondendo, só usou outro canal.
- Quote criado/editado/reenviado.
- Stage da journey movido manualmente.
- Appointment criado/movido.
- Anotação interna registrada na conversa (`message direction=internal_note`).

**Inbound do cliente NÃO conta** — se o lead respondeu mas ninguém trabalhou, o relógio segue. Evita o caso "cliente perguntou preço, ninguém respondeu, automação não dispara porque cliente 'falou'".

**Caso canônico**: orçamento parado.
- Lead em `stage=sale, status=active`, quote enviado há 5 dias sem retorno do cliente.
- `Y=3, Z=4` (configurável na regra) → após 3 dias inativos, aparece na fila manual. Atendente vê, escolhe se trabalha agora.
- Se atendente clicar em template "lembrete de orçamento" ou mandar msg custom → `last_activity_at` reseta, lead sai da fila.
- Se passar mais 4 dias sem ação (total 7 dias inativos) → automação dispara template padrão de reativação.

UI da fila manual e `recycling_rules` ficam pra **implementação futura** — schema atual já comporta. Só precisa do `last_activity_at` em `journeys` (modelado em §4.2).

---

## 11. Fluxos de exemplo

### 11.1 Lead via WhatsApp vira venda

```
1. Pessoa manda primeira mensagem pro WhatsApp da clínica.
2. Webhook → cria whatsapp_message (transport).
3. Worker normalizador:
   - Acha/cria whatsapp_contact pelo phone.
   - Acha/cria client pelo phone E164.
   - Cliente sem journey ativa → cria journey { stage=lead, source=whatsapp, source_metadata={first_message_id, channel_id}, status=active }.
   - Acha/cria conversation pra esse client.
   - Cria message { conversation_id, journey_id, direction=inbound, kind=text, whatsapp_message_id }.
4. UI da recepcionista lista journey no painel "Leads novos".
5. Recepcionista responde via UI → POST /messages → cria message outbound + dispara WhatsApp send via adapter.
6. Recepcionista agenda avaliação → POST /appointments { kind: 'evaluation', journeyId, evaluation: { kind: 'initial' }, scheduledAt } → appointment status=scheduled + evaluation criada inline (status=pending).
7. Cliente confirma via mensagem ou atendente confirma → appointment.status=confirmed.
8. Dia chega, avaliação acontece → appointment.status=attended (via POST /appointments/:id/attend). Cascata: evaluation.status=performed; emite evaluation_done.
9. Avaliadora abre o template configurado (ex: "Avaliação Laser") → client_form criado/atualizado + form_answers preenchidos.
10. Sistema move journey pra stage=evaluation (auto, disparado pela cascata da attend).
11. Avaliadora monta quote { origin=evaluation, items=[...] } → quote.status=draft.
12. Avaliadora envia → quote.status=sent.
13. Sistema move journey pra stage=sale.
14. Recepção fecha venda → quote.status=accepted; método de pagamento registrado; sistema cria procedure_sessions em pending a partir dos quote_items. Journey segue em stage=sale.
15. Recepção agenda primeira sessão → POST /appointments { kind: 'procedure', journeyId, procedureSessionId } criado (status=scheduled).
16. Cliente comparece. Aplicadora marca presença via POST /appointments/:id/attend + colhe assinatura+foto do dia → cascata cria treatment { started_at=now() }, vincula sessions ↔ treatment via treatment_procedures, marca sessão atual como done. Journey move pra stage=treatment.
17. Sessões seguintes executadas → procedure_sessions.status=done por aplicadora → treatment.status=completed quando última sessão do último procedimento é evoluída (auto).
18. Journey move pra stage=result.
19. Aplicadora/admin sobe fotos antes/depois → marca journey como won (selo final, edições clínicas posteriores seguem permitidas).
```

### 11.2 Cliente VIP reciclado

```
1. Worker diário de recycling roda.
2. Regra "VIP inativo 90d" varre clients onde:
   - is_vip = true
   - sem treatment.status=active
   - max(treatment.completed_at) < now() - 90d
3. Pra cada match:
   - Cria journey { stage=lead, source=recycling, source_metadata: { recycling_rule_id, previous_journey_id: <última journey won> }, status=active }.
   - Dispara template "Sentimos sua falta, {{nome}}! Que tal agendar uma nova avaliação?"
4. Cliente responde → conversação continua normalmente.
5. Métrica: dashboard de reciclagem mostra "VIP inativo: X mandados, Y respondidos, Z agendaram, W converteram".
```

### 11.3 Cliente com 2 jornadas paralelas

```
- Cliente Maria tem journey A (laser axila, stage=treatment) e journey B (facial, stage=sale) ativas simultaneamente.
- Maria manda WhatsApp: "qual horário tenho amanhã?"
- Sistema cria message com journey_id=NULL (ambíguo) ou tagged com a journey de "última interação" (A, no caso).
- UI mostra a mensagem na conversa do cliente. Atendente vê duas badges no topo (A azul, B roxa) e clica em A pra contextualizar resposta.
- Atendente responde — message outbound criada com journey_id=A.
- Filtro "ver só jornada A" mostra apenas msgs com journey_id=A ou NULL relevantes.
- Filtro "ver tudo" mostra histórico completo com cor por journey.
```

### 11.4 Tenant que pula avaliação

```
- Tenant configurou skip_evaluation = true (cenário padrão; se = false, fluxo é o mesmo, mas o sistema emite alerta no log a cada lead → sale).
- Recepcionista atende lead, faz contato direto.
- UI permite criar quote direto a partir do lead (sem appointment de avaliação).
- POST /quotes { journey_id, origin=direct_sale, items: [...] } → quote em draft → sent (não muda stage).
- Cliente aceita → closeSale dispara lead → sale (skip evaluation).
- Restante do fluxo segue normal.
- Métrica: dashboard mostra "tenants que usam avaliação vs não usam" — comparativo de conversão. Inclui contagem de lead → sale com alerta (skip_evaluation=false), pra dimensionar uso fora do padrão.
```

### 11.5 Orçamento parado → fila manual → automação

```
1. Day 0: Maria recebe orçamento (origem=evaluation) via WhatsApp. Atendente
   anexou ao quote e clicou "enviar" → message outbound criada,
   journey.last_activity_at = now().
2. Day 0..3: cliente lê mas não responde. Ninguém da equipe age.
3. Day 3: worker diário da fila manual roda. Query:
     SELECT j.* FROM journeys j
     WHERE j.tenant_id = ?
       AND j.stage = 'sale'
       AND j.status = 'active'
       AND j.last_activity_at < now() - interval '3 days'
       AND j.last_activity_at >= now() - interval '7 days'
   Maria aparece na "Fila — Orçamentos Parados" na UI.
4. Day 4: atendente vê a fila, clica no card da Maria. Olha conversa, decide
   mandar lembrete custom: "Oi Maria, conseguiu olhar o orçamento?".
   Mensagem outbound criada → journey.last_activity_at = now() → Maria
   sai da fila automaticamente.
5. Day 4..8: Maria não responde. Ninguém age.
6. Day 8: worker diário detecta last_activity_at >= 4 dias (configurável).
   Aparece de novo na fila manual? Depende da regra: por simplicidade,
   considera SEMPRE o limite atual (4 dias inativos = volta pra fila).
7. Day 11: 7 dias completos de inatividade desde último contato. Recycling
   rule "orçamento parado fase 2" dispara — automação envia template
   "Última chamada — orçamento expira em 3 dias".
8. Cliente responde, conversa retoma, ou não responde e quote expira →
   journey.status passa pra lost com lost_reason='timeout'.
```

### 11.6 Treatment enriquecido pós-finalização

```
- Treatment X tem status=completed há 7 dias.
- Aplicadora descobre que cliente teve reação alérgica fora do consultório.
- Abre o treatment na UI → adiciona observação clínica + foto da reação.
- UPDATE em procedure_sessions.evolution_notes (ou em treatment.notes) — status não muda.
- Histórico clínico fica completo. Status segue completed (não vira active de novo).
- Painel destaca "treatments com edição pós-finalização" pra gestão revisar se vale reativar.
```

> **Nota**: ações pós-finalização que envolvem **agendar nova sessão** mudam o cenário — aí a aplicadora cria nova `procedure_session` e o sistema pergunta se quer reabrir o treatment (`completed → active`) ou criar um treatment novo. Decisão consciente do usuário, não automática.

---

## 12. Mapeamento Corpo-Bueno → Elora

| Conceito Corpo-Bueno | Equivalente Elora | Mudança |
|---|---|---|
| `cliente` | `clients` | Mesmo papel; nome em inglês + tenant_id |
| `agenda` (mista) | `appointments` (kind=evaluation\|procedure) + `evaluations` (entidade clínica) | Tabela única polimórfica via discriminador; ciclo do slot separado do ciclo do evento clínico (revisão 2026-05-20) |
| `orcamento` | `quotes` | Adiciona `origin` enum pra explicitar 3 caminhos comerciais |
| `fechamento` | `quotes.status=accepted` + treatments criados | Não há tabela "fechamento" — informação derivada |
| `procedimento` (catálogo) | `procedures` (futuro módulo) | Mesmo papel |
| `procedimento` (execução) | `procedure_sessions` | Renomeado pra clarificar — execução, não definição |
| (não existe) | `treatments` | Nova entidade pra agrupar sessões com objetivo único |
| `anamneses` + `perguntas_anamnese` + `respostas_anamnese` | `form_templates` + `form_questions` + `client_forms` + `form_answers` | Mesmo padrão (template reusável + ficha por cliente), simplificado: cada pergunta pertence a um template (sem catálogo compartilhado entre fichas), sem i18n |
| conversa Chatwoot | `conversations` + `messages` (domain) + `whatsapp_messages` (transport) | Reescrito do zero, dois níveis |
| (interpretação humana) | `journeys` | Entidade central explícita |
| empresa / company | `tenants` | Já decidido em arquitetura.md |

---

## 13. Decisões deliberadamente NÃO tomadas aqui

Pra próxima rodada ou fora de escopo do MVP:

- **Schema-level: índices, RLS policies, FORCE statements.** Vão na migration, seguindo [db-workflow.md](db-workflow.md).
- **Templates default de `form_templates` por tenant.** Modelo de schema definido (§4.3); seed do template "Avaliação Laser" inicial + perguntas canônicas (fototipo, contraindicações, medicações, etc.) entra junto da definição clínica mais profunda — ver decisoes-pendentes.md ("features específicas de estética/laser").
- **Cores específicas de jornada na UI.** Frontend resolve.
- **`message_templates` default por tenant.** Seed só pra começar (boas-vindas, lembrete, confirmação); admin customiza depois.
- **Cron expressions e janelas exatas dos automation triggers.** Definir na hora de implementar cada automação.
- **Comissionamento detalhado.** Tipo de quote influencia, mas fórmula vai num módulo `commissions` próprio depois.
- **Métodos de pagamento + integração com caixa.** Fechamento de venda (§16.4) registra o método (PIX, cartão N×, dinheiro, etc.) e contabiliza no caixa — escopo de módulo `payments` (a criar). Por ora, o fechamento move quote pra `accepted` e cria as sessions, mas o método de pagamento ainda não persiste.
- **Integração com formulários externos (RD Station etc).** Endpoint `/leads/inbound` + worker, escopo de próximo módulo.
- **Mapa corporal estruturado.** Pra enriquecer perguntas de `form_questions` com tipo "área corporal" (provavelmente nova `question_type` + tabela auxiliar de regiões).

---

## 14. Glossário

- **Journey**: ciclo completo de uma "venda" — do lead até o resultado. Entidade-mãe do domínio comercial.
- **Stage**: estágio atual da journey no funil (`lead → evaluation → sale → treatment → result`).
- **Source**: origem do lead — de onde veio a journey.
- **Quote origin**: caminho comercial pelo qual o orçamento nasceu (`evaluation`, `referral`, `direct_sale`).
- **Treatment**: agrupamento lógico de sessões de procedimento com objetivo único (laser axila completo, facial 10 sessões).
- **Procedure session**: execução individual de um procedimento.
- **Conversation**: histórico unificado de comunicação com um cliente (todas as jornadas).
- **Message**: unidade de comunicação dentro de uma conversation, opcionalmente vinculada a uma journey.
- **Transport layer (whatsapp_*)**: tabelas que falam com o adapter de provider (QuePasa, Meta Cloud API).
- **Domain layer (conversations, messages)**: tabelas que falam com o ciclo do cliente, agnósticas ao canal.
- **Recycling**: regra que cria novas journeys pra clientes existentes em segmentos específicos.
- **Form template**: questionário cadastrado pelo tenant (ex: "Avaliação Laser") com suas perguntas. Reusável entre clientes.
- **Client form**: instância preenchida de um template para um cliente específico. Unique `(client, template)`.
- **Form answer**: resposta individual de uma pergunta dentro de uma client form. Unique `(client_form, question)`.

---

## 15. Referências

- [arquitetura.md §2](arquitetura.md) — Multi-tenant + RLS
- [arquitetura.md §7](arquitetura.md) — Camada WhatsApp (provider-agnostic)
- [db-workflow.md](db-workflow.md) — Como evoluir schema
- decisoes-pendentes.md — Decisões em aberto (features específicas, billing, onboarding)
- [visao-geral.md](visao-geral.md) — Produto, mercado, posicionamento

---

## 16. Matriz de transições

> Fonte canônica para "o que dispara o que" no ciclo de uma journey. Quando um Service de qualquer módulo (`quotes`, `appointments`, `procedure_sessions`, etc.) muda estado de uma entidade, consulta esta seção pra saber se aquilo engatilha transição de journey, qual guard rail N3 validar e qual `journey_event` emitir. Se você está implementando um Service e a transição que precisa não está aqui, **pare e atualize esta seção primeiro**.

### 16.1 Estágios da journey (`journey.stage`)

| De → Para | Trigger | Auto/Manual | Guard rails N3 | Side effects |
|---|---|---|---|---|
| (criação) → `lead` | Inbound WhatsApp (chat); form submit; sheets sync; criação manual no core | Auto (chat) ou Manual (core) | Cliente sem journey ativa (1 active por vez — princípio §2.2) | `journey_event: journey_created` (payload `{source, sourceMetadata}`) |
| `lead` → `evaluation` | (a) `appointment.status` vira `attended` com `kind=evaluation`; **ou** (b) `POST /evaluations` (standalone, mesmo com `status='pending'`) | Auto | Journey em stage `lead` | `journey_event: stage_transitioned` (`{from, to, reason}`); `last_activity_at = now()`. Em (b), `reason='evaluation_created'`; em (a), `reason='evaluation_done'` |
| `lead` → `sale` (skip) | Quote `sent` vira `accepted` (closeSale) | Auto | Quote `status='accepted'` anexada à journey. `tenants.skip_evaluation=false` **não bloqueia** — gera apenas warning no log | idem |
| `evaluation` → `sale` | Quote `sent` vira `accepted` (closeSale) | Auto | (a) Quote `status='accepted'` anexada à journey; (b) Se tenant tem ≥1 `form_template.required_for_evaluation=true`, precisa de `client_form.status=completed` desse template | idem |
| `sale` → `treatment` | **1ª presença assinalada** (cliente assina foto+assinatura no link público — `attendance.sign`) | Auto | Existe ≥1 quote `status=accepted` na journey; existem `procedure_sessions` em `pending` na journey | Cria `treatment { started_at=now() }`; vincula sessões pendentes via `treatment_procedures`; marca sessão atual como `signed` (não `done`); `journey_event: treatment_started`; `last_activity_at = now()` |
| `treatment` → `result` | Último treatment ativo da journey sai de `active` | Auto | Todos os `treatments` desta journey em `completed`/`abandoned`/`manually_closed` | `journey_event: stage_transitioned` |

### 16.2 Status da journey (`journey.status`)

| De → Para | Trigger | Auto/Manual | Guard rails | Side effects |
|---|---|---|---|---|
| `active` → `won` | Profissional/admin clica "concluir jornada" | Manual | Stage atual = `result` | `journey_event: marked_won`; `closed_at = now()`. **Selo final — não reabre** (edições clínicas posteriores em treatments/sessions seguem permitidas pra sempre) |
| `active` → `lost` | Manual ("marcar como perdida") **ou** auto via automation `time_since_last_activity` | Manual + Auto | `lost_reason` obrigatório (`no_show`, `price`, `disqualified`, `timeout`, `other`) | `journey_event: marked_lost` (`{reason}`); `closed_at = now()` |

### 16.3 Transições de sub-entidades

Eventos que engatilham (ou habilitam guard rails de) transições da journey. Slot e evento clínico têm ciclos separados (chat-domain.md §4.4-4.5 — revisão 2026-05-20).

| Entidade | De → Para | Quem aciona | Efeito |
|---|---|---|---|
| `appointment` (qualquer kind) | `scheduled` → `confirmed` | Manual (recepção/cliente) | — |
| `appointment` (kind=evaluation) | `*` → `attended` | Manual (avaliadora marca presença) | Cascata: `evaluation.status = performed` + `journey_event: evaluation_done`; se journey em `lead`, **dispara `lead → evaluation`** |
| `appointment` (kind=procedure) | 1ª da journey vira `attended` | Cliente assina via link público (`attendance.sign`); appointment.attended é efeito colateral, junto com `procedure_session.status = signed`. Override admin via `appointments/:id/attend` ainda existe — mesma cascata, exceto que a `attendance_record` não é criada (sem foto/assinatura) | Cascata: `procedure_session.status = signed` + ensure treatment + linkage + **`sale → treatment`** + `journey_event: treatment_started`. **Sem auto-complete de treatment aqui** — `signed ≠ done` |
| `appointment` (kind=procedure) | demais → `attended` | Idem (sign público ou override admin) | Marca session `signed`. Auto-complete só dispara quando session vira `done` |
| `appointment` | `*` → `no_show` | Manual | Libera evaluation/session pra reagendamento. Entity não muda status |
| `appointment` | `*` → `cancelled` | Manual | Idem no_show — slot terminal, entity preserva pending |
| `evaluation` | (criação standalone) | Manual via `POST /evaluations` (walk-in / retroativa / preparar ficha) | Cria evaluation `status='pending'` + emite `journey_event: evaluation_created`. **Se journey em `lead`, dispara `lead → evaluation`** (não espera `performed`). Caminho via `POST /appointments kind=evaluation` cria evaluation inline mas NÃO transiciona — só na cascata do `attend` |
| `evaluation` | `pending` → `performed` | Auto via cascata do `appointment.attend` | Set `performed_at`, `performed_by_user_id` |
| `evaluation` | `pending` → `cancelled` | Manual ("cancelar avaliação") — decide que não vai mais acontecer | Independente de cancelar o slot. Permite recycling/reativação futura |
| `client_form` | `draft` → `completed` | Manual (avaliadora salva) | Habilita guard rail (b) de `evaluation → sale` |
| `quote` | `draft` → `sent` | Manual ("enviar orçamento") | Emite `journey_event: quote_sent`. **Não muda stage da journey** (mudança 2026-05 — antes disparava lead/evaluation → sale aqui) |
| `quote` | `sent` → `accepted` | Manual ("fechar venda" — ver §16.4) | Cria `procedure_sessions` em pending (eager); registra pagamento; emite `journey_event: sale_closed`. **Se journey em `lead` ou `evaluation`, dispara transição → `sale`** (lead → sale gera warning se `skip_evaluation=false`) |
| `quote` | `sent` → `draft` | Manual ("voltar para rascunho") | Limpa `sent_at`; reabre edição de itens. Emite `journey_event: quote_reverted_to_draft`. Substage da journey sai de `quoted` e recomputa baseado em messages/appointments |
| `quote` | `sent` → `rejected` | Manual | Insumo opcional pra journey `lost` |
| `quote` | `sent` → `expired` | Auto (worker diário checa `valid_until`) | — |
| `procedure_session` | `pending` → `signed` | Auto via cascata do `attendance.sign` (link público) ou `appointment.attend` (override admin) | Não dispara auto-complete (signed ainda é "em andamento") |
| `procedure_session` | `signed` → `done` | Manual via `POST /procedure-sessions/:id/evolve` — aplicadora registra evolução clínica (nota obrigatória) na página `/evolutions` (ou no popover da agenda, ou no detalhe do cliente). Gate de capacidade `canApplyProcedures` no actor. | Se for a última do último procedimento do treatment: **dispara `treatment.active → completed`** (auto). Emite `procedure_session.evolved` no Redis |
| `procedure_session` | `pending`/`signed` → `cancelled` | Manual ("cancelar sessão") — declara que não vai acontecer | Conta como "fora de pending+signed" — pode habilitar auto-complete do treatment se for a última não-concluída |
| `treatment` | `active` → `completed` | Auto (última session done) **ou** Manual ("encerrar tratamento") | Pode disparar `treatment → result` |
| `treatment` | `active` → `abandoned` | Auto (N dias sem sessão — automação) | Pode disparar `treatment → result` |
| `treatment` | `active` → `manually_closed` | Manual ("fechar manualmente") | Pode disparar `treatment → result` |

### 16.4 Conceitos específicos

**Fechamento de venda** (`quote.sent → accepted`). Operação que sela a transação financeira. Inclui:

1. Registro de **método de pagamento** + parcelamento (módulo `payments` — escopo de iteração futura; ver §13).
2. Criação **eager** de `procedure_sessions` em `pending` a partir de `quote_items.quantity_sessions` (uma session por sessão prescrita de cada procedimento).
3. `quote.status = accepted`; `quote.acceptedAt = now()`.
4. `journey_event: sale_closed`; `journey.last_activity_at = now()`.

**Stage muda apenas se ainda em `lead` ou `evaluation`** — closeSale dispara `lead → sale` ou `evaluation → sale` via `applyStageTransition`. Se a journey já estava em `sale` (fechamento de quote referral/cross-sell), o stage **não muda** — segue em `sale` até a 1ª presença. O start real do tratamento é sempre o presencial, não o financeiro.

**Criação do treatment** (`sale → treatment`). Acontece na 1ª presença assinalada — **não** no fechamento. Justificativa: `treatment.started_at` precisa refletir realidade física inquestionável (assinatura + foto do dia), não a intenção comercial do fechamento.

Sequência operacional do gatilho:
1. Cliente comparece. Aplicadora marca presença no `appointment` correspondente (kind=procedure) via `POST /appointments/:id/attend`.
2. Cliente assina + foto colhida. **1 assinatura + 1 foto por dia bastam** — se há múltiplas sessões no mesmo dia, todas compartilham essa assinatura/foto.
3. Sistema verifica: existe `treatment` ativo nesta journey?
   - **Não** → cria `treatment { started_at = now() }`; vincula todas as `procedure_sessions` ainda `pending` da journey via `treatment_procedures`.
   - **Sim** → usa o existente.
4. Marca a session vinculada a este appointment como `done`.
5. Se journey ainda está em `sale` → dispara `sale → treatment`.

**Auto-conclusão de treatment.** Quando a aplicadora marca a última `procedure_session` como `done`, o sistema verifica se todas as sessions ligadas ao treatment via `treatment_procedures` estão `done`. Se sim:
- `treatment.status = completed`
- `treatment.completed_at = now()`
- `journey_event: treatment_completed`
- Em seguida verifica se todos os treatments da journey saíram de `active` — se sim, dispara `treatment → result`.

**Sessões extras fora do plano.** Se a aplicadora cria uma `procedure_session` adicional (não prevista nos `quote_items` originais), ela entra em `treatment_procedures` e atrasa o auto-`completed`. Decisão consciente, registrada via `evolution_notes`.

**Won não reabre — mas trata bem o cenário de exceção.** Edições clínicas pós-`won` (fotos, observações, evolution_notes) seguem permitidas pra sempre. Para "reabrir tratamento" em casos genuínos (cliente volta pra sessão complementar): cria nova `procedure_session`, sistema pergunta se cria treatment novo ou reabre o existente (`completed → active`, limpa `completed_at`). Reabrir treatment volta automaticamente a journey de `result → treatment`. Ver §11.6.

### 16.5 Vocabulário canônico de `journey_events.event_type`

Schema mantém `varchar` livre, mas o app emite apenas estes valores. Adicionar novo evento = atualizar esta lista + emitir nos Services correspondentes.

| `event_type` | Quando | Payload sugerido |
|---|---|---|
| `journey_created` | Criação da journey | `{ source, sourceMetadata }` |
| `stage_transitioned` | Qualquer mudança de stage | `{ from, to }` |
| `marked_won` | `status = won` | — |
| `marked_lost` | `status = lost` | `{ reason }` |
| `evaluation_scheduled` | `appointment` criado com kind=evaluation | `{ appointmentId, evaluationId, scheduledAt }` |
| `evaluation_done` | `appointment.status = attended` com kind=evaluation | `{ appointmentId, evaluationId }` |
| `form_completed` | `client_form.status = completed` | `{ clientFormId, formTemplateId }` |
| `quote_created` | Quote criado | `{ quoteId, origin }` |
| `quote_sent` | `quote.status = sent` | `{ quoteId }` |
| `quote_reverted_to_draft` | Reversão manual `sent → draft` pra editar items/condições | `{ quoteId, previousSentAt }` |
| `sale_closed` | `quote.status = accepted` ("fechar venda") | `{ quoteId, paymentMethod? }` |
| `quote_rejected` | `quote.status = rejected` | `{ quoteId }` |
| `quote_deleted` | Hard-delete de quote em status `draft` pela UI | `{ quoteId, origin }` |
| `treatment_started` | Treatment criado (1ª presença) | `{ treatmentId, firstSessionId }` |
| `treatment_completed` | Treatment auto-completo | `{ treatmentId }` |
| `treatment_abandoned` | Auto via automação | `{ treatmentId }` |
| `treatment_manually_closed` | Manual | `{ treatmentId, reason? }` |
| `recycled_from` | Journey criada via `recycling_rule` | `{ previousJourneyId, recyclingRuleId }` |

### 16.6 Implementação

**Helper canônico**: `apps/core/src/shared/journeys/stageTransition.ts` (a criar). Toda transição passa por ele — Services **não** escrevem em `journeys.stage` direto. Assinatura prevista:

```ts
applyStageTransition(tx, journeyId, {
  to: 'evaluation' | 'sale' | 'treatment' | 'result',
  reason: JourneyEventType,   // qual gatilho — entra no journey_event
  guardContext?: {...}        // dados que o helper precisa pra validar guards N3
}): Promise<Journey>
```

Helper:
1. Lê journey atual + relacionados necessários.
2. Valida que `(from, to)` é par válido da §16.1.
3. Valida guard rails N3 da §16.1.
4. Atualiza `journeys.stage`, `last_activity_at`, e `closed_at` quando aplicável.
5. Insere linha em `journey_events`.

**Vocabulário de `event_type`** vive em TS como const union — type-checked em compile time:

```ts
export const JOURNEY_EVENT_TYPES = [
  'journey_created', 'stage_transitioned', 'marked_won', 'marked_lost',
  'evaluation_scheduled', 'evaluation_done', 'form_completed',
  'quote_created', 'quote_sent', 'quote_reverted_to_draft', 'sale_closed', 'quote_rejected', 'quote_deleted',
  'treatment_started', 'treatment_completed', 'treatment_abandoned',
  'treatment_manually_closed', 'recycled_from',
] as const;
export type JourneyEventType = (typeof JOURNEY_EVENT_TYPES)[number];
```

Reside em `apps/core/src/shared/journeys/eventTypes.ts`. Importado pelos Services que emitem eventos.
