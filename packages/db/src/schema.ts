import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  date,
  decimal,
  index,
  integer,
  jsonb,
  pgEnum,
  pgPolicy,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Expressão padrão das policies de tenant. Reutilizada pra evitar copy-paste.
const tenantPolicy = sql`tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid`;

// Horário de funcionamento da clínica. Estrutura semanal + timezone IANA.
// Cada dia pode ter 0..N janelas (almoço dividido vira 2 entries no mesmo dia).
// Dia ausente = clínica fechada. Usado pelo agente de IA pra decidir trigger
// "fora do horário" e pra responder dúvidas de horário ao cliente.
export interface BusinessHours {
  timezone: string;
  schedule: Array<{
    dayOfWeek: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    open: string;
    close: string;
  }>;
}

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: varchar('slug', { length: 63 }).notNull().unique(),
  // `name` é o rótulo curto exibido em UI/sidebar/header. `tradeName` (nome
  // fantasia) e `legalName` (razão social) são os dados oficiais usados em
  // contratos, recibos, NF e cabeçalho de impressão.
  name: varchar('name', { length: 255 }).notNull(),
  legalName: varchar('legal_name', { length: 255 }),
  tradeName: varchar('trade_name', { length: 255 }),
  // CNPJ armazenado em dígitos apenas (sem máscara). UI formata na
  // apresentação; Zod valida tamanho/dígito verificador na entrada.
  document: varchar('document', { length: 20 }),
  representativeName: varchar('representative_name', { length: 255 }),
  // ObjectKey do logo no bucket de mídia (R2/MinIO,
  // `env.storage.mediaBucket`). Mesma convenção de
  // `whatsapp_contacts.profile_picture_url` — NÃO é URL: frontend chama
  // GET /tenants/{id}/logo-url pra receber presigned URL renderizável.
  // Path canônico: `tenants/{tenantId}/logo.{png|jpg|webp}`.
  logoUrl: varchar('logo_url', { length: 1024 }),
  // Quando true, jornadas podem pular o estágio `evaluation` (ver chat-domain.md §5.1).
  skipEvaluation: boolean('skip_evaluation').notNull().default(false),
  // Agente de IA — feature flag por tenant (gate adicional ao
  // AGENT_GLOBAL_KILL_SWITCH em env). Default false: agente nasce desligado
  // pra cada tenant novo até admin ativar deliberadamente.
  agentEnabled: boolean('agent_enabled').notNull().default(false),
  // Minutos sem resposta humana antes do agente assumir a conversa (idle
  // trigger). Default 15 — equilíbrio entre dar tempo pra recepção atender
  // e não deixar cliente esperando. Configurável por tenant na UI.
  agentIdleMinutes: integer('agent_idle_minutes').notNull().default(15),
  // Texto livre que entra no system prompt — tom/persona específica da
  // clínica ("informal, próxima", "formal, técnica", etc). Null = usa
  // tom padrão definido no prompt.
  agentPersona: text('agent_persona'),
  // Horário de funcionamento. Usado por: agente IA (trigger out-of-hours +
  // tool getBusinessHours). Quando null, agente nunca dispara fora do
  // horário porque não sabe qual é. Ver docs/ai-agent-implementation.md §5.1.
  businessHours: jsonb('business_hours').$type<BusinessHours>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const units = pgTable(
  'units',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('units_tenant_id_idx').on(t.tenantId),
    unique('units_tenant_name_unique').on(t.tenantId, t.name),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Equipamentos compartilhados (laser, depilador, etc). Opcionais no agendamento.
// Sem gate de conflito por enquanto — schema permite mas validateSlot não cobre.
export const equipments = pgTable(
  'equipments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('equipments_tenant_id_idx').on(t.tenantId),
    unique('equipments_tenant_name_unique').on(t.tenantId, t.name),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Preferências do usuário guardadas como jsonb pra crescer sem migration a
// cada chave nova. Cada chave é opcional — defaults vivem no app, não no DB
// (evita drift entre o que o backend espera e o que está armazenado).
//
// Chaves atuais:
//   - chatNotificationLevel: 'quiet' | 'medium' | 'aggressive'
//     Controla como notificações de chat aparecem (badge / toast / pop-up).
//     Default no app: 'medium'.
//   - calendarColorMode: 'status' | 'procedure'
//     Determina qual cor vai como destaque do card de agendamento. A outra
//     vira ícone no canto do card. Default no app: 'status'.
export interface UserPreferences {
  chatNotificationLevel?: 'quiet' | 'medium' | 'aggressive';
  calendarColorMode?: 'status' | 'procedure';
}

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    // `username` é o identificador de login (unique por tenant). Substitui
    // o e-mail como credencial. `email` continua como campo de contato
    // (opcional, sem unique) — será usado por fluxos futuros de recuperação
    // de senha, comunicação transacional etc.
    username: varchar('username', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }),
    passwordHash: varchar('password_hash', { length: 255 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    active: boolean('active').notNull().default(true),
    // Capacidades profissionais — modelam *quem pode atender*, separadas das
    // permissões de role (PERMISSIONS map). Default false: admin marca quem é
    // avaliadora/aplicadora no cadastro. Validadas no AppointmentsService no
    // create/update contra appointment.kind.
    canEvaluate: boolean('can_evaluate').notNull().default(false),
    canApplyProcedures: boolean('can_apply_procedures').notNull().default(false),
    // Marca o user "system agent" criado pelo seed/provision pra cada tenant
    // (1 por tenant). Identidade que o apps/agent usa pra autenticar HTTP no
    // core via JWT. Não loga via /auth/login — passwordHash é descartado.
    // UI esconde esse user nas listas operacionais (filtra is_system_agent=false).
    // Ver docs/ai-agent-implementation.md §5.2.
    isSystemAgent: boolean('is_system_agent').notNull().default(false),
    preferences: jsonb('preferences')
      .$type<UserPreferences>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('users_tenant_id_idx').on(t.tenantId),
    unique('users_tenant_username_unique').on(t.tenantId, t.username),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const userUnits = pgTable(
  'user_units',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => units.id, { onDelete: 'cascade' }),
    // tenant_id desnormalizado pra que a policy RLS filtre sem JOIN.
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.unitId] }),
    index('user_units_tenant_id_idx').on(t.tenantId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// "ponte" entre tenants. Cada `groups.role_code` aponta pra um valor desse
// enum, e o app define permissões em código contra esses códigos (ver
// apps/core/src/shared/permissions/permissions.ts). Adicionar/remover um
// role exige migration + atualização do PERMISSIONS map.
export const roleCodeEnum = pgEnum('role_code', [
  'admin',
  'manager',
  'professional',
  'reception',
  'viewer',
  // System agent (apps/agent) — não-humano. Permissions enxutas: leitura de
  // catálogos + agendamento + envio de mensagem. Sem write em users/tenants/
  // sales. Group global "Agente IA" é o único vinculado a esse role.
  'agent',
]);

// Grupos são GLOBAIS (sem tenant_id, sem RLS). 1:1 com role_code — 5 grupos
// fixos, gerenciados pela equipe Elora (super-admin). Tenants só leem (e
// vinculam usuários via user_groups). Decisão registrada em arquitetura.md.
export const groups = pgTable(
  'groups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    roleCode: roleCodeEnum('role_code').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('groups_name_unique').on(t.name),
    unique('groups_role_code_unique').on(t.roleCode),
  ]
);

export const userGroups = pgTable(
  'user_groups',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    // tenant_id desnormalizado pra que a policy RLS filtre sem JOIN.
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.groupId] }),
    index('user_groups_tenant_id_idx').on(t.tenantId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Catálogo de menus — GLOBAL (sem tenant_id, sem RLS).
//
// A navegação é compartilhada entre tenants: o catálogo é único e mantido
// como dado de plataforma (idealmente via super-admin; ver permissions.ts).
// Quais menus cada tenant enxerga é definido em `menu_tenants`, e a
// visibilidade por grupo dentro do tenant continua em `menu_groups`.
export const menus = pgTable(
  'menus',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Auto-referência pra hierarquia. CASCADE: deletar um menu pai apaga
    // toda a subárvore — comportamento esperado pra "seção inteira removida".
    parentId: uuid('parent_id').references((): AnyPgColumn => menus.id, {
      onDelete: 'cascade',
    }),
    label: varchar('label', { length: 255 }).notNull(),
    icon: varchar('icon', { length: 64 }),
    // Cor do ícone na sidebar. Hex (`#RRGGBB`) ou qualquer valor CSS válido;
    // aplicado inline via style={{ color }} no frontend. Null = herda a cor
    // do texto/tema.
    color: varchar('color', { length: 32 }),
    path: varchar('path', { length: 512 }),
    position: integer('position').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('menus_parent_id_idx').on(t.parentId)]
);

// Quais menus cada tenant enxerga. Tabela de junção global (sem RLS) —
// gerenciada por super-admin junto com o próprio catálogo de menus. O
// tenant não pode adicionar/remover linhas daqui via API normal.
export const menuTenants = pgTable(
  'menu_tenants',
  {
    menuId: uuid('menu_id')
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.menuId, t.tenantId] }),
    index('menu_tenants_tenant_id_idx').on(t.tenantId),
  ]
);

// Visibilidade por grupo — GLOBAL (sem tenant_id, sem RLS). Liga grupo
// global a menu global. Toda clínica herda a mesma matriz menu×grupo,
// gerenciada pela equipe Elora.
export const menuGroups = pgTable(
  'menu_groups',
  {
    menuId: uuid('menu_id')
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.menuId, t.groupId] })]
);

// Catálogo de relatórios — GLOBAL (sem tenant_id, sem RLS).
//
// Banco é projeção do `reportRegistry` (código). Cada linha tem um `slug`
// (chave natural) que aponta pra um handler no código. Sync no boot do
// `apps/core` faz upsert do registry pra cá; relatórios removidos do
// código viram `active=false` (preservando refs em report_tenants/groups).
//
// Visibilidade segue o pattern dos menus: report_tenants (super-admin
// habilita pra tenant) + report_groups (define quais grupos veem).
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 128 }).notNull().unique(),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 64 }).notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('reports_category_idx').on(t.category),
    index('reports_active_idx').on(t.active),
  ]
);

// Quais relatórios cada tenant enxerga. Tabela de junção global (sem RLS).
export const reportTenants = pgTable(
  'report_tenants',
  {
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.reportId, t.tenantId] }),
    index('report_tenants_tenant_id_idx').on(t.tenantId),
  ]
);

// Visibilidade por grupo — GLOBAL (sem tenant_id, sem RLS). Mesmo
// pattern de `menu_groups`: matriz única gerenciada pela equipe Elora.
export const reportGroups = pgTable(
  'report_groups',
  {
    reportId: uuid('report_id')
      .notNull()
      .references(() => reports.id, { onDelete: 'cascade' }),
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.reportId, t.groupId] })]
);

export const exampleOption = pgEnum('example_option', ['option1', 'option2', 'option3']);

  
export const example = pgTable(
  'example',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eVarchar: varchar('e_varchar', { length: 255 }).notNull(),
    eText: text('e_text'),
    eInteger: integer('e_integer').notNull().default(0),
    eDecimal: decimal('e_decimal', { precision: 10, scale: 2 }),
    eBoolean: boolean('e_boolean').notNull().default(false),
    eDate: date('e_date'),
    eJsonb: jsonb('e_jsonb').$type<{ tags?: string[]; meta?: Record<string, unknown> }>(),
    eEnum: exampleOption('e_enum'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('example_tenant_id_idx').on(t.tenantId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// =====================================================================
// CHAT DOMAIN — modelo do ciclo do cliente (ver docs/chat-domain.md)
// =====================================================================

// ---- Enums do domínio ----

export const journeyStageEnum = pgEnum('journey_stage', [
  'lead',
  'evaluation',
  'sale',
  'treatment',
  'result',
]);

export const journeySourceEnum = pgEnum('journey_source', [
  'whatsapp',
  'form',
  'sheets',
  'manual',
  'recycling',
  'imported',
  'other',
]);

export const journeyStatusEnum = pgEnum('journey_status', ['active', 'won', 'lost']);

// Sub-etapa específica do funil de lead (chat-domain.md §5.1, extensão 2026-05).
// Só faz sentido quando `journeys.stage = 'lead'` — coluna fica NULL nos demais
// stages. Mantida atualizada via `recomputeLeadSubstage` (helper idempotente
// que inspeciona messages/appointments/quotes). Precedência:
//   quoted > rescheduled > no_show > scheduled > contact > template > new
//
// Mesma ideia se replica em evaluation no futuro (`evaluation_substage`).
export const leadSubstageEnum = pgEnum('lead_substage', [
  'new',          // inbound recebido, sem nenhuma outbound de staff
  'template',     // outbound enviado (template ou livre), sem inbound posterior
  'contact',      // inbound posterior à última outbound — conversa estabelecida
  'scheduled',    // appointment kind=evaluation com data futura
  'no_show',      // appointment kind=evaluation com status=no_show
  'rescheduled',  // ≥2 appointments kind=evaluation, último futuro após no_show
  'quoted',       // quote enviado (status ≠ draft) sem aceite ainda
]);

// Ciclo do SLOT (chat-domain.md §16.3). `attended` substitui o antigo `done`
// pra desacoplar "cliente compareceu" de "evento foi concluído" — o último
// fica em evaluations.status / procedure_sessions.status.
export const appointmentStatusEnum = pgEnum('appointment_status', [
  'scheduled',
  'confirmed',
  'attended',
  'no_show',
  'cancelled',
]);

// Discriminador polimórfico: cada appointment é OU pra uma evaluation OU
// pra uma procedure_session. CHECK constraint na migration garante 1-1.
export const appointmentKindEnum = pgEnum('appointment_kind', [
  'evaluation',
  'procedure',
]);

// Ciclo da AVALIAÇÃO como evento clínico (separado do slot).
export const evaluationStatusEnum = pgEnum('evaluation_status', [
  'pending',
  'performed',
  'cancelled',
]);

// Tipo de avaliação — `initial` é o primeiro contato presencial, `return`
// é cliente que voltou pra novo ciclo de tratamento (não-VIP), `reevaluation`
// é revisão dentro do mesmo tratamento (ex: avaliar resultado parcial).
export const evaluationKindEnum = pgEnum('evaluation_kind', [
  'initial',
  'reevaluation',
  'return',
]);

export const quoteOriginEnum = pgEnum('quote_origin', [
  'evaluation',
  'referral',
  'direct_sale',
]);

export const quoteStatusEnum = pgEnum('quote_status', [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
]);

// Status da venda fechada. `open` enquanto há parcelas em pending; vira `paid`
// quando todas as parcelas foram recebidas; `cancelled` é placeholder pra
// estorno (out-of-scope no MVP — sem fluxo de UI ainda).
export const saleStatusEnum = pgEnum('sale_status', [
  'open',
  'paid',
  'cancelled',
]);

// Status de cada parcela. Recálculo de `sales.status` é responsabilidade do
// service quando uma parcela muda — não há trigger Postgres.
export const paymentStatusEnum = pgEnum('payment_status', [
  'pending',
  'paid',
  'cancelled',
]);

// Métodos de pagamento. Espelha `paymentMethodValues` em
// quotes/QuotesTypes.ts — fonte da verdade aqui (TS importa do enum).
export const paymentMethodEnum = pgEnum('payment_method', [
  'pix',
  'credit_card',
  'debit_card',
  'cash',
  'bank_transfer',
  'other',
]);

export const treatmentStatusEnum = pgEnum('treatment_status', [
  'active',
  'completed',
  'abandoned',
  'manually_closed',
]);

// `signed` = cliente assinou a presença (foto + assinatura via link público).
// `done` = profissional aplicou + concluiu evolução clínica (lifecycle pós-presença).
// A separação permite distinguir "compareceu" de "procedimento finalizado" —
// auto-complete de treatment exige `done`, não basta `signed`.
export const procedureSessionStatusEnum = pgEnum('procedure_session_status', [
  'pending',
  'signed',
  'done',
  'cancelled',
]);

export const messageDirectionEnum = pgEnum('message_direction', [
  'inbound',
  'outbound',
  'internal_note',
]);

export const messageKindEnum = pgEnum('message_kind', [
  'text',
  'media',
  'template',
  'system',
  // Sticker recebido. Stickers são tratados como categoria própria (não cabem
  // em 'media' porque não têm caption e a UI renderiza diferente — bolha sem
  // background). V1 só recepção; envio (sendSticker) virá quando for pedido.
  'sticker',
  // Evento de chamada de voz/vídeo. Não há "conteúdo" — payload em
  // `call_payload`. UI renderiza como linha de notificação dentro da
  // timeline (ícone + status + duração).
  'call',
]);

// Tipo de mídia atrelado a `messages.kind='media'` ou `'sticker'`. Separado de
// `kind` porque UI/queries querem distinguir "é foto" vs "é áudio" sem ter que
// abrir `whatsapp_messages.payload`.
export const messageMediaTypeEnum = pgEnum('message_media_type', [
  'image',
  'audio',
  'video',
  'document',
  'sticker',
]);

// Quem disparou a remoção. Frontend usa pra escolher o texto exibido na
// timeline ("Você apagou esta mensagem" vs "Esta mensagem foi apagada pelo
// cliente"). Soft delete sempre — registro nunca sai do banco (audit).
export const messageDeletionOriginEnum = pgEnum('message_deletion_origin', [
  'client',
  'staff',
  'system',
]);

// Estado de entrega de uma mensagem outbound. Fluxo:
//   pending  → INSERT no controller (HTTP 201 imediato) e enfileirado pro worker
//   sent     → adapter Evolution confirmou envio (sent_at preenchido)
//   failed   → adapter chamado mas falhou (rede, provider_error, timeout do worker)
//   rejected → pre-flight bloqueou antes de chamar adapter (no opt-in, canal off, etc)
// `delivered_at` e `read_at` continuam em colunas próprias — eventos pós-envio
// que rolam só quando status='sent'.
export const messageDeliveryStatusEnum = pgEnum('message_delivery_status', [
  'pending',
  'sent',
  'failed',
  'rejected',
]);

// Motivo da falha/rejeição. Lista fechada pra: (a) i18n consistente, (b) action
// map no frontend (cada reason → ação contextual no botão da bolha), (c) métricas.
// Detalhe rico (status code Evolution, retryAfter, mensagem provider) vai em
// failure_detail (jsonb) separado, pra debug sem inflar o enum.
//
// Categoria por reason:
//   rejected (pre-flight): no_opt_in, not_on_whatsapp, channel_disconnected,
//                          window_24h_expired, invalid_template, rate_limited
//   failed   (adapter):    provider_error, worker_timeout, unknown
export const messageFailureReasonEnum = pgEnum('message_failure_reason', [
  'no_opt_in',
  'not_on_whatsapp',
  'channel_disconnected',
  'window_24h_expired',
  'invalid_template',
  'rate_limited',
  'provider_error',
  'worker_timeout',
  'unknown',
]);

export const formQuestionTypeEnum = pgEnum('form_question_type', [
  'text',
  'yes_no',
  'multiple_choice',
  'scale',
  'number',
  'date',
]);

export const clientFormStatusEnum = pgEnum('client_form_status', [
  'draft',
  'completed',
  'archived',
]);

// Tipos de gatilho de automação. Ver chat-domain.md §4.10.
export const automationTriggerTypeEnum = pgEnum('automation_trigger_type', [
  'time_before_evaluation_appointment',
  'time_after_evaluation_appointment',
  'time_before_procedure_appointment',
  'time_after_procedure_appointment',
  'time_since_last_session',
  'time_since_last_activity',
  'journey_stage_changed',
  'client_birthday',
  'quote_status_changed',
]);

export const messageTemplateKindEnum = pgEnum('message_template_kind', ['text', 'media']);

// Provider WhatsApp (ver arquitetura.md §7).
// `baileys` = não-oficial via WhatsApp Web (Evolution-Baileys); `meta_cloud` =
// Cloud API oficial (Evolution-Business). Nome genérico-técnico em vez de
// nome de produto pra não amarrar enum a vendor específico.
export const whatsappProviderTypeEnum = pgEnum('whatsapp_provider_type', [
  'baileys',
  'meta_cloud',
]);

export const whatsappMessageDirectionEnum = pgEnum('whatsapp_message_direction', [
  'inbound',
  'outbound',
]);

// ---- Catálogo de procedimentos ----
// Tabela mínima: módulo `procedures` próprio expande depois (mapa corporal,
// pacotes de sessão, fototipo). Por ora, só o esqueleto que `quote_items` e
// `procedure_sessions` precisam pra ter FK válida.
export const procedures = pgTable(
  'procedures',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    defaultSessions: integer('default_sessions').notNull().default(1),
    defaultPrice: decimal('default_price', { precision: 12, scale: 2 }),
    // Cor pro card na agenda — formato '#RRGGBB'. Quando UI está no modo
    // `procedure` (preferência do user), essa cor vira o destaque do card.
    // Null = fallback neutro.
    color: varchar('color', { length: 7 }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('procedures_tenant_id_idx').on(t.tenantId),
    unique('procedures_tenant_name_unique').on(t.tenantId, t.name),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Endereço de cliente. Jsonb porque é um agrupamento estável de campos
// raramente consultados individualmente (uso típico: cabeçalho de
// contrato/recibo) — flexibilidade sem migration nova quando precisar.
// Todos campos opcionais; defaults vivem no app, não no DB.
export interface ClientAddress {
  zipCode?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  country?: string;
}

// ---- Clientes (ver chat-domain.md §4.1) ----
export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    phoneE164: varchar('phone_e164', { length: 20 }).notNull(),
    email: varchar('email', { length: 255 }),
    birthDate: date('birth_date'),
    // CPF em dígitos apenas (sem máscara). Nullable porque menor de idade
    // costuma usar o CPF do responsável — não há sempre CPF próprio.
    document: varchar('document', { length: 20 }),
    address: jsonb('address').$type<ClientAddress>(),
    notes: text('notes'),
    isVip: boolean('is_vip').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('clients_tenant_id_idx').on(t.tenantId),
    // Matching por telefone é como inbound de WhatsApp identifica o cliente.
    unique('clients_tenant_phone_unique').on(t.tenantId, t.phoneE164),
    index('clients_tenant_birth_month_idx').on(t.tenantId, t.birthDate),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// ---- Fichas / Anamneses (templates + perguntas + fichas preenchidas + respostas) ----
// Modelo: tenant tem N form_templates → template tem N form_questions
// cliente × template = 1 client_form (com N form_answers, uma por question).
// Inspirado no módulo `anamneses` do corpo-bueno, simplificado: cada question
// pertence diretamente a um template (sem catálogo compartilhado).

export const formTemplates = pgTable(
  'form_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    // Quando true, a UI de avaliação exige uma ficha desse template antes de
    // mover a journey de `evaluation → sale` (guard rail N3, ver §9 e §5.2).
    requiredForEvaluation: boolean('required_for_evaluation').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('form_templates_tenant_id_idx').on(t.tenantId),
    unique('form_templates_tenant_name_unique').on(t.tenantId, t.name),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const formQuestions = pgTable(
  'form_questions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    formTemplateId: uuid('form_template_id')
      .notNull()
      .references(() => formTemplates.id, { onDelete: 'cascade' }),
    prompt: text('prompt').notNull(),
    questionType: formQuestionTypeEnum('question_type').notNull(),
    // Pra multiple_choice/scale. Para outros tipos, fica null.
    options: jsonb('options').$type<string[] | Record<string, unknown>>(),
    section: varchar('section', { length: 128 }),
    position: integer('position').notNull().default(0),
    required: boolean('required').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('form_questions_tenant_id_idx').on(t.tenantId),
    index('form_questions_template_id_idx').on(t.formTemplateId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const clientForms = pgTable(
  'client_forms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    // Ancorada na evaluation pra preservar histórico evolutivo: cada
    // avaliação (initial, reevaluation, return) gera seu próprio conjunto
    // de fichas. Comparação inicial vs reavaliação fica trivial.
    evaluationId: uuid('evaluation_id')
      .notNull()
      .references((): AnyPgColumn => evaluations.id, { onDelete: 'cascade' }),
    // Denormalizado pra query rápida "todas as fichas desse cliente" sem
    // JOIN. Mantido em sync via service (não trigger) — todo write passa
    // pelo Drizzle, mesmo trade-off documentado pra updatedAt.
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    formTemplateId: uuid('form_template_id')
      .notNull()
      .references(() => formTemplates.id, { onDelete: 'restrict' }),
    status: clientFormStatusEnum('status').notNull().default('draft'),
    filledAt: timestamp('filled_at'),
    completedByUserId: uuid('completed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('client_forms_tenant_id_idx').on(t.tenantId),
    index('client_forms_client_id_idx').on(t.clientId),
    index('client_forms_evaluation_id_idx').on(t.evaluationId),
    // 1 ficha por (avaliação, template). Reavaliação = nova evaluation =
    // nova linha. Histórico de respostas dentro da mesma evaluation vive
    // em form_answers.updatedAt + journey_events.
    unique('client_forms_evaluation_template_unique').on(
      t.evaluationId,
      t.formTemplateId,
    ),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const formAnswers = pgTable(
  'form_answers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    clientFormId: uuid('client_form_id')
      .notNull()
      .references(() => clientForms.id, { onDelete: 'cascade' }),
    questionId: uuid('question_id')
      .notNull()
      .references(() => formQuestions.id, { onDelete: 'cascade' }),
    // Colunas tipadas separadas (espelha o padrão do CB respostas_anamnese).
    // Apenas uma costuma ser preenchida; jsonb cobre tipos compostos.
    answerText: text('answer_text'),
    answerOption: varchar('answer_option', { length: 255 }),
    answerBoolean: boolean('answer_boolean'),
    answerNumber: decimal('answer_number', { precision: 18, scale: 4 }),
    answerDate: date('answer_date'),
    answerData: jsonb('answer_data').$type<Record<string, unknown>>(),
    professionalObservation: text('professional_observation'),
    answeredAt: timestamp('answered_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('form_answers_tenant_id_idx').on(t.tenantId),
    index('form_answers_client_form_id_idx').on(t.clientFormId),
    // 1 resposta por (ficha, pergunta). Update sobrescreve.
    unique('form_answers_form_question_unique').on(t.clientFormId, t.questionId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// ---- Conversations e Journeys (chat-domain.md §4.2, §4.9) ----
// `conversations` é 1-por-(cliente, canal-whatsapp) — se um cliente fala com
// 2 canais diferentes da clínica, são 2 conversations separadas. Decisão de
// produto: cada canal tem identidade própria (cor, número, equipe), histórico
// não deve misturar. Quando outros providers (Instagram, etc) entrarem, ou
// `whatsapp_channel_id` vira nullable + adiciona `instagram_channel_id`, ou
// generaliza num `channel_id` polimórfico — repensar quando virar dor real.
// Definida ANTES de `journeys` porque `messages.journey_id` é opcional —
// não há FK circular.

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    whatsappChannelId: uuid('whatsapp_channel_id')
      .notNull()
      .references(() => whatsappChannels.id, { onDelete: 'cascade' }),
    lastMessageAt: timestamp('last_message_at'),
    // Marca o momento em que algum staff viu a conversa por último.
    // Unread = mensagens inbound com sent_at > coalesce(last_staff_seen_at, '-infinity').
    // V1: tracking compartilhado entre staff (mesma semântica do WhatsApp Web
    // multi-device). Per-user fica como evolução quando dor real aparecer.
    lastStaffSeenAt: timestamp('last_staff_seen_at'),
    // Pausa o agente IA pra esta conversa até o timestamp indicado. Setado por:
    //   - tool handoffToHuman (default: now + 1h)
    //   - botão "Assumir conversa" da UI (PR 8 — now + 24h tipicamente)
    // Null = agente ativo (sujeito a tenant.agent_enabled + kill switch).
    // AgentRunner checa antes de gastar tokens. Frontend mostra indicador
    // visual quando agent_paused_until > now.
    agentPausedUntil: timestamp('agent_paused_until'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('conversations_tenant_id_idx').on(t.tenantId),
    index('conversations_channel_idx').on(t.whatsappChannelId),
    unique('conversations_client_channel_unique').on(
      t.clientId,
      t.whatsappChannelId,
    ),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const journeys = pgTable(
  'journeys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    stage: journeyStageEnum('stage').notNull().default('lead'),
    source: journeySourceEnum('source').notNull(),
    sourceMetadata: jsonb('source_metadata').$type<Record<string, unknown>>(),
    status: journeyStatusEnum('status').notNull().default('active'),
    // Sub-etapa do funil. Só populated quando stage='lead'; null nos demais.
    // Mantida atualizada via `recomputeLeadSubstage`. Reset pra null quando
    // stage avança pra evaluation (ver applyStageTransition).
    leadSubstage: leadSubstageEnum('lead_substage'),
    // Enum interno (varchar pra crescer sem migration): no_show, price,
    // disqualified, timeout, other. Preenchido quando status='lost'.
    lostReason: varchar('lost_reason', { length: 64 }),
    // Atualizado pela aplicação em qualquer ação de staff (ver §4.2, §10.1).
    // Inbound do cliente NÃO mexe esse campo.
    lastActivityAt: timestamp('last_activity_at').notNull().defaultNow(),
    closedAt: timestamp('closed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('journeys_tenant_id_idx').on(t.tenantId),
    index('journeys_client_id_idx').on(t.clientId),
    index('journeys_stage_status_idx').on(t.tenantId, t.stage, t.status),
    // Kanban de leads filtra/agrupa por substage frequentemente.
    index('journeys_lead_substage_idx').on(t.tenantId, t.leadSubstage),
    // Fila manual de orçamento parado e recycling rules varrem por inatividade.
    index('journeys_last_activity_idx').on(t.tenantId, t.lastActivityAt),
    // No máximo 1 journey ativa por cliente. Partial index — closed/lost/won
    // não contam, podem coexistir múltiplas no histórico. Sem isso o
    // find-or-create em CoreGateway.journeysFindOrCreateActive abria race
    // quando dois webhooks inbound chegavam em paralelo (visto em prod
    // 2026-06-11). Catch de 23505 no service re-busca a vencedora.
    uniqueIndex('journeys_client_active_unique')
      .on(t.clientId)
      .where(sql`status = 'active'`),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Audit trail de transições de stage e marcos da journey (criação, won/lost,
// recycling). `event_type` é varchar livre pra não forçar migration em cada
// novo tipo de evento.
export const journeyEvents = pgTable(
  'journey_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    eventType: varchar('event_type', { length: 64 }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('journey_events_tenant_id_idx').on(t.tenantId),
    index('journey_events_journey_id_idx').on(t.journeyId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// ---- Agendas unificadas (chat-domain.md §4.4 + §4.5 refatorados) ----
// Decisão de design (2026-05-20): unificamos `evaluation_appointments` +
// `procedure_appointments` em uma única tabela `appointments` polimórfica
// (via `kind` + um dos FKs `evaluation_id` / `procedure_session_id`).
// Avaliação vira entidade própria (`evaluations`) — não mais "appointment
// de avaliação". Cada tabela tem seu próprio ciclo de status (slot vs.
// evento clínico) — ver §16.3.

// Avaliação como entidade clínica. Lifecycle desacoplado do slot.
export const evaluations = pgTable(
  'evaluations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    kind: evaluationKindEnum('kind').notNull().default('initial'),
    status: evaluationStatusEnum('status').notNull().default('pending'),
    // Set quando appointment vai pra `attended` com kind=evaluation.
    performedAt: timestamp('performed_at'),
    performedByUserId: uuid('performed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    generalNotes: text('general_notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('evaluations_tenant_id_idx').on(t.tenantId),
    index('evaluations_journey_id_idx').on(t.journeyId),
    index('evaluations_client_id_idx').on(t.clientId),
    index('evaluations_status_idx').on(t.tenantId, t.status),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Agenda unificada. CHECK na migration garante que exatamente um dos FKs
// (`evaluation_id` XOR `procedure_session_id`) está preenchido conforme `kind`.
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    kind: appointmentKindEnum('kind').notNull(),
    evaluationId: uuid('evaluation_id').references(() => evaluations.id, {
      onDelete: 'cascade',
    }),
    procedureSessionId: uuid('procedure_session_id').references(
      () => procedureSessions.id,
      { onDelete: 'cascade' }
    ),
    professionalId: uuid('professional_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'restrict' }),
    equipmentId: uuid('equipment_id').references(() => equipments.id, {
      onDelete: 'set null',
    }),
    scheduledAt: timestamp('scheduled_at').notNull(),
    durationMinutes: integer('duration_minutes').notNull().default(30),
    status: appointmentStatusEnum('status').notNull().default('scheduled'),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('appointments_tenant_id_idx').on(t.tenantId),
    index('appointments_journey_id_idx').on(t.journeyId),
    index('appointments_scheduled_idx').on(t.tenantId, t.scheduledAt),
    index('appointments_professional_idx').on(t.professionalId, t.scheduledAt),
    index('appointments_equipment_idx').on(t.equipmentId, t.scheduledAt),
    index('appointments_evaluation_idx').on(t.evaluationId),
    index('appointments_session_idx').on(t.procedureSessionId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// ---- Orçamentos (§4.6) ----

export const quotes = pgTable(
  'quotes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    origin: quoteOriginEnum('origin').notNull(),
    totalAmount: decimal('total_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    discountAmount: decimal('discount_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    status: quoteStatusEnum('status').notNull().default('draft'),
    validUntil: timestamp('valid_until'),
    notes: text('notes'),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    sentAt: timestamp('sent_at'),
    acceptedAt: timestamp('accepted_at'),
    rejectedAt: timestamp('rejected_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('quotes_tenant_id_idx').on(t.tenantId),
    index('quotes_journey_id_idx').on(t.journeyId),
    index('quotes_status_idx').on(t.tenantId, t.status),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const quoteItems = pgTable(
  'quote_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'cascade' }),
    procedureId: uuid('procedure_id')
      .notNull()
      .references(() => procedures.id, { onDelete: 'restrict' }),
    quantitySessions: integer('quantity_sessions').notNull().default(1),
    unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
    discountPct: decimal('discount_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('quote_items_tenant_id_idx').on(t.tenantId),
    index('quote_items_quote_id_idx').on(t.quoteId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// ---- Vendas (fechamento de quote) ----
//
// `sales` representa a venda fechada de um quote. No MVP a relação é 1:1
// (1 quote → 1 sale), mas o modelo já permite múltiplas (quoteId é FK não-
// única). Items "perdidos" do quote (não selecionados no fechamento) ficam
// apenas como histórico em `quote_items`, sem contrapartida em `sale_items`.
//
// FK `quote_id` é RESTRICT: não permite deletar o quote enquanto houver
// uma sale vinculada. `journey_id` e `client_id` são denormalizados pra
// consulta direta sem join (RLS já cobre tenant).
export const sales = pgTable(
  'sales',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    quoteId: uuid('quote_id')
      .notNull()
      .references(() => quotes.id, { onDelete: 'restrict' }),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    subtotalAmount: decimal('subtotal_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    discountAmount: decimal('discount_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    totalAmount: decimal('total_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    paidAmount: decimal('paid_amount', { precision: 12, scale: 2 })
      .notNull()
      .default('0'),
    status: saleStatusEnum('status').notNull().default('open'),
    closedAt: timestamp('closed_at').notNull().defaultNow(),
    closedByUserId: uuid('closed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('sales_tenant_id_idx').on(t.tenantId),
    index('sales_quote_id_idx').on(t.quoteId),
    index('sales_journey_id_idx').on(t.journeyId),
    index('sales_client_id_idx').on(t.clientId),
    index('sales_status_idx').on(t.tenantId, t.status),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Snapshot dos quote_items que entraram na venda. Valores são DUPLICADOS
// (unit_price, discount_pct, quantity_sessions) propositalmente — preserva
// o que o cliente comprou mesmo se alguém editar o quote_item depois.
// `quote_item_id` é SET NULL pra sobreviver à exclusão do item de origem
// (raro mas possível em migrações futuras).
export const saleItems = pgTable(
  'sale_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    quoteItemId: uuid('quote_item_id').references(() => quoteItems.id, {
      onDelete: 'set null',
    }),
    procedureId: uuid('procedure_id')
      .notNull()
      .references(() => procedures.id, { onDelete: 'restrict' }),
    quantitySessions: integer('quantity_sessions').notNull(),
    unitPrice: decimal('unit_price', { precision: 12, scale: 2 }).notNull(),
    discountPct: decimal('discount_pct', { precision: 5, scale: 2 })
      .notNull()
      .default('0'),
    // unit_price * quantity_sessions * (1 - discount_pct/100). Cache pra
    // evitar recompute em queries de relatório — service mantém sincronizado.
    computedAmount: decimal('computed_amount', { precision: 12, scale: 2 }).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('sale_items_tenant_id_idx').on(t.tenantId),
    index('sale_items_sale_id_idx').on(t.saleId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Parcelas (1 sale → N payments). `installment_number` é 1-based; combinado
// com `total_installments` permite display "2/3" sem agregar. Sem unique
// constraint em (sale_id, installment_number) pra permitir edição futura
// (ex: dividir uma parcela em duas) — service mantém integridade.
//
// `due_date` é date (sem hora) pois parcela é negociada em dia. `paid_at`
// é timestamp pra rastrear momento exato do recebimento.
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    installmentNumber: integer('installment_number').notNull(),
    totalInstallments: integer('total_installments').notNull(),
    amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
    paymentMethod: paymentMethodEnum('payment_method').notNull(),
    dueDate: date('due_date').notNull(),
    paidAt: timestamp('paid_at'),
    status: paymentStatusEnum('status').notNull().default('pending'),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('payments_tenant_id_idx').on(t.tenantId),
    index('payments_sale_id_idx').on(t.saleId),
    index('payments_status_idx').on(t.tenantId, t.status),
    // Pra relatório de "parcelas a vencer/vencidas" sem scan completo.
    index('payments_due_date_idx').on(t.tenantId, t.dueDate),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// ---- Tratamentos e sessões (§4.7, §4.8) ----

export const treatments = pgTable(
  'treatments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    journeyId: uuid('journey_id')
      .notNull()
      .references(() => journeys.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    status: treatmentStatusEnum('status').notNull().default('active'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('treatments_tenant_id_idx').on(t.tenantId),
    index('treatments_journey_id_idx').on(t.journeyId),
    index('treatments_status_idx').on(t.tenantId, t.status),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Sessão de procedimento. Lifecycle desacoplado da agenda (chat-domain.md
// §16.3). Link com appointment é uni-direcional via appointments.procedure_session_id —
// uma session pode ter múltiplos appointments ao longo do tempo (reagendamento,
// no_show). Pra encontrar o "appointment atual" duma session pendente, query
// reversa em appointments filtrando por status não-terminal.
export const procedureSessions = pgTable(
  'procedure_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    procedureId: uuid('procedure_id')
      .notNull()
      .references(() => procedures.id, { onDelete: 'restrict' }),
    // Rastreio de qual sale_item originou esta sessão. Nullable porque
    // sessões podem nascer sem venda (futuro: cortesia, retorno gratuito).
    // SET NULL pra não cascatear deleção em histórico clínico.
    saleItemId: uuid('sale_item_id').references(() => saleItems.id, {
      onDelete: 'set null',
    }),
    status: procedureSessionStatusEnum('status').notNull().default('pending'),
    executedAt: timestamp('executed_at'),
    executedByUserId: uuid('executed_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    evolutionNotes: text('evolution_notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('proc_sessions_tenant_id_idx').on(t.tenantId),
    index('proc_sessions_client_id_idx').on(t.clientId),
    index('proc_sessions_sale_item_id_idx').on(t.saleItemId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// M:N treatments ↔ procedure_sessions (§4.7 — 1 treatment pode ter sessões
// de quotes diferentes; 1 quote pode gerar sessões de 2 treatments).
export const treatmentProcedures = pgTable(
  'treatment_procedures',
  {
    treatmentId: uuid('treatment_id')
      .notNull()
      .references(() => treatments.id, { onDelete: 'cascade' }),
    procedureSessionId: uuid('procedure_session_id')
      .notNull()
      .references(() => procedureSessions.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.treatmentId, t.procedureSessionId] }),
    index('treatment_procedures_tenant_id_idx').on(t.tenantId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// ---- Presença assinada de sessões de procedimento ----
// Cliente atesta presença em sessão(ões) via foto + assinatura num link
// público. Uma assinatura cobre TODAS as sessões `pending` do cliente na
// mesma data — o token é gerado no popover da agenda e snapshota o escopo
// no momento da emissão (sessions adicionadas depois não são cobertas e
// precisam de novo token).
//
// Layout em 3 tabelas:
//   `procedure_session_attendances` — header (1 linha por evento de assinatura)
//   `procedure_session_attendance_sessions` — junction com session_id UNIQUE
//   `procedure_session_signing_tokens` — token de uso único c/ expiração

export const procedureSessionAttendances = pgTable(
  'procedure_session_attendances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    // Dia da clínica em que a presença foi atestada. Snapshot do `attendance_date`
    // resolvido no token — não muda mesmo que o cliente assine perto da virada.
    attendanceDate: date('attendance_date').notNull(),
    // Object keys no MinIO/R2. Foto: WebP comprimida no cliente (~30-80KB).
    // Assinatura: SVG vetorial (~2-8KB). Bucket dedicado `attendances` —
    // separação de governança/retenção em relação a `contracts` e `whatsapp`.
    signatureObjectKey: varchar('signature_object_key', { length: 1024 }).notNull(),
    photoObjectKey: varchar('photo_object_key', { length: 1024 }).notNull(),
    signedAt: timestamp('signed_at').notNull().defaultNow(),
    signedFromIp: varchar('signed_from_ip', { length: 64 }),
    signedUserAgent: text('signed_user_agent'),
    // Flags de auditoria — true significa que o backend confirmou contra
    // `clients.document` e `clients.birth_date` antes de aceitar o sign.
    // Ambos serão sempre true em V1 (gate obrigatório), mas guardar deixa
    // espaço pra fluxos futuros (ex: assinatura no tablet da clínica com
    // operador presente, dispensa confirmação dupla).
    cpfConfirmed: boolean('cpf_confirmed').notNull().default(false),
    birthDateConfirmed: boolean('birth_date_confirmed').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('proc_session_attend_tenant_id_idx').on(t.tenantId),
    index('proc_session_attend_client_date_idx').on(
      t.tenantId,
      t.clientId,
      t.attendanceDate
    ),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const procedureSessionAttendanceSessions = pgTable(
  'procedure_session_attendance_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    attendanceId: uuid('attendance_id')
      .notNull()
      .references(() => procedureSessionAttendances.id, { onDelete: 'cascade' }),
    // UNIQUE: uma sessão só pode estar coberta por UMA assinatura. Tentar
    // gerar outra atendência cobrindo a mesma sessão dispara 23505 — guard
    // contra dupla-assinatura por race ou bug de UI.
    sessionId: uuid('session_id')
      .notNull()
      .references(() => procedureSessions.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('proc_session_attend_sessions_session_unique').on(t.sessionId),
    index('proc_session_attend_sessions_tenant_id_idx').on(t.tenantId),
    index('proc_session_attend_sessions_attendance_idx').on(t.attendanceId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const procedureSessionSigningTokens = pgTable(
  'procedure_session_signing_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    // Token random 32 bytes hex (64 chars). UNIQUE no tenant — colisão
    // praticamente impossível mas o unique elimina dúvida.
    token: varchar('token', { length: 128 }).notNull(),
    attendanceDate: date('attendance_date').notNull(),
    // Snapshot dos session_ids cobertos no momento da emissão. Manter como
    // jsonb em vez de tabela junção: o escopo é imutável (token novo é
    // gerado se houver mudança de agenda), simplifica leitura/escrita.
    sessionIds: jsonb('session_ids')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    expiresAt: timestamp('expires_at').notNull(),
    // Carimbado quando o sign endpoint roda com sucesso. Token consumido
    // não é mais aceito (single-use). Tokens vencidos sem consumir ficam
    // no banco até GC manual — sem cron de limpeza no MVP.
    consumedAt: timestamp('consumed_at'),
    // Erros de verificação de CPF/data — protege contra brute-force trivial.
    // Após N falhas, o token é invalidado (consumed_at carimbado mesmo
    // sem sign válido).
    verifyAttempts: integer('verify_attempts').notNull().default(0),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('proc_session_signing_tokens_token_unique').on(t.token),
    index('proc_session_signing_tokens_tenant_id_idx').on(t.tenantId),
    index('proc_session_signing_tokens_client_date_idx').on(
      t.tenantId,
      t.clientId,
      t.attendanceDate
    ),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// ---- Message templates (domain) e WhatsApp transport (arquitetura.md §7.2) ----
// Definidos antes de `messages` porque messages aponta pra ambos.

export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    body: text('body').notNull(),
    kind: messageTemplateKindEnum('kind').notNull().default('text'),
    // Em quais stages da journey esse template aparece como sugestão na UI
    // (ver §9 nível 2). Array de valores do enum journey_stage como text[].
    surfaceInStage: text('surface_in_stage').array(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('msg_templates_tenant_id_idx').on(t.tenantId),
    unique('msg_templates_tenant_name_unique').on(t.tenantId, t.name),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Canal WhatsApp. Trocar de track = nova instância Evolution + novo canal +
// migrar conversas (ver arquitetura.md §7.2/§7.5). `provider_config` é jsonb
// pra ser livre por provider — pra Evolution real:
// { baseUrl, instanceName, apiKey, integration, webhookToken }.
export const whatsappChannels = pgTable(
  'whatsapp_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    providerType: whatsappProviderTypeEnum('provider_type').notNull(),
    providerConfig: jsonb('provider_config')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    phoneNumber: varchar('phone_number', { length: 32 }),
    active: boolean('active').notNull().default(true),
    // Estado do socket reportado por CONNECTION_UPDATE do Evolution. Não
    // restringido por enum pra não exigir migration a cada novo state que
    // o provider invente. Valores esperados: 'open' | 'connecting' |
    // 'closed' | 'unknown'. Null = nunca recebemos evento ainda
    // (instância recém-provisionada, mock, etc).
    connectionState: varchar('connection_state', { length: 16 }),
    connectionStateAt: timestamp('connection_state_at'),
    // Cor de destaque do canal — usada na UI pra diferenciar visualmente
    // conversas de canais diferentes (border-left no MinimizedCard, header
    // tint no FloatingChatWindow). Formato `#RRGGBB`. Null = neutro
    // (UI usa cor default do tema).
    color: varchar('color', { length: 7 }),
    // Cutoff temporal pro agente de IA: inbounds com `received_at` anterior
    // a esse timestamp NÃO disparam trigger (ver IdleTriggerScheduler no
    // apps/agent). Existe pra evitar que o backfill histórico do Baileys
    // (mensagens antigas importadas no pareamento) faça o agente responder
    // conversas anteriores à sincronização. Default `now()` no insert: canal
    // novo só considera inbounds dali em diante. Imutável em V1 — quando
    // virar dor, vira reset manual via UI.
    agentStartsAt: timestamp('agent_starts_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('wa_channels_tenant_id_idx').on(t.tenantId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const whatsappContacts = pgTable(
  'whatsapp_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    whatsappChannelId: uuid('whatsapp_channel_id')
      .notNull()
      .references(() => whatsappChannels.id, { onDelete: 'restrict' }),
    // Link com clients é N:1 quando aplicável (chat-domain.md §3). Null
    // quando ainda não soubermos quem é (lead anônimo, opt-in pendente).
    clientId: uuid('client_id').references(() => clients.id, {
      onDelete: 'set null',
    }),
    phoneE164: varchar('phone_e164', { length: 20 }).notNull(),
    // Número que o WhatsApp efetivamente reconhece — pode divergir do
    // `phone_e164` (número "real" do cliente) por causa da quirk brasileira:
    // celulares com DDD ≥ 31 muitas vezes têm a conta WhatsApp cadastrada
    // sem o nono dígito, embora a linha móvel tenha. Resolvido pelo provider
    // via `resolveNumber` (probe das variantes com/sem 9); cacheado aqui pra
    // não pagar o roundtrip a cada envio. Null = ainda não resolvido — worker
    // resolve no primeiro envio e faz UPDATE.
    whatsappE164: varchar('whatsapp_e164', { length: 20 }),
    profileName: varchar('profile_name', { length: 255 }),
    // URL da foto de perfil do contato no WhatsApp, espelhada pro MinIO
    // (URLs do Evolution/Baileys são efêmeras — expiram em horas). Atualizada
    // no primeiro inbound do contato e via endpoint manual de refresh. Null =
    // contato sem foto ou ainda não buscamos.
    profilePictureUrl: varchar('profile_picture_url', { length: 1024 }),
    // Disciplina operacional Cloud-like aplicada em ambos os tracks
    // (Baileys e Meta Cloud) — ver arquitetura.md §7.3.
    optedInAt: timestamp('opted_in_at'),
    optInSource: varchar('opt_in_source', { length: 64 }),
    // Contact ativo do cliente. Quando cliente muda de número, o contact
    // antigo vira active=false (preserva histórico de mensagens) e um novo
    // active=true é criado. Partial unique abaixo garante no máximo 1
    // active por cliente. Contatos sem clientId (lead anônimo) ficam fora
    // dessa restrição.
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('wa_contacts_tenant_id_idx').on(t.tenantId),
    index('wa_contacts_client_id_idx').on(t.clientId),
    // Mesmo contato (phone) só uma vez por canal.
    unique('wa_contacts_channel_phone_unique').on(t.whatsappChannelId, t.phoneE164),
    // No máximo 1 contact ativo por cliente. Partial index — contatos sem
    // clientId (anônimos) e contatos inativos (histórico) não contam.
    uniqueIndex('wa_contacts_client_active_unique')
      .on(t.clientId)
      .where(sql`${t.clientId} IS NOT NULL AND ${t.active} = true`),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const whatsappConversations = pgTable(
  'whatsapp_conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    whatsappChannelId: uuid('whatsapp_channel_id')
      .notNull()
      .references(() => whatsappChannels.id, { onDelete: 'restrict' }),
    whatsappContactId: uuid('whatsapp_contact_id')
      .notNull()
      .references(() => whatsappContacts.id, { onDelete: 'cascade' }),
    // Liga ao domain-level. Pode ser null se transport criou contato sem
    // ainda ter resolvido cliente.
    conversationId: uuid('conversation_id').references(() => conversations.id, {
      onDelete: 'set null',
    }),
    // Tracking da janela de 24h (arquitetura.md §7.3).
    lastInboundAt: timestamp('last_inbound_at'),
    lastOutboundAt: timestamp('last_outbound_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('wa_convs_tenant_id_idx').on(t.tenantId),
    index('wa_convs_conversation_idx').on(t.conversationId),
    unique('wa_convs_channel_contact_unique').on(t.whatsappChannelId, t.whatsappContactId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const whatsappMessages = pgTable(
  'whatsapp_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    whatsappConversationId: uuid('whatsapp_conversation_id')
      .notNull()
      .references(() => whatsappConversations.id, { onDelete: 'cascade' }),
    // ID do provider (Evolution key.id, wamid Meta). Não-único globalmente,
    // único por (channel/provider).
    externalId: varchar('external_id', { length: 255 }),
    direction: whatsappMessageDirectionEnum('direction').notNull(),
    // text, image, audio, document, etc. Mantemos varchar pra absorver
    // tipos de mídia sem migration.
    payloadType: varchar('payload_type', { length: 32 }).notNull().default('text'),
    payload: jsonb('payload').$type<Record<string, unknown>>(),
    // Status do provider: queued, sent, delivered, read, failed.
    status: varchar('status', { length: 32 }),
    statusUpdatedAt: timestamp('status_updated_at'),
    errorMessage: text('error_message'),
    sentAt: timestamp('sent_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('wa_messages_tenant_id_idx').on(t.tenantId),
    index('wa_messages_conv_idx').on(t.whatsappConversationId, t.createdAt),
    index('wa_messages_external_idx').on(t.externalId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Template Meta-ready. `meta_template_id` e `meta_status` ficam null em
// canais Baileys (auto-approved); só são preenchidos em canais `meta_cloud`
// (ver arquitetura.md §7.2). Cada template Meta amarra a um channel
// específico + um message_template (domain).
export const whatsappTemplates = pgTable(
  'whatsapp_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    whatsappChannelId: uuid('whatsapp_channel_id')
      .notNull()
      .references(() => whatsappChannels.id, { onDelete: 'cascade' }),
    messageTemplateId: uuid('message_template_id')
      .notNull()
      .references(() => messageTemplates.id, { onDelete: 'cascade' }),
    metaTemplateId: varchar('meta_template_id', { length: 255 }),
    metaStatus: varchar('meta_status', { length: 32 }),
    metaCategory: varchar('meta_category', { length: 64 }),
    metaLanguage: varchar('meta_language', { length: 16 }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('wa_templates_tenant_id_idx').on(t.tenantId),
    unique('wa_templates_channel_template_unique').on(
      t.whatsappChannelId,
      t.messageTemplateId
    ),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// ---- Messages domain-level (§4.9) ----
// Mensagem do ciclo. Carrega journey_id opcional pra tagging visual e
// `whatsapp_message_id` quando veio do transport WhatsApp. `internal_note`
// só existe aqui — nunca em whatsapp_messages.
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    journeyId: uuid('journey_id').references(() => journeys.id, {
      onDelete: 'set null',
    }),
    direction: messageDirectionEnum('direction').notNull(),
    kind: messageKindEnum('kind').notNull().default('text'),
    body: text('body'),
    mediaUrl: varchar('media_url', { length: 1024 }),
    // Tipo de mídia. Null quando kind != 'media'/'sticker'. Sticker recebido
    // tem kind='sticker' + mediaType='sticker' (redundância proposital — query
    // por tipo de payload fica `WHERE media_type = ?` sem precisar olhar kind).
    mediaType: messageMediaTypeEnum('media_type'),
    // Carga útil de evento de chamada (kind='call'). Schema:
    //   { direction: 'inbound'|'outbound', status: 'missed'|'received'|'declined',
    //     durationSec?: number, startedAt: string ISO }
    // jsonb por ser caso de uso baixo volume — não vale 4 colunas dormindo em
    // toda mensagem comum.
    callPayload: jsonb('call_payload').$type<{
      direction: 'inbound' | 'outbound';
      status: 'missed' | 'received' | 'declined';
      durationSec?: number;
      startedAt: string;
    }>(),
    // Edição de mensagem. Preenchido tanto quando o cliente edita uma msg
    // inbound (capturada via webhook messages.update com edit flag) quanto
    // quando staff edita uma outbound (chamada explícita do endpoint PATCH).
    // O `body` é sobrescrito in-place — não mantemos histórico de versões
    // (mesmo comportamento do WhatsApp). Frontend mostra badge "editada".
    editedAt: timestamp('edited_at'),
    // Soft delete. Nunca DELETE físico — auditoria do histórico de conversa
    // precisa preservar tudo. Frontend olha `deletionOrigin` pra decidir o
    // texto exibido ("Você apagou esta mensagem" vs "Esta mensagem foi
    // apagada pelo cliente"). `body`/`mediaUrl` ficam intactos no DB; UI é
    // quem esconde — permite recuperar conteúdo numa auditoria interna.
    deletedAt: timestamp('deleted_at'),
    deletionOrigin: messageDeletionOriginEnum('deletion_origin'),
    templateId: uuid('template_id').references(() => messageTemplates.id, {
      onDelete: 'set null',
    }),
    // Variáveis usadas na renderização do template — preservadas porque o
    // worker outbound (que chama Cloud API) precisa delas pra construir o
    // request `template_name + components.parameters`, e o body renderizado
    // sozinho não permite remontar essa estrutura. Null pra kind != 'template'.
    templateVariables: jsonb('template_variables').$type<Record<string, string>>(),
    whatsappMessageId: uuid('whatsapp_message_id').references(
      () => whatsappMessages.id,
      { onDelete: 'set null' }
    ),
    // Mensagem que está sendo respondida ("quoted"/"reply"). FK auto-referência
    // dentro da mesma `conversation_id` (validado na app — Postgres não tem
    // partial composite FK). Outbound: staff seleciona msg pela UI → service
    // valida same-conversation antes do INSERT. Inbound: pipeline lê
    // contextInfo.stanzaId do webhook, resolve via externalId+conversation,
    // grava aqui. on delete SET NULL preserva a bolha do reply quando o alvo
    // é apagado/excluído.
    replyToMessageId: uuid('reply_to_message_id').references(
      (): AnyPgColumn => messages.id,
      { onDelete: 'set null' }
    ),
    authorUserId: uuid('author_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    // Marcador de origem fora do sistema: mensagem outbound que o staff
    // mandou direto pelo celular pareado (não passou pela UI do Elora).
    // Capturada pelo webhook MESSAGES_UPSERT com `fromMe=true` + externalId
    // novo (não conhecemos). `author_user_id` fica null por construção
    // — não temos como saber qual operador no celular fez. Visível pra
    // staff como badge na bolha de mensagem.
    authoredOnDevice: boolean('authored_on_device').notNull().default(false),
    // Status de entrega — alimenta o badge visual da bolha (spinner pendente,
    // check enviada, alerta laranja em rejeitada/falhada). Default 'pending'
    // pra outbound recém-inserida; inbound/internal_note nascem direto como
    // 'sent' (são caminhos que não passam pelo worker outbound).
    //
    // Transições válidas:
    //   pending → sent      (worker: adapter confirmou)
    //   pending → failed    (worker: adapter chamou e falhou OU timeout)
    //   pending → rejected  (worker: pre-flight bloqueou antes do adapter)
    //   sent    → (terminal — delivered/read são em colunas próprias)
    //   failed/rejected → pending (retry manual via UI re-enfileira)
    deliveryStatus: messageDeliveryStatusEnum('delivery_status')
      .notNull()
      .default('pending'),
    // Preenchido quando deliveryStatus ∈ ('failed','rejected'). Frontend mapeia
    // pra texto PT-BR + ação contextual (ex: 'no_opt_in' → botão "Pedir opt-in").
    failureReason: messageFailureReasonEnum('failure_reason'),
    // Contexto rico do erro (status code Evolution, retryAfterSec, mensagem
    // bruta do provider). Não exibido na UI principal — usado em debug/audit
    // e tooltips avançados. Jsonb pra evoluir sem migration.
    failureDetail: jsonb('failure_detail').$type<Record<string, unknown>>(),
    sentAt: timestamp('sent_at'),
    deliveredAt: timestamp('delivered_at'),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('messages_tenant_id_idx').on(t.tenantId),
    index('messages_conversation_idx').on(t.conversationId, t.createdAt),
    index('messages_journey_idx').on(t.journeyId),
    index('messages_whatsapp_idx').on(t.whatsappMessageId),
    // Reconciliação de pending stuck: query a cada 5min faz
    // `WHERE delivery_status='pending' AND created_at < NOW() - INTERVAL '5 min'`.
    // Index parcial economiza espaço (a maioria das messages é 'sent') e
    // mantém scan barato. createdAt no index pra range query rápida.
    index('messages_pending_stuck_idx')
      .on(t.createdAt)
      .where(sql`delivery_status = 'pending'`),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Assinaturas Web Push (notificação do sistema quando chega mensagem no
// chat). Uma linha por navegador/aparelho: o `endpoint` é a URL do serviço
// de push (FCM, Mozilla, Apple) que identifica aquela instalação. Nasce
// quando o usuário clica "Ativar" em Preferências e morre no logout, ao
// desativar, ou quando o serviço de push responde 404/410 (expirada).
// Endpoint único por tenant: o mesmo aparelho usado por outro usuário do
// tenant troca o dono da linha (upsert), nunca duplica.
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull(),
    // Chaves da criptografia do payload (RFC 8291), geradas pelo navegador.
    p256dh: varchar('p256dh', { length: 255 }).notNull(),
    auth: varchar('auth', { length: 255 }).notNull(),
    userAgent: varchar('user_agent', { length: 512 }),
    lastSuccessAt: timestamp('last_success_at'),
    // Falhas seguidas que não são 404/410 (5xx, timeout). Zera no sucesso.
    failureCount: integer('failure_count').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('push_subscriptions_tenant_id_idx').on(t.tenantId),
    index('push_subscriptions_user_idx').on(t.tenantId, t.userId),
    unique('push_subscriptions_tenant_endpoint_unique').on(t.tenantId, t.endpoint),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// ---- Automações (§4.10) ----

export const automations = pgTable(
  'automations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    triggerType: automationTriggerTypeEnum('trigger_type').notNull(),
    // Janelas (offset_minutes, cron, etc.), parâmetros do trigger.
    triggerConfig: jsonb('trigger_config')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    // Filtros: { stage?, source?, status?, is_vip?, ... }
    filters: jsonb('filters')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    templateId: uuid('template_id').references(() => messageTemplates.id, {
      onDelete: 'restrict',
    }),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('automations_tenant_id_idx').on(t.tenantId),
    index('automations_active_idx').on(t.tenantId, t.active),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// =====================================================================
// AVAILABILITY — disponibilidade do profissional (chat-domain.md §17)
// =====================================================================
// Decisão (2026-05-20): regras semanais + exceções pontuais, com slots
// calculados on-the-fly (computeFreeSlots). Substitui o padrão eager
// do Corpo-Bueno (slots pré-materializados como rows "disponível").
//
// MVP enxuto: sem `unit_id` em schedules nem em exceptions — disponibilidade
// é global por user. Multi-unidade entra quando dor real aparecer (adiciona
// coluna nullable + lógica condicional na helper).

export const weekdayEnum = pgEnum('weekday', [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
]);

// Janelas semanais recorrentes do profissional. Múltiplas linhas por dia
// se houver intervalo (manhã + tarde como rows separadas). Histórico
// preservado via `effective_from`/`effective_to` — mudar escala = nova row
// (não UPDATE), pra audit ficar inteiro.
export const professionalSchedules = pgTable(
  'professional_schedules',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dayOfWeek: weekdayEnum('day_of_week').notNull(),
    // Postgres TIME (sem timezone) — '08:00' formato HH:MM ou HH:MM:SS.
    startTime: time('start_time').notNull(),
    endTime: time('end_time').notNull(),
    effectiveFrom: date('effective_from').notNull().defaultNow(),
    effectiveTo: date('effective_to'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('prof_schedules_tenant_id_idx').on(t.tenantId),
    index('prof_schedules_user_id_idx').on(t.userId),
    // Filtro frequente: "horários do user X no dia Y vigentes em Z".
    index('prof_schedules_user_day_idx').on(t.userId, t.dayOfWeek),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const scheduleExceptionKindEnum = pgEnum('schedule_exception_kind', [
  'vacation',
  'sick',
  'training',
  'holiday',
  'other',
]);

// Bloqueios pontuais que furam a regra semanal. Range timestamp inclusivo
// no início, exclusivo no fim — interval overlap padrão. CHECK na migration
// garante end_at > start_at.
export const scheduleExceptions = pgTable(
  'schedule_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    startAt: timestamp('start_at').notNull(),
    endAt: timestamp('end_at').notNull(),
    kind: scheduleExceptionKindEnum('kind').notNull().default('other'),
    notes: text('notes'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('schedule_exc_tenant_id_idx').on(t.tenantId),
    index('schedule_exc_user_id_idx').on(t.userId),
    // Index pra overlap range queries (encontrar exceções que cobrem uma data).
    index('schedule_exc_user_range_idx').on(t.userId, t.startAt, t.endAt),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// =====================================================================
// CONTRACTS — assinatura eletrônica via ZapSign
// =====================================================================
// Contratos digitais (termos de consentimento, contratos de pacote, cessão
// de imagem) enviados pra assinatura via ZapSign. O PDF/DOCX vive no painel
// do ZapSign cadastrado como template com variáveis — aqui guardamos só o
// apontamento, as variáveis preenchidas no envio e o status devolvido pelo
// webhook deles. PDF final assinado é baixado e armazenado no MinIO/R2.
//
// Config do provider é global por env var (ZAPSIGN_API_TOKEN). Se cada
// tenant precisar conta própria no futuro, vira tabela signature_providers.

export const contractKindEnum = pgEnum('contract_kind', [
  'consent_term', // Termo de consentimento esclarecido (procedimento estético)
  'service_contract', // Contrato de prestação de serviço (pacote/tratamento)
  'image_release', // Termo de cessão/uso de imagem
  'other',
]);

export const contractStatusEnum = pgEnum('contract_status', [
  'draft', // Criado localmente, ainda não enviado pro ZapSign
  'sent', // Documento criado no ZapSign, aguardando assinatura
  'viewed', // Signer abriu o link de assinatura
  'signed', // Assinado por todos signers
  'declined', // Signer recusou
  'expired', // Prazo expirou sem assinatura
  'cancelled', // Cancelado manualmente via API
]);

// Templates de contrato (pointer pra template cadastrado no painel ZapSign).
// O documento (PDF/DOCX) e a marcação das variáveis vivem lá — aqui guardamos
// só o ID externo + nome amigável + lista de variáveis esperadas, pra UI saber
// quais campos renderizar no form de envio.
export const contractTemplates = pgTable(
  'contract_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    kind: contractKindEnum('kind').notNull().default('consent_term'),
    // UUID do template no ZapSign (retornado quando cadastra template lá).
    zapsignTemplateId: varchar('zapsign_template_id', { length: 64 }).notNull(),
    // Lista de variáveis que o template espera, ex: ['clientName', 'procedure', 'sessionCount'].
    // Source of truth são as variáveis marcadas no template do ZapSign; este array é
    // o snapshot pro front renderizar o form sem chamar a API deles a cada abertura.
    variables: jsonb('variables')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('contract_templates_tenant_id_idx').on(t.tenantId),
    unique('contract_templates_tenant_name_unique').on(t.tenantId, t.name),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

export const contracts = pgTable(
  'contracts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    // Quando o contrato faz parte de um funil (lead → avaliação → venda).
    journeyId: uuid('journey_id').references(() => journeys.id, {
      onDelete: 'set null',
    }),
    // Vínculo com a venda (Fase 7). Nullable: preserva contratos avulsos criados
    // pela ClientDetailPage antes dessa fase. A partir de agora todo contrato novo
    // nasce com saleId. Cascade: venda nunca é hard-deletada (só cancelled), então
    // apagar uma sale levando os contratos junto é aceitável.
    saleId: uuid('sale_id').references(() => sales.id, { onDelete: 'cascade' }),
    // Null se o contrato veio de upload de PDF avulso (rota futura).
    templateId: uuid('template_id').references(() => contractTemplates.id, {
      onDelete: 'restrict',
    }),
    // Snapshot das variáveis preenchidas no envio (não recomputa depois).
    // Formato compatível com a API do ZapSign: { name, value }[].
    variables: jsonb('variables')
      .$type<Array<{ name: string; value: string }>>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    kind: contractKindEnum('kind').notNull().default('consent_term'),
    title: varchar('title', { length: 255 }).notNull(),
    status: contractStatusEnum('status').notNull().default('draft'),

    // ---- Refs ZapSign ----
    zapsignDocumentId: varchar('zapsign_document_id', { length: 64 }),
    // open_id público que o ZapSign retorna — compõe a URL pública.
    zapsignOpenId: varchar('zapsign_open_id', { length: 64 }),
    // URL pública de assinatura entregue ao cliente via WhatsApp.
    signUrl: varchar('sign_url', { length: 1024 }),

    // ---- Storage (após signed) ----
    // Object key do PDF assinado no MinIO/R2 (null até webhook signed).
    signedPdfObjectKey: varchar('signed_pdf_object_key', { length: 1024 }),

    // ---- Timestamps de evento ----
    sentAt: timestamp('sent_at'),
    viewedAt: timestamp('viewed_at'),
    signedAt: timestamp('signed_at'),
    declinedAt: timestamp('declined_at'),
    expiresAt: timestamp('expires_at'),

    failureReason: text('failure_reason'),

    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),

    // Idempotência de criação. Frontend gera UUID quando o sheet abre; backend
    // checa se já existe row com a mesma chave dentro do tenant antes de chamar
    // o provider — protege contra double-submit (duplo-clique, 2 abas) que
    // antes criava 2 docs órfãos na ZapSign. Nullable pra suportar criação
    // server-side (ex: scripts admin) sem inventar chave.
    idempotencyKey: varchar('idempotency_key', { length: 64 }),

    // Auditoria extra do webhook (IP, geo, user-agent do signer).
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('contracts_tenant_id_idx').on(t.tenantId),
    index('contracts_client_id_idx').on(t.clientId),
    index('contracts_journey_id_idx').on(t.journeyId),
    // Filtro frequente: "contratos pendentes do tenant X".
    index('contracts_status_idx').on(t.tenantId, t.status),
    // Listagem de contratos por venda (SaleContractsSection).
    index('contracts_sale_id_idx').on(t.saleId),
    // Regra 1: no máximo 1 contrato de serviço ativo por venda. Parcial pra
    // ignorar cancelled (libera nova criação) e contratos avulsos (sale_id NULL).
    uniqueIndex('contracts_sale_service_active_unique')
      .on(t.saleId)
      .where(
        sql`kind = 'service_contract' AND status <> 'cancelled' AND sale_id IS NOT NULL`,
      ),
    // Regras 2+3: 1 consent_term ativo por (venda, template). Dedup automático —
    // se 2 procedimentos da venda usam o mesmo template, o 2º INSERT bate 23505
    // e a service interpreta como skip silencioso.
    uniqueIndex('contracts_sale_consent_template_active_unique')
      .on(t.saleId, t.templateId)
      .where(
        sql`kind = 'consent_term' AND status <> 'cancelled' AND sale_id IS NOT NULL`,
      ),
    // Resolver contract pelo doc_id quando webhook chega (1:1).
    uniqueIndex('contracts_zapsign_doc_id_unique')
      .on(t.zapsignDocumentId)
      .where(sql`zapsign_document_id IS NOT NULL`),
    // Unicidade de idempotência por tenant. Parcial pra permitir múltiplos
    // contratos sem chave (criação server-side legítima).
    uniqueIndex('contracts_tenant_idempotency_unique')
      .on(t.tenantId, t.idempotencyKey)
      .where(sql`idempotency_key IS NOT NULL`),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Vínculo N:M entre templates de termo de consentimento e procedimentos (Fase 7).
// Define quais procedimentos exigem qual termo — alimenta o "Gerar termos
// pendentes" da venda (dedup por template) e a subtabela em Settings. A dependência
// aponta do domínio de contratos PRA o catálogo (procedures), não o inverso:
// procedures não conhece contract_templates.
export const consentTemplateProcedures = pgTable(
  'consent_template_procedures',
  {
    // Denormalizado pra RLS — policy usa app.current_tenant. Sem FK direto:
    // pattern já usado em sale_items, evita overhead de FK redundante (PK
    // composta + RLS já isolam). Service preenche no link().
    tenantId: uuid('tenant_id').notNull(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => contractTemplates.id, { onDelete: 'cascade' }),
    procedureId: uuid('procedure_id')
      .notNull()
      .references(() => procedures.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.templateId, t.procedureId] }),
    index('consent_template_procs_procedure_idx').on(t.procedureId),
    index('consent_template_procs_tenant_idx').on(t.tenantId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// =====================================================================
// AGENTE DE IA — V1 (2026-06)
// =====================================================================
// Domínio do apps/agent (novo). Tabelas dão suporte a:
//   - agent_turns: persistência de cada rodada do agente (input do trigger,
//     LLM calls, tools executadas, mensagens enviadas, custo, latência).
//   - conversation_tags: catálogo por tenant de tags aplicáveis a uma
//     conversa (definidas pelo tenant + instrução em PT-BR de quando aplicar).
//   - conversation_tag_assignments: junção N:M conversation × tag, com
//     procedência opcional (qual agent_turn aplicou).
//
// Fonte da verdade do plano: docs/ai-agent-implementation.md.
// =====================================================================

export const agentTriggerTypeEnum = pgEnum('agent_trigger_type', [
  'idle',           // X min sem resposta humana após mensagem do cliente
  'out_of_hours',   // mensagem chegou fora do horário de funcionamento
  'manual_resume',  // staff devolveu conversa pro agente após pausa
]);

// Audit trail de cada rodada do agente. Append-only — uma row por chamada
// do AgentRunner. Não polui `messages` (que vira só conteúdo humano-visível);
// `output_message_ids` faz o link reverso quando o turno produziu outbound.
//
// `tool_calls` jsonb guarda o array completo de invocações do loop (LLM pode
// chamar N tools antes de responder). Granularidade boa pra debug; quando
// virar dor (query "tool X falhou quantas vezes"), promover pra tabela filha.
//
// Não tem `.$onUpdate` em updated_at porque rows são imutáveis após criadas
// — mantido só pra consistência com o resto do schema.
export const agentTurns = pgTable(
  'agent_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    triggerType: agentTriggerTypeEnum('trigger_type').notNull(),
    // Payload livre do disparador: { idleMinutes }, { detectedAt, businessHoursSnapshot }, etc.
    triggerMetadata: jsonb('trigger_metadata').$type<Record<string, unknown>>(),
    // Última mensagem inbound do cliente que motivou o turno. SET NULL se a
    // mensagem for apagada — preserva o turno pra auditoria de custo.
    inputMessageId: uuid('input_message_id').references(() => messages.id, {
      onDelete: 'set null',
    }),
    // Identificador da versão do prompt usada (ex: "agendamento.v1"). Permite
    // comparar performance entre versões sem precisar reconstruir o prompt.
    promptVersion: text('prompt_version').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    // Prompt caching da Anthropic — separamos read (hit, 10% do preço) de
    // creation (miss, 125% do preço) pra calcular cost_cents corretamente.
    cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
    cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
    // Custo total da rodada em centavos de USD (4 casas decimais pra
    // não perder precisão em chamadas baratas). Conversão pra BRL é
    // responsabilidade da camada de relatório.
    costCents: decimal('cost_cents', { precision: 10, scale: 4 })
      .notNull()
      .default('0'),
    latencyMs: integer('latency_ms').notNull().default(0),
    toolCalls: jsonb('tool_calls')
      .$type<AgentToolCallRecord[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    // IDs das mensagens criadas como resposta ao cliente nesse turno (pode
    // ser 0..N). Array nativo do PG, preserva ordem de envio.
    outputMessageIds: uuid('output_message_ids').array(),
    classificationTagIds: uuid('classification_tag_ids').array(),
    // Quando o agente desistiu e abriu handoff, motivo curto pra log/UI.
    handoffReason: text('handoff_reason'),
    // Erro fatal da rodada (ex: provider 5xx persistente, JSON inválido do
    // LLM, max iterations atingido). NULL = rodada concluída ok.
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // Painel "custo por dia por tenant" varre por (tenant, created_at desc).
    index('agent_turns_tenant_created_idx').on(t.tenantId, t.createdAt),
    // Histórico do agente numa conversation específica (timeline / debug).
    index('agent_turns_conv_created_idx').on(t.conversationId, t.createdAt),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Estrutura do array em `agent_turns.tool_calls`. Mantida no schema pra
// servir como contrato pros services (chat/agent) que leem o jsonb.
export interface AgentToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: 'ok' | 'error';
  resultPayload?: unknown;
  errorMessage?: string;
  ms: number;
}

// Catálogo de tags definido pelo tenant. Aplicado a conversations via
// `conversation_tag_assignments`. `agent_instruction` é o texto em PT-BR
// que vai DENTRO do system prompt explicando ao LLM quando aplicar a tag
// (ex.: "Aplique quando o cliente menciona depilação a laser"). NULL ou
// vazio = tag de uso humano apenas, agente ignora.
export const conversationTags = pgTable(
  'conversation_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 64 }).notNull(),
    // Cor exibida no chip. Hex 7 chars (#RRGGBB) — frontend valida.
    color: varchar('color', { length: 16 }).notNull(),
    agentInstruction: text('agent_instruction'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('conversation_tags_tenant_id_idx').on(t.tenantId),
    unique('conversation_tags_tenant_name_unique').on(t.tenantId, t.name),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();

// Junção N:M conversation × tag. `assigned_by_agent_turn_id` registra
// procedência: NULL = aplicada por humano via UI; FK preenchida = aplicada
// pelo agente naquele turno específico. ON DELETE SET NULL preserva a tag
// no histórico mesmo se o turno for purgado por retenção.
export const conversationTagAssignments = pgTable(
  'conversation_tag_assignments',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    tagId: uuid('tag_id')
      .notNull()
      .references(() => conversationTags.id, { onDelete: 'cascade' }),
    // Denormalizado pra RLS — policy usa app.current_tenant. Pattern já
    // usado em sale_items, user_units etc. Service preenche no insert.
    tenantId: uuid('tenant_id').notNull(),
    assignedByAgentTurnId: uuid('assigned_by_agent_turn_id').references(
      () => agentTurns.id,
      { onDelete: 'set null' }
    ),
    assignedAt: timestamp('assigned_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.tagId] }),
    index('conv_tag_asgn_tenant_id_idx').on(t.tenantId),
    index('conv_tag_asgn_tag_idx').on(t.tagId),
    pgPolicy('tenant_isolation', {
      as: 'permissive',
      for: 'all',
      using: tenantPolicy,
      withCheck: tenantPolicy,
    }),
  ]
).enableRLS();
