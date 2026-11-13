# Arquitetura

Documento vivo das decisões técnicas do Elora. Cada seção registra: **contexto → opções consideradas → escolha → justificativa**. Quando uma decisão for revertida, a entrada é atualizada com a nova escolha e nota do que mudou — não apagamos histórico.

---

## 1. Topologia: Modular Monolith (Service-Based Architecture)

**Contexto.** O sistema vai ter um core de gestão clínica (alta complexidade de domínio) e um chat com WhatsApp (alta complexidade técnica e integração externa). As duas partes precisam trabalhar juntas na UI mas evoluir independentemente no código.

**Opções consideradas.**
- **(a) Monolito tradicional** — chat dentro do mesmo backend do core. É o que o sistema anterior faz. Acoplamento aumenta com o tempo, deploys impactam tudo, scaling é uniforme.
- **(b) Modular monolith / service-based** — monorepo com `apps/core` e `apps/chat` como deploys separados, packages compartilhados, comunicação via mensageria + HTTP interno.
- **(c) Repos separados** — máximo isolamento, custo alto de coordenação (versionamento de tipos, deploy não-atômico, refatoração transversal vira projeto).
- **(d) Microsserviços completos** — banco-por-serviço, service mesh, schema registry, saga, distributed tracing. Resolve problemas que ainda não temos, paga overhead pesado desde o dia 1.

**Escolha.** (b) modular monolith.

**Justificativa.**
- Desacoplamento real de código (chat e core evoluem em ritmos diferentes) sem o overhead operacional de microsserviços.
- Deploys independentes (subir o chat não derruba o core).
- Refatorações cross-app permanecem baratas (1 PR no monorepo) — diferente de repos separados.
- Caminho de evolução claro: se um dos lados crescer e justificar virar microsserviço próprio, extrai do monorepo. O caminho contrário (juntar 2 repos) é mais doloroso.
- Termo formal no mercado: *modular monolith* / *service-based architecture*. Domínio bem-feito desse padrão é skill subestimada e altamente valorizada.

---

## 2. Tenancy: Pool Model + Postgres RLS

**Contexto.** O Elora é multi-tenant — cada clínica é um cliente que paga, cada uma com possivelmente várias unidades dentro. Isolamento de dados é requisito de LGPD, e um vazamento entre clínicas seria incidente grave.

**Opções consideradas.**
- **(a) Pool model** — single DB, `tenant_id` em toda tabela de domínio, isolamento por filtro.
- **(b) Bridge model** — schema-per-tenant, isolamento físico via search_path.
- **(c) Silo model** — DB-per-tenant.

**Escolha.** (a) pool model com Postgres RLS como rede de segurança.

**Justificativa.**
- É o **default do SaaS B2B moderno**: Slack, Notion, Linear, Stripe, Shopify, HubSpot, Supabase, Vercel — todos pool model. RLS amadureceu e tornou esse padrão seguro.
- Operação simples: 1 banco, 1 backup, 1 conjunto de migrations. Não precisa orquestrador especial pra propagar DDL entre schemas (problema do bridge).
- Postgres aguenta dezenas de milhões de linhas com índice composto `(tenant_id, ...)` sem suar.
- Caminho de evolução: tenant gigante pode ser migrado pra silo (Neon, Turso) sem reformular o resto. Padrão chamado *tiered SaaS* na AWS SaaS Lens.

**Modelo de dados.**

Hierarquia de 2 níveis:
- **`tenants`** (clínica que paga a assinatura)
- **`units`** (filiais dentro de um tenant — equivalente ao `empresa` do sistema anterior)

Toda tabela de domínio recebe `tenant_id` (e opcionalmente `unit_id`). Usuário continua sendo N:N com unit, com a regra dura: **um usuário só pode pertencer a units do mesmo tenant**.

**Como o RLS entra.**

1. Cada conexão do pool, no checkout, executa `SET app.current_tenant = '<uuid>'` baseado no JWT da request.
2. Cada tabela tem uma policy do tipo:
   ```sql
   CREATE POLICY tenant_isolation ON clientes
     USING (tenant_id = current_setting('app.current_tenant')::uuid);
   ```
3. Mesmo se o código esquecer um `WHERE tenant_id = ?`, o Postgres não retorna dados de outro tenant. Cinto + suspensório.

### Identificação do tenant na requisição

**Contexto.** Em multi-tenant, é preciso decidir como cada request descobre a qual tenant pertence. Os sistemas anteriores do usuário (dois sistemas legados) usam URL única com `tenant_id`/`companyId` injetado via JWT no login.

**Opções consideradas.**
- **(a) URL única + tenant via JWT** — simples, não exige nada de DNS, mas tem fragilidades operacionais.
- **(b) Subdomínio por tenant** (`clinicax.elora.app`) — tenant aparece na URL, na operação e no log.
- **(c) Path por tenant** (`elora.app/clinicax`) — meio termo, sem benefício real frente ao subdomínio.
- **(d) Custom domain por tenant** (`app.clinicax.com.br`) — white-label completo, mais complexo.

**Escolha.** (b) subdomínio por tenant via wildcard DNS + wildcard SSL, com `tenant_id` redundante no JWT como segunda camada de validação. Custom domain (d) fica como evolução para plano premium.

**Justificativa.**
- **Branding por tenant** — `clinicax.elora.app` reduz a sensação de "plataforma terceira" e abre caminho natural pra white-label depois.
- **Login multi-tenant funciona naturalmente** — usuária Maria que trabalha em duas clínicas pode ter o mesmo email em cada subdomínio sem mecanismo extra. Em URL única, isso forçaria email globalmente único ou tela "escolha a empresa" pós-login.
- **Reset de senha e magic link ficam triviais** — link já carrega o subdomínio do tenant, sem token extra na URL.
- **Defesa em profundidade** — subdomínio + JWT permitem exigir que ambos batam. Mismatch derruba a request. Sem subdomínio, tenant_id vive só no JWT — bug = vazamento.
- **Cookies isolados por host** — sessão da clínica X não compartilha cookie com a clínica Y, eliminando classe inteira de bug de "troca silenciosa de sessão entre abas".
- **Link público mais profissional** — agendamento online vira `clinicax.elora.app/agendar/abc` em vez de `app.elora.app/p/clinicax/agendar/abc`.
- **Observabilidade grátis** — subdomínio no access log permite filtrar tráfego/erro por tenant sem decodificar JWT em pipeline de logs.
- **Caminho pra white-label** — adicionar custom domain depois é só nova camada (`tenants.custom_domain`), não reescrita.

**Operação.**
- **DNS**: 1 entrada wildcard `*.elora.app` no Cloudflare apontando pro load balancer. Operação única — novos tenants entram automaticamente.
- **SSL**: certificado wildcard `*.elora.app` (Cloudflare ACM ou Let's Encrypt via DNS-01). Renovação automática.
- **Roteamento**: middleware do backend lê `req.headers.host`, extrai o slug, valida contra a tabela `tenants`, seta `app.current_tenant` na conexão. Esboço:

  ```ts
  const host = req.headers.host;          // "clinicax.elora.app"
  const slug = host.split('.')[0];        // "clinicax"
  const tenant = await db('tenants').where({ slug }).first();
  if (!tenant) return res.status(404).json({ error: 'Tenant não encontrado' });
  if (req.user && req.user.tenant_id !== tenant.id) {
    return res.status(403).json({ error: 'Tenant inconsistente' });
  }
  req.tenantId = tenant.id;
  await db.raw("SELECT set_config('app.current_tenant', ?, true)", [tenant.id]);
  ```

- **Tenant novo**: `INSERT INTO tenants (slug, ...) VALUES ('novaclinica', ...)` — responde em `novaclinica.elora.app` imediatamente. Zero intervenção em DNS.

**Custom domain (futuro).** Quando virar feature paga: cliente aponta CNAME pro Elora, sistema emite SSL via Cloudflare for SaaS / Approximated.app / Let's Encrypt automatizado, e `tenants.custom_domain` mapeia o host externo pro tenant interno.

---

## 3. Stack Tecnológica

**Backend (apps/core e apps/chat).**
- Node.js + TypeScript + Express
- Drizzle como query builder + ORM tipado
- Postgres como banco principal
- Socket.io para realtime do app
- Zod para validação (substitui o Yup do padrão do sistema anterior)

**Filas, cache e pub-sub.**
- Redis (1 instância serve as três funções)
- BullMQ para filas e jobs agendados — substitui o `node-cron` solto do sistema anterior (retry, dashboard, distribuído)

**Frontend (apps/frontend).**
- React 18 + TypeScript + Vite (SPA puro)
- shadcn/ui (Radix primitives + Tailwind v4) — ver decisão na seção 3.1
- Zustand (estado de UI) + TanStack Query (estado de servidor)
- React Hook Form + Zod (via `@hookform/resolvers/zod`)
- socket.io-client
- Axios

**Storage.**
- MinIO (para arquivos: anexos, fotos antes/depois, mídia WhatsApp recebida)

**Justificativas pontuais.**
- **MySQL → Postgres**: RLS, jsonb (perfeito pra payload de webhook e config de canal WhatsApp), full-text nativo, `pg_trgm` pra busca fuzzy, melhor para o stack SaaS.
- **`node-cron` → BullMQ**: retry com backoff, dead-letter, dashboard, processing distribuído, melhor pra tarefas que crescem em volume.
- **Vite + SPA puro**: app é autenticado, sem necessidade de SEO/SSR. Build rápido, DX excelente. Landing page comercial, quando precisar, será projeto separado (provavelmente Astro) — fora deste monorepo.

### 3.1 UI: shadcn/ui em vez de MUI

**Contexto.** Os sistemas anteriores do usuário (dois sistemas legados) usam MUI v6. Funciona bem, traz tema/inputs/drawer prontos, mas é pesado (~120-180 KB gzipped só do design system) e tem opinião visual forte ("cara Material") que custa pra customizar.

**Opções consideradas.**
- **(a) MUI v6** — familiar, completo, pesado, opinionado visualmente.
- **(b) shadcn/ui (Radix headless + Tailwind v4)** — leve (~30-50 KB), você possui o código dos componentes (copy-paste, não dep), acessibilidade via Radix, customização total.
- **(c) Mantine v7** — meio termo entre MUI e shadcn em peso/customização; pouco diferencial vs MUI pra justificar a troca.

**Escolha.** (b) shadcn/ui + Tailwind v4.

**Justificativa.**
- ~30% de redução no bundle total da SPA vs MUI.
- "Você possui o componente" — primitivos copiados pra `components/ui/`, sem ficar refém de versão da lib pra customizar.
- Tailwind v4 é o padrão atual do mercado (config CSS-first, sem `tailwind.config.js`).
- Radix primitives entregam acessibilidade (foco, ARIA, keyboard) sem precisar reinventar.
- Caminho aceito: mais código pra escrever na largada (composição de inputs, drawer, theme switcher) — investimento concentrado em componentes universais reutilizáveis (`components/form/`, `components/theme/`).

**Disciplina adotada pra evitar perda de controle.**
- `components/ui/` recebe primitivos shadcn (kebab-case, compatível com CLI `npx shadcn add`).
- `components/form/`, `components/theme/`, `components/layout/` contêm composições próprias em PascalCase. Toda tela usa essas composições — **nunca** primitivos crus de `ui/` direto.
- Tema (dark/light) via Context Provider + classe na `<html>`. Persistido em localStorage com fallback `prefers-color-scheme`.
- Responsividade via breakpoints do Tailwind + hook `useBreakpoint()` pra lógica JS-side.

---

## 4. Estrutura do Monorepo

```
elora/
├── apps/
│   ├── core/                # Backend principal — gestão clínica
│   ├── chat/                # Backend chat — WhatsApp + automações
│   └── frontend/            # SPA React consumindo core e chat
├── packages/
│   ├── db/                  # Drizzle (schema, migrations, withTenant)
│   ├── auth/                # JWT, hash de senha
│   ├── events-contracts/    # Canais Redis + payloads + nomes de sala socket.io
│   └── shared-utils/        # Sanitização, validação, formatadores
├── infra/
│   └── docker-compose.yml   # Postgres + Redis + MinIO local
└── docs/
```

### Ferramenta de monorepo

**Contexto.** Um monorepo de verdade exige ferramenta que faça os apps e packages se comportarem como sistema único — sem ela, "vários projetos no mesmo git repo" é só polyrepo morando junto. A ferramenta resolve: dependência entre packages locais, instalação centralizada, execução de comandos cross-project.

**Opções consideradas.**
- **(a) pnpm workspaces puro** — camada base, simples, rápida, sem orquestração de tasks.
- **(b) Turborepo sobre pnpm** — adiciona cache de tasks, grafo de dependências, execução paralela inteligente.
- **(c) Nx** — orquestração + plugins de codegen, mais opinativo, mais pesado.

**Escolha.** (a) pnpm workspaces puro. Adicionar Turborepo no momento que dor de build justifique.

**Justificativa.**
- Volume de hoje (3 apps + 4 packages) não justifica orquestrador. Build do zero ainda é rápido.
- pnpm workspaces sozinho já entrega 80% do benefício de monorepo: `node_modules` único, packages locais via `workspace:*`, comandos cross-package via `pnpm --filter`.
- Migração futura pra Turborepo é aditiva — cria um `turbo.json`, declara pipelines, sem refactor.
- pnpm é o default de fato em SaaS moderno (Vite, Vue, Vercel, Prisma, Astro usam) — alinhamento de mercado.
- Nx descartado: opinionatividade e codegen não trazem retorno proporcional ao custo de aprendizado pra esse projeto.

**Sinais para adicionar Turborepo depois.**
- Build de CI passa de 5 minutos.
- Mesmos testes rodam repetidamente sem mudança de código.
- Deploy fica lento por rebuilds redundantes.

**Comandos pnpm de referência.**

| Operação | Comando |
|---|---|
| Instalar tudo (raiz) | `pnpm install` |
| Adicionar dep a um app específico | `pnpm --filter core add express` |
| Adicionar dep dev na raiz (compartilhada) | `pnpm add -Dw typescript` |
| Rodar script de um app | `pnpm --filter core dev` |
| Rodar script em todos | `pnpm -r run build` |
| Rodar em paralelo | `pnpm -r --parallel run dev` |
| Pacote local como dep | `"@elora/auth": "workspace:*"` no `package.json` |

**Configuração mínima.** Arquivo `pnpm-workspace.yaml` na raiz declarando os locais:

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

---

## 5. Estrutura de Módulos Backend

**Decisão.** Organização por **domínio** (feature), não por **camada técnica**. Cada apps `core` e `chat` segue:

```
src/
├── modules/
│   ├── tenants/
│   │   ├── TenantsController.ts
│   │   ├── TenantsService.ts
│   │   ├── TenantsQuery.ts
│   │   ├── TenantsTypes.ts
│   │   └── tenantsRoutes.ts
│   ├── users/
│   │   ├── UsersController.ts
│   │   ├── UsersService.ts
│   │   ├── UsersQuery.ts
│   │   ├── UsersTypes.ts
│   │   └── usersRoutes.ts
│   ├── clients/
│   │   ├── ClientsController.ts
│   │   ├── ClientsService.ts
│   │   ├── ClientsQuery.ts
│   │   ├── ClientsTypes.ts
│   │   └── clientsRoutes.ts
│   ├── appointments/
│   ├── procedures/
│   ├── ...
├── shared/
│   ├── database/        # Conexão Drizzle (via @elora/db)
│   ├── errors/          # AppError
│   ├── middleware/      # ensureAuthenticated, validate, handleError, tenant context
│   ├── observability/   # Pino, Sentry, request context (AsyncLocalStorage)
│   └── utils/           # Sanitize, validation, hash, etc.
├── routes.ts
└── server.ts
```

### O que NÃO fazer

A alternativa comum em tutoriais de "Clean Architecture" agrupa por camada:

```
src/
├── controllers/         # ❌ todos os controllers juntos
├── services/            # ❌ todos os services juntos (ou usecases/)
├── repositories/        # ❌ todos os repos juntos
├── entities/            # ❌ todos os tipos juntos
└── routes/              # ❌ todas as rotas juntas
```

**Esse padrão não é usado no Elora.** Razões:

- Mexer numa feature exige saltar entre 5 pastas. Trabalhar num módulo coeso é mais difícil que deveria.
- Acoplamento entre módulos vira invisível — qualquer service pode importar qualquer outro repo, qualquer controller pode chamar qualquer service. Limites de domínio se erodem.
- Crescer fica pior, não melhor — uma `controllers/` com 80 arquivos é caos navegacional.
- A justificativa teórica ("separação de responsabilidades por camada") já é cumprida dentro de cada módulo: Controller → Service → Query são camadas, só que coladas no domínio que pertencem.

### O que cada arquivo faz

| Arquivo | Responsabilidade |
|---|---|
| `<Dominio>Controller.ts` | Recebe HTTP, valida entrada, chama Service, devolve resposta. Sem lógica de negócio. |
| `<Dominio>Service.ts` | Lógica de negócio. Orquestra Query, regras, validações de domínio. |
| `<Dominio>Query.ts` | Acesso a banco via Drizzle. Camada que fala SQL. Nenhum outro arquivo faz query direto. |
| `<Dominio>Types.ts` | Interfaces TypeScript do domínio. |
| `<dominio>Routes.ts` | Mapeia rotas Express e middlewares pro Controller. |

### Camada shared/

`shared/` é o lugar **único** para utilitários cross-module. Regra: se serve a 2+ módulos e não é específico de domínio, vai pra `shared/`. Se é específico de um domínio, mora dentro do módulo.

### Sem generic handlers

O sistema anterior usa um conjunto de handlers genéricos em `shared/generic/` (`getAllHandler`, `insertWithUserHandler`, etc.) pra cortar boilerplate de Controllers. **No Elora optou-se por não usar esse padrão.** Cada Controller é escrito explicitamente — mais código por módulo, mas com fluxo legível e sem mágica de `req.params`/`req.query`/`req.body` sendo mesclados em um único objeto.

Trade-off conhecido: em troca da legibilidade ganhamos repetição de plumbing (`try { ... } catch (err) { next(err); }` em cada handler). Aceito.

---

## 6. Comunicação Core ↔ Chat

**Síncrona** (quando precisa de resposta imediata): HTTP interno entre os apps, com header de autenticação interna (token de service-to-service, não JWT de usuário).

**Assíncrona** (regra geral): eventos via BullMQ.

- Core publica eventos do tipo `agendamento.criado`, `cliente.cadastrado`, `procedimento.finalizado`.
- Chat consome essas filas e dispara mensagens WhatsApp conforme automações configuradas.
- Inverso: chat publica eventos do tipo `whatsapp.mensagem_recebida`, `whatsapp.confirmacao_recebida`. Core consome quando relevante (ex: cliente confirmou agendamento via WhatsApp → atualizar status no core).

**Contratos de evento** ficam em `packages/events-contracts` — versionados, tipados, importados pelos dois lados. Mudança de evento = mudança no package = ambos os apps atualizam no mesmo PR.

---

## 7. Camada WhatsApp (Evolution API como gateway unificado)

> **Modelo de domínio (jornadas, conversas, mensagens, tratamentos, automações)** vive em doc próprio: [chat-domain.md](./chat-domain.md). Aqui ficam apenas as decisões da camada de transporte (adapter pra provider WhatsApp).

**Contexto.** Cada tenant Elora escolhe entre dois caminhos de canal WhatsApp conforme seu apetite de custo/risco:

- **Não-oficial (Baileys-based, via WhatsApp Web)** — sem custo por mensagem, conexão via QR code. Risco real de banimento Meta.
- **Oficial (Cloud API)** — sustentável, oficial, custo por conversa via Meta. Onboarding por Business Verification.

**Decisão.** Usar **Evolution API v2** como gateway único pra ambos os tracks. Evolution suporta os dois modos no mesmo binário/endpoint (campo `integration` na criação da instância: `WHATSAPP-BAILEYS` ou `WHATSAPP-BUSINESS`), o que colapsa "dois adapters" em **um adapter, dois modos**.

**Por que Evolution.**
- Maturidade: comunidade ativa, atualizações frequentes, fork ativo em [EvolutionAPI/evolution-api](https://github.com/EvolutionAPI/evolution-api).
- Unificação real dos tracks: mesma API, mesmo deploy, mesmo formato de webhook. Trocar de Baileys pra Cloud = mudar `integration` da instância, sem novo adapter.
- Auto-hospedado: tenant fica dono dos dados (mensagens, contatos) — sem dependência de SaaS terceiro.
- Webhook configurável por instância com headers customizados — permite Bearer token simples sem precisar de HMAC.
- Integrações nativas (Postgres, Redis, S3/MinIO, Socket.IO) reaproveitam nossa infra existente.

**Histórico.** Versões anteriores deste doc previam dual-stack QuePasa + BSP específico (Z-API/360dialog/Twilio). Trocamos pra Evolution em 2026-05 por motivo de instabilidade do QuePasa e pela simplificação arquitetural acima. BSP intermediário não é mais decisão obrigatória — vira opcional se algum tenant preferir onboarding facilitado em vez de gerenciar Cloud API direto.

### 7.1 Adapter Pattern

Interface única `IWhatsAppProvider` (apps/chat/src/shared/providers/whatsapp/):

```ts
interface IWhatsAppProvider {
  sendText(to: string, text: string): Promise<MessageRef>;
  sendMedia(to: string, media: Media): Promise<MessageRef>;
  sendTemplate(to: string, templateId: string, vars: Record<string, string>): Promise<MessageRef>;
  getStatus(externalId: string): Promise<MessageStatus>;
  normalizeWebhook(rawPayload: unknown): NormalizedInboundEvent;
}
```

Implementações:
- **`EvolutionAdapter`** — único adapter de produção. Lê `provider_config.{ baseUrl, instanceName, apiKey, integration }` do canal. Comportamento condicional em `integration`: nos pontos onde Baileys e Cloud divergem (ex: template approval), o adapter ramifica internamente.
- **`MockAdapter`** — caminho de dev/CI. Loga envios em RAM, expõe `normalizeWebhook` com payload simples pra testes. Continua útil mesmo com Evolution rodando — CI offline e devs sem Evolution local.

Factory `createWhatsappProvider(channel)` resolve a impl certa via `provider_config.mock === true` (sempre Mock) ou caso contrário usa `EvolutionAdapter`. Resto do código nunca importa adapter direto.

### 7.2 Modelo de Domínio Próprio

Tabelas:
- `whatsapp_channels` — entidade central. Cada canal tem `provider_type` (`baileys` | `meta_cloud`), `provider_config` (jsonb), `phone_number`. `provider_config` típico pra Evolution: `{ baseUrl, instanceName, apiKey, integration, webhookToken }`. Trocar de track = criar nova instância Evolution e novo canal, migrar conversas históricas, deprecar canal antigo.
  - **`connection_state`** (`open` | `connecting` | `closed` | `unknown`, nullable) + `connection_state_at` — alimentados em tempo real por `CONNECTION_UPDATE` do Evolution. UI consome via push (socket) — sem polling. Idempotente: pipeline só grava quando state realmente muda (`IS DISTINCT FROM`), e só publica evento nesse caso. Detalhes do fluxo em §7.4.
  - **`color`** (varchar 7, hex `#RRGGBB`, nullable) — destaque visual do canal. Frontend usa em `MinimizedCard` (border-left) e `FloatingChatWindow` (border-top do header) pra diferenciar conversas de canais distintos quando a mesma pessoa fala em mais de um. Null = sem destaque (visual default).
- `whatsapp_contacts` — contatos no WhatsApp (não confundir com `clientes` do core; vinculação é N:1 quando aplicável).
- `whatsapp_conversations` — conversas, com `last_inbound_at` para tracking da janela de 24h.
- `whatsapp_messages` — mensagens, com `external_id` (id do provider) separado do `id` interno.
- `whatsapp_templates` — vínculo por canal entre `message_templates` (domain) e o provider. Em canal `baileys`, `meta_status='approved'` é setado **imediatamente** (não há aprovação Meta). Em canal `meta_cloud`, segue ciclo real (`PENDING → APPROVED/REJECTED`) com `meta_template_id` preenchido.

**Por que renomeamos `quepasa` → `baileys`**: o nome `quepasa` era específico do produto antigo; `baileys` descreve a tecnologia subjacente (lib que WhatsApp Web roda), genérica o suficiente pra englobar Evolution, alternativas futuras, ou troca de provider sem mudar enum.

### 7.3 Disciplinas Operacionais Unificadas

**Regra dura: as disciplinas Cloud-like valem em AMBOS os tipos de canal.** Não é "implementa pra Cloud quando vier" — é "aplica nos dois desde o dia 1". No track Baileys, isso reduz substancialmente o risco de banimento porque o perfil de tráfego fica próximo de canal Cloud legítimo (defesa em profundidade).

- **Janela de 24h trackada**: `last_inbound_at` em `whatsapp_conversations`. Mensagem ativa fora da janela só via template aprovado — Service bloqueia.
- **Opt-in trackado**: `opted_in_at` e `opt_in_source` em `whatsapp_contacts`. Sem opt-in, sistema não permite mensagem ativa.
- **Templates como conceito interno**: mensagem ativa fora da janela exige template aprovado. A única diferença real é o que "aprovado" significa:
  - **Baileys**: registrado e ativo no Elora (auto-approved no insert do `whatsapp_templates`).
  - **Meta Cloud**: passou pelo fluxo de submissão Meta (`PENDING → APPROVED`).

### 7.4 Webhook Normalizer

Endpoint `/webhook/whatsapp/:channel_id`. Adapter do channel converte payload bruto Evolution em evento interno padronizado (`NormalizedInboundEvent`: `message_received | status_updated | ignored`). Esse evento entra no pipeline interno (BullMQ) e circula pelo sistema.

**Auth do webhook**: Evolution não emite HMAC nativo. Usamos **Bearer token** configurado no `webhook.headers` ao criar a instância — Elora gera token aleatório, salva em `provider_config.webhookToken`, configura na instância via `POST /webhook/set/{instance}`. O handler do webhook valida o header `Authorization: Bearer <token>` antes de processar.

**Eventos relevantes** (subset do que Evolution emite — registrados em `events[]` no `POST /instance/create`):
- `MESSAGES_UPSERT` / `SEND_MESSAGE` → mensagem nova. Ramificação interna:
  - `data.key.fromMe === false` → inbound. Pipeline cria `whatsapp_message direction='inbound'` + `message direction='inbound'`. Mídia (incluindo sticker via `stickerMessage`) cai aqui — ver §7.9 sobre o decode pipeline.
  - `data.key.fromMe === true` → outbound. Pipeline faz **dedup por `external_id`**:
    - Já existe → eco do nosso próprio envio API, drop limpo.
    - Não existe → staff respondeu **direto pelo celular pareado** sem usar a UI. Persiste `whatsapp_message direction='outbound'` + `message direction='outbound', authored_on_device=true`. Frontend renderiza com marcador visual (ícone smartphone). Conta como atividade de staff pra `journeys.last_activity_at` (ver [chat-domain.md §10.1](chat-domain.md)).
- `MESSAGES_UPDATE` → overloaded. Adapter demultiplexa pelo conteúdo do payload:
  - Tem `data.message.editedMessage` (ou `protocolMessage.editedMessage`) → **edição** feita pelo cliente. Pipeline atualiza `messages.body` e seta `edited_at`. Sem publish no bus (decisão de projeto — automações não re-disparam em edit). Eco do nosso próprio `editMessage` é filtrado por `fromMe=true`.
  - Tem `data.status` (`PENDING`/`SERVER_ACK`/`READ`/etc) → atualização de **status** (delivered/read). Pipeline reflete em `messages.delivered_at`/`read_at` + publica `wa.status.updated`.
- `MESSAGES_DELETE` → cliente apagou mensagem ("apagar pra todos"). Pipeline faz **soft delete** (`messages.deleted_at` + `deletion_origin='client'`) e publica `wa.message.revoked`. Eco do nosso `revokeMessage` é filtrado.
- `CALL` (também `call.upsert`/`calls.update`) → tentativa de chamada de voz/vídeo. Pipeline cria `message kind='call'` com `call_payload` (`{direction, status: missed|received|declined, durationSec?, startedAt}`). Reusa evento `wa.message.received` pro core repassar via socket; UI distingue pelo `message.kind`.
- `CONNECTION_UPDATE` → estado da sessão (`open`/`connecting`/`close`). Pipeline normaliza pra `'open' | 'connecting' | 'closed' | 'unknown'`, grava em `whatsapp_channels.connection_state` (só se mudou) e publica evento `wa.channel.connection_changed` no Redis. Core repassa via socket pra sala `tenant:{id}` — UI exibe badge reativo sem polling.

**Política de defesa do handler** (`/webhook/whatsapp/:channelId`):
- **Short-circuit pra eventos `ignored`** — adapter chama `normalizeWebhook` no controller antes de enfileirar. Eventos sem valor pro pipeline (presence, chats, contacts) respondem 200 imediato sem entrar no BullMQ. Evita inundar Redis com jobs no-op (Baileys pode disparar dezenas por segundo).
- **Canal desconhecido → 410 Gone** (não 404). Semântica HTTP correta pra "recurso desapareceu permanentemente" — provider reduz retries. Combinado com:
  - **Log dedup**: o controller loga 1× via `logger.warn` por `channelId` desconhecido (Set in-memory, zera no restart). Evita centenas de WARN quando uma instância Evolution órfã insiste.
  - **pinoHttp silent**: `customLogLevel` no `server.ts` trata `/webhook/* + 410` como `silent` — sem entrada no STDOUT por request. Logs preservam só o WARN explicativo + o caso real.
- **Canal inativo** (`active = false`) também retorna 410 — mesma semântica, mesma defesa.

### 7.5 Migração entre tracks (Baileys ↔ Cloud)

Como Evolution gerencia ambos, migrar = criar nova instância com `integration` diferente, pareá-la (QR pro Baileys, registrar credenciais Meta pro Cloud), criar novo `whatsapp_channel` apontando pra ela, mover conversas via update de `whatsapp_channel_id`, deprecar canal antigo. Cuidados:
- O telefone unique no canal novo pode mudar dependendo do caminho — Cloud geralmente exige número novo aprovado pela Meta.
- Histórico de templates não migra automático — re-cadastrar com `meta_template_id` quando Cloud.
- Mesma operação Evolution dos dois lados simplifica deploy e monitoring.

### 7.6 Camada domain-level

Separada do transporte. Tabelas `conversations` + `messages` (domain) ficam acima de `whatsapp_*` (transport) — uma mensagem WhatsApp gera um registro em cada nível, ligados por FK. Internal notes entre staff e mensagens de outros canais futuros (Instagram, email) vivem só no domain-level. Detalhamento completo: [chat-domain.md](./chat-domain.md).

### 7.7 Trade-offs comerciais entre tracks

| Aspecto | Baileys (Evolution + WhatsApp Web) | Meta Cloud (Evolution + Cloud API) |
|---|---|---|
| Onboarding do tenant | Pareia QR (horas) | Business Verification Meta (dias) |
| Custo por mensagem | Zero | Meta (por conversa) |
| Risco de banimento | Real (mitigado pela disciplina §7.3) | Zero |
| Suporte oficial | Nenhum | Meta |
| Templates | Auto-approved no Elora | Aprovação Meta (24-48h por template) |
| Mídia | Evolution baixa e expõe URL (adapter salva em MinIO) | Cloud retorna URL assinada (24h validade) |

O Elora apresenta os dois caminhos no onboarding do tenant; clínica escolhe conforme perfil.

### 7.8 Deploy Evolution

Evolution roda como serviço próprio no `infra/docker-compose.yml`. Configurações:
- Imagem: `evoapicloud/evolution-api:latest` (recomendada pela docs oficial).
- Porta interna 8080, exposta em porta livre (ex: 5503).
- Banco: reusa Postgres (`elora_dev`) com schema dedicado, OU sqlite/redis interno. Decisão de operação — começamos com schema dedicado pra alinhar com nosso stack.
- Auth global via `AUTHENTICATION_API_KEY` no env. Esse é o "master key" pra criar instâncias.
- Persistência de sessões via volume Docker.

Operacionalmente, Evolution **não é multi-tenant nativo no nível do produto** — cada tenant Elora tem sua instância nomeada (`tenant-<slug>-<canal>`). O Elora orquestra criação/destruição via API admin.

**Preservação de canais reais no `pnpm db:seed`** (dev). O seed faz `TRUNCATE tenants CASCADE`, o que apagaria `whatsapp_channels` e quebraria a vinculação com instâncias Evolution já pareadas (que persistem no servidor Evolution independentemente). Solução: o seed faz **snapshot** dos canais não-mock antes do truncate, filtrando `provider_config.mock IS NOT TRUE`, e **restaura preservando o `id` original** depois de recriar os tenants. Vinculação por `tenant.slug` (estável). Resultado: rodar seed não obriga a reparear WhatsApp. Implementado em `packages/db/seed.ts` — comentários inline explicam.

**Acesso ao Evolution.** UI Manager embutida em `http://localhost:5503/manager` (login = master key). API REST direta com header `apikey`. Endpoints úteis pra debug: `GET /instance/fetchInstances`, `GET /instance/connectionState/{name}`, `DELETE /instance/delete/{name}`. Logs do container via `docker logs -f elora_evolution`. DB do Evolution vive em `evolution` schema no mesmo Postgres (`docker exec ... psql ... -d evolution`).

### 7.9 Storage de mídia + decode pipeline (MinIO)

WhatsApp/Baileys entrega mídia inbound de duas formas:
1. **URL `mmg.whatsapp.net/.../<hash>.enc`** no payload do webhook (`audioMessage.url` etc) — bytes **cifrados** com a `mediaKey` que também vem no payload. Player de browser não consegue tocar isso.
2. **Conteúdo decodificado on-demand** via endpoint `POST /chat/getBase64FromMediaMessage/{instance}` da Evolution — passamos `{ message: { key: { id } } }`, Evolution descriptografa usando o que tem no DB próprio (`DATABASE_SAVE_DATA_NEW_MESSAGE=true` no compose) e devolve `{ base64, mimetype, fileName }`.

**Caminho 2 é obrigatório.** Adapter expõe `fetchInboundMediaBuffer(rawPayload)` no contrato (`IWhatsAppProvider`); pipeline chama ANTES de gravar `whatsapp_message`, decode → buffer → `MediaStorage.persistInboundMediaBuffer` → MinIO. URL cifrada do payload nunca é baixada em produção (mock e fallback ainda usam fetch direto pra placeholder público).

**Bucket único `whatsapp-media`** com layout `{tenantId}/{channelId}/{yyyy}/{mm}/{dd}/{externalId}-{filename}`. Particionamento por data viabiliza lifecycle rules futuras (deleção após N dias). Foto de perfil de contato fica em path estável `{tenantId}/{channelId}/profile-pictures/{contactId}.{ext}` (sobrescreve a anterior — não mantemos histórico).

**`messages.media_url` guarda o objectKey** (não URL de download). Frontend pede presigned URL on-demand via `GET /messages/:id/media-url` — TTL configurável (default 7 dias). Mesma estratégia pra foto de perfil: `GET /whatsapp/contacts/:id/profile-picture-url`.

**Dois clientes MinIO** no backend (importante em dev):
- `minioClient` — server-side ops (upload/download/stat). Usa `MINIO_ENDPOINT` (default `localhost`).
- `publicMinioClient` — APENAS pra gerar presigned URLs. Usa `MINIO_PUBLIC_ENDPOINT` (default `host.docker.internal`).

Motivo: Evolution roda em container Docker e precisa baixar a presigned URL pra fazer `sendMedia`. `localhost:9000` dentro do container aponta pra ele mesmo, não pro MinIO. `host.docker.internal` resolve pro host em Docker Desktop (Mac/Win) e, em Linux, requer `extra_hosts: host.docker.internal:host-gateway` no serviço Evolution do compose (já configurado). O browser do staff dev (no mesmo host) também resolve `host.docker.internal` via /etc/hosts injetado pelo Docker Desktop — uma URL serve aos dois consumidores. Em prod, ambos endpoints podem coincidir num hostname S3/MinIO público.

**Outbound de mídia** (UI → WhatsApp): frontend faz `POST /conversations/:id/upload-media` (multipart, 20MB cap), backend retorna `{ objectKey, presignedUrl }`. UI mostra preview; ao confirmar, faz `POST /messages` com `kind:'media' mediaObjectKey:'...'`. `MessagesService.sendOutbound` gera presigned URL on-the-fly e passa ao adapter — Evolution baixa do MinIO público e encaminha.

### 7.10 Lifecycle de mensagem: edit + revoke

Cobertura simétrica nos dois sentidos da conversa.

**Soft delete sempre.** Coluna `messages.deleted_at` + `deletion_origin` enum (`client` | `staff` | `system`). Body/mediaUrl ficam intactos no DB pra auditoria; UI esconde com base em `deleted_at != null` e usa `deletion_origin` pra decidir o texto exibido ("Você apagou esta mensagem" vs "Esta mensagem foi apagada" vs "Mensagem apagada pelo atendente").

**Edit incoming** (cliente edita pelo app dele): webhook `MESSAGES_UPDATE` com `editedMessage` → `MessagesService.applyClientEdit` faz UPDATE in-place em `body` + seta `edited_at`. Não mantemos histórico de versões (mesmo comportamento do WhatsApp). Não publica no bus — decisão de projeto pra automações não re-dispararem em edit.

**Edit outgoing** (staff edita msg que enviamos): `PATCH /messages/:id` (V1 só `kind='text'`). Service chama `EvolutionAdapter.editMessage` → `POST /chat/updateMessage/{instance}` com `{ key, text }`. WhatsApp impõe limite de ~15min após o envio — fora dessa janela o provider responde 400 e o backend propaga pra UI.

**Revoke incoming** (cliente apaga): webhook `MESSAGES_DELETE` → soft delete + publish `wa.message.revoked` com `origin='client'`.

**Revoke outgoing** (staff "apaga pra cliente"): `DELETE /messages/:id`. Service chama `EvolutionAdapter.revokeMessage` → `DELETE /chat/deleteMessageForEveryone/{instance}` → soft delete local + publish com `origin='staff'`. Idempotente — chamar 2× devolve o estado atual.

**Eco filtrado.** Tanto edit quanto revoke disparados pela UI geram webhook de retorno (Evolution emite eventos pra TODAS as mudanças do WhatsApp Web). Adapter filtra `data.key.fromMe=true` em ambos parsers pra evitar duplicar a operação local.

### 7.11 Envio outbound: persist-early + worker assíncrono (revisão 2026-05-26)

**Contexto.** Versão anterior (`MessagesService.sendOutbound`) fazia tudo síncrono no controller HTTP: pre-flight (opt-in, janela 24h, canal aberto, OutboundGuard) → adapter Evolution → INSERT em transação → publish socket. O frontend disfarçava a latência (~500ms-2s incluindo chamada Evolution) com **optimistic update + tempId**: injeta bolha temp no cache antes do request, substitui pela real no `onSuccess`. Funcionava, mas tinha 3 problemas:
- **Race entre HTTP response e socket echo** — ambos mexem no mesmo cache key, ordem não-determinística podia perder a bolha temp (suspeita de duplicação registrada em 2026-05-21).
- **Sem audit de tentativas bloqueadas** — pre-flight retornando 403 (no opt-in, fora da janela) virava toast e nada era persistido. Staff perdia o registro.
- **Caminho desigual texto/mídia** — texto era optimistic (libera input), mídia era síncrono com barra de progresso. Lógica frontend bifurcada.

**Opções consideradas.**
- **(a) Manter tempId, blindar a race** — instrumentar logs, deduplicar por id. Conserta sintoma, mantém a complexidade.
- **(b) Persiste cedo (pre-flight no controller, mas sem optimistic)** — HTTP só responde quando adapter terminou. Sem temp, mas latência percebida volta.
- **(c) Persist-early + worker assíncrono** — controller faz INSERT `delivery_status='pending'` e enfileira; worker faz pre-flight + adapter + UPDATE pra `sent/failed/rejected`. UI vê a bolha real imediatamente (com spinner), atualizada via socket. ◀️

**Escolha.** (c). Race some por construção (id é real desde o INSERT); audit completo (pre-flight rejeitado também vira linha em `messages` com status `rejected`); texto e mídia ficam idênticos do ponto de vista do front (mídia só adiciona a barra de upload antes do POST).

**Como funciona** (`MessagesService.enqueueOutbound`):

1. **Controller burro** — resolve conversation + journey ativa, INSERT em `messages` com `delivery_status='pending'` e `sent_at=null`, publica `message.created` (outras abas/devices vêem a bolha imediatamente), enfileira job BullMQ, retorna a row. Sub-100ms (sem chamada Evolution).
2. **`OutboundDeliveryWorker`** (`apps/chat/src/shared/workers/outboundDelivery/`):
   - **Lock por `conversationId`** — `SET outbound:lock:conv:{id} NX EX 60` no Redis (release seguro via Lua script comparando value). Preserva ordem dentro da conv. Quem não pega o lock chama `job.moveToDelayed(+200ms)` + `throw new DelayedError()` — devolve o slot do worker pra outras convs avançarem em paralelo.
   - **Pre-flight** — mesma lógica de antes (opt-in, canal ativo+`open` com self-heal de `connection_state`, janela 24h pra Cloud OU `OutboundGuard.check` pra Baileys). Cada falha → `markDeliveryFailed('rejected', reason, detail)` + publish `wa.message.status_changed` + return.
   - **Adapter** — chama `provider.sendText/sendMedia/sendTemplate`. Falha de rede ou `messageRef.status='failed'` → `markDeliveryFailed('failed', 'provider_error', detail)` + publish + return.
   - **Sucesso** — uma única transação: INSERT `whatsapp_messages` (transport), `markDeliverySent` em `messages` (`status='sent'`, `sent_at`, `whatsapp_message_id`), touch `whatsapp_conversations.last_outbound_at` + `conversations.last_message_at`. Fora da tx: `markUiOutbound` + cascata journey (`touchActivity` + `recomputeLeadSubstage`) + publish `wa.message.sent` (compat com listeners existentes) + publish `wa.message.status_changed`.
3. **Reconciler** (`apps/chat/src/shared/workers/outboundDelivery/reconciler.ts`) — `setInterval` 5min varre `messages` outbound `delivery_status='pending'` com `created_at < NOW() - 5min` e `authored_on_device=false` (defesa pra não tocar capturas de celular pareado). Marca como `failed/worker_timeout`. Index parcial `messages_pending_stuck_idx` cobre o filtro `WHERE delivery_status='pending'` sem custo proibitivo em tenants grandes. Itera por tenants (RLS impede SELECT global).

**Estados de `delivery_status`:**
- `pending` — INSERT feito, worker ainda não confirmou. UI mostra spinner.
- `sent` — adapter confirmou. Cascata padrão de `delivered_at`/`read_at` via webhook de status.
- `failed` — adapter chamou e falhou (rede, provider_error, worker_timeout). Bolha **vermelho soft** + linha de motivo. Retry direto pode resolver.
- `rejected` — pre-flight bloqueou antes do adapter (no_opt_in, channel_disconnected, window_24h_expired, invalid_template, rate_limited). Bolha **amarelo soft** + linha de motivo. Retry sem corrigir o setup vai rejeitar de novo.

**Origem de cada status** — `enqueueOutbound` é o único caminho que produz `pending`. Os outros caminhos persistem `sent` direto (não passam pelo worker):
- `createInbound` (webhook do cliente) → `sent`
- `createOutboundExternal` (celular pareado) → `sent`
- `createCallMessage` (kind='call') → `sent`
- `postInternalNote` (anotação entre staff) → `sent`

**Ordering visual** — `findPaginated` ordena por `COALESCE(sent_at, created_at) desc`. Sem `COALESCE`, `desc(sent_at)` agrupa todas as nulls juntas (NULLS FIRST default do Postgres em DESC) em ordem indeterminada — bolhas pending/failed apareceriam fora de sequência na timeline.

**Cenário de race entre confirmações** (postura escolhida: **honestidade total**). Quando staff manda 2 msgs em sequência (A em t=0, B em t=1), o lock por conv garante ordem de processamento. Mas se A demora mais que B no provider (Evolution lento por motivo X), staff pode ver brevemente "A pending, B sent ✓" — visualmente esquisito, mas honesto e idêntico ao WhatsApp Web. Postura validada: o caso ruim de verdade é A falhar mas B ser sucesso (cliente recebeu B mas não A); antes esse cenário era invisível (toast some), agora fica explícito (A laranja, B verde) — força o staff a perceber e reenviar A.

**Buracos conhecidos.**
- Worker crash entre INSERT e UPDATE deixa row pending. Reconciler fecha em 5min (vira `failed/worker_timeout`).
- Worker timeout depois do adapter ter enviado mas antes do UPDATE: mensagem foi pra cliente mas fica como `failed` no nosso lado. Cinto extra: dedup por `whatsapp_messages.external_id` impede duplicação se staff re-enviar (mas isso é V2 — V1 staff vai reenviar e cliente recebe 2x).
- Status `delivered`/`read` continuam em colunas próprias (`delivered_at`/`read_at`) e dependem do webhook `wa.status.updated` — não conectados ao `delivery_status` (que para em `sent`).

---

## 8. Estratégia de Testes

**Contexto.** O sistema anterior não tem testes. No Elora, sendo SaaS multi-tenant, testar isolamento de dado entre tenants vira blindagem operacional e de LGPD — não é luxo. Mas testar tudo desde o dia 1 mata velocidade. Equilíbrio entre cobertura e custo.

**Opções consideradas.**
- **(a) Sem testes** — caminho do sistema anterior. Velocidade alta no início, débito alto depois.
- **(b) Cobertura total exigida** — coverage mínimo no CI, todo PR exige teste. Lento, gera testes inúteis pra "bater meta".
- **(c) Pirâmide pragmática** — muitos unit em código que merece, integration nas fronteiras críticas (multi-tenant, auth, fluxos transacionais), poucos E2E em golden paths.

**Escolha.** (c) pirâmide pragmática.

### 8.1 Camadas e ferramentas

**Unit — Vitest.**
- Runner único pro projeto (mesma ferramenta cobre unit e integration).
- Foco: funções utilitárias, regras de negócio puras (cálculo de saldo de sessões, desconto progressivo, sanitização, validação).
- Não forçar unit em controllers/services que apenas delegam — esses são cobertos por integration.

**Integration — Vitest + Postgres real + Redis real.**
- Reaproveita os containers de Postgres e Redis do `docker-compose.yml` de dev (ver seção 10), criando um banco/database separado para testes (`elora_test`).
- Cada teste roda em transação que dá rollback no fim — reset entre testes em milissegundos, sem subir/derrubar container por suite.
- Foco obrigatório:
  - **Isolamento de tenant** — toda rota crítica tem teste "tenant A vê dado do B?" → 404. **Esse é o teste mais importante de tudo.**
  - **Auth e autorização** — login, refresh, expiração de token, permissão por role.
  - **Rotas transacionais** — agendamento que cria evento + reserva equipamento + bloqueia horário.
  - **Webhook de WhatsApp** — payload bruto entra, evento interno correto sai.

**E2E — Playwright.**
- Limite de **5–7 fluxos críticos** no MVP. Não cobrir todas as telas com E2E.
- Fluxos: login, criar agendamento, fechar venda, receber+responder WhatsApp, cliente confirmar agendamento via WhatsApp.
- Auto-wait do Playwright + trace viewer + captura de vídeo em falha cortam flakiness.

### 8.2 Política de PR

- CI bloqueia merge se qualquer teste falhar.
- **Não exigir cobertura mínima como número** — métrica enganosa.
- Regra dura: toda rota nova que toca tabela com `tenant_id` exige teste de isolamento. Sem ele, não merge.

### 8.3 Justificativa

- Vitest unifica unit e integration — uma ferramenta a aprender, não duas. Integração nativa com Vite (que já usamos) elimina configuração.
- Playwright virou default moderno pra E2E (substituiu Selenium e Cypress em projetos novos): suporte multi-browser, auto-wait, trace viewer.
- Foco em multi-tenant + integration test = onde o teste paga maior retorno num SaaS. Unit puro pega bug bobo de cálculo; integration pega o tipo de bug que vira incidente de LGPD.
- Skill de escrever bom teste de integration multi-tenant é raro no mercado e altamente valorizado.

---

## 9. Observabilidade

**Contexto.** Em SaaS multi-tenant com 2 apps + filas + integração externa (WhatsApp), descobrir e diagnosticar problema sem ferramenta de observabilidade vira impossível em produção. Mas montar a stack completa no dia 1 vira projeto paralelo que rouba tempo do produto. A pergunta certa é: *o que tem custo baixo agora e custo alto pra retrofitar depois?* Esses entram desde o começo. O resto, faseado.

**Os três pilares de observabilidade.**
- **Logs** — eventos individuais com contexto (o que aconteceu).
- **Métricas** — números agregados ao longo do tempo (quanto / com que frequência).
- **Traces** — linha do tempo de uma request percorrendo múltiplos serviços (onde gastou tempo).

### 9.1 O que entra no dia 1 (custo baixo agora, retrofit caro depois)

**Pino + AsyncLocalStorage para logs estruturados com contexto de tenant.**
- Logger Pino em todos os apps. Saída JSON estruturado.
- Middleware de entrada usa `AsyncLocalStorage` pra registrar `tenant_id`, `request_id` e `user_id` na request. Helper de log puxa esse contexto automaticamente.
- Resultado: todo log carrega quem fez, qual tenant, qual request — sem esforço manual em cada ponto.
- Justificativa: refatorar `console.log` espalhado depois é tedioso e fácil deixar call sites sem contexto. Estabelecer o hábito desde o começo é o que torna logs úteis em produção.

**Sentry para error tracking.**
- SDK do Sentry instalado em core, chat e frontend.
- Captura automática de exceptions não tratadas, com stack trace, contexto de request, user e tenant.
- Justificativa: 30 minutos de instalação. Custo zero de operação. Captura de erro a partir do primeiro deploy. Sem motivo pra adiar.

**Saída de logs no stdout (sem agregador ainda).**
- Logs vão pro Docker logs / arquivo do PM2.
- Agregador entra na fase 2 — Pino transports torna a troca trivial.

### 9.2 Adicionar quando produção real começar (retrofit tranquilo)

**Agregador de logs.**
- BetterStack, Grafana Loki Cloud ou similar (free tiers servem no início).
- Configuração: trocar transport do Pino. Sem refactor de código.

**Métricas básicas via Grafana Cloud (ou similar).**
- Middleware único expondo RPS, latência p50/p95/p99, erro 5xx, fila do BullMQ.
- 1 dashboard "saúde geral" + 1 dashboard "negócio" (agendamentos/dia, mensagens WhatsApp/dia por tenant).
- Custom metrics adicionadas pontualmente quando precisar.

### 9.3 Adicionar quando dor concreta aparecer

**OpenTelemetry para tracing distribuído.**
- Instrumentação dos 2 backends + frontend.
- Backend de visualização: Grafana Tempo (Cloud) ou Honeycomb.
- Sampling inicial em 10% (`tracesSampleRate: 0.1`) — volume de trace fica caro rápido.
- Justificativa pra adiar: custo cognitivo alto pra aprender no início; o caso mais chato de retrofit (propagação de contexto através de jobs BullMQ) é trabalhoso mas não catastrófico. Vale esperar a primeira dor real de performance que não conseguir debugar com logs.

### 9.4 O que NÃO fazer no início

- Stack self-hosted completa (Prometheus + Grafana + Loki + Tempo) operada por você. Cinco serviços a cuidar = projeto paralelo do tamanho do principal.
- Coverage de tracing 100%. Sempre amostrar.
- Sentry self-hosted (GlitchTip) só pra economizar mensalidade. Tempo gasto operando não compensa.

### 9.5 Justificativa global

- Em multi-tenant, log sem `tenant_id` é log inútil em produção. Estabelecer o pattern via `AsyncLocalStorage` desde o começo evita refactor doloroso depois.
- Sentry é caso raro de "alto retorno, custo trivial, zero refactor depois" — sem motivo pra adiar.
- Métricas e agregador de logs têm retrofit barato — é razoável adiar pro momento que produção real comece.
- OpenTelemetry é a ferramenta com curva de aprendizado mais íngreme dos quatro. Aprender quando tiver problema concreto pra resolver é mais eficiente que estudar abstrato no início.

---

## 10. Ambiente de Desenvolvimento

**Contexto.** Decidir como serviços de infra (Postgres, Redis, MinIO) rodam na máquina de dev. Docker Desktop no Windows tem fricção real (consumo de RAM, lentidão de bind mount, restart de container) que pode tornar a experiência ruim quando os apps Node rodam dentro de containers.

**Opções consideradas.**
- **(a) Tudo native** — Postgres, Redis e MinIO instalados direto no host. Sem Docker.
- **(b) Docker apenas para serviços de infra** — Postgres + Redis + MinIO via `docker-compose`. Apps Node rodam fora do Docker, com `pnpm dev` direto.
- **(c) Bancos cloud em dev** — Neon (Postgres), Upstash (Redis), R2/Spaces (MinIO).
- **(d) Tudo Docker** — apps + infra dentro de containers, com bind mount do código.

**Escolha.** (b) Docker apenas para serviços de infra.

**Justificativa.**
- Setup único (`docker-compose up -d`) — sobe e esquece. Serviços ficam em background sem incomodar.
- Evita as duas dores reais do Docker no Windows: bind mount lento (porque o código não vive dentro de container) e restart de container do app (porque o app roda native).
- Mantém reset rápido em dev: `docker compose down -v` zera tudo.
- Independente de internet (diferente de C).
- Migrar pra (a) depois é trivial — instalar Postgres/Redis nativo e remover o compose.
- Produção fica como decisão futura, sem amarrar a (b).

**Operação.**

`infra/docker-compose.yml` na raiz do monorepo:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: elora
      POSTGRES_PASSWORD: elora
      POSTGRES_DB: elora_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: elora
      MINIO_ROOT_PASSWORD: eloraminio
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio_data:/data

volumes:
  postgres_data:
  redis_data:
  minio_data:
```

Comandos comuns:

| Operação | Comando |
|---|---|
| Subir infra | `docker compose -f infra/docker-compose.yml up -d` |
| Parar infra | `docker compose -f infra/docker-compose.yml stop` |
| Resetar tudo (perde dados) | `docker compose -f infra/docker-compose.yml down -v` |
| Ver logs | `docker compose -f infra/docker-compose.yml logs -f postgres` |

**Banco de testes.** Mesmo container Postgres, database separada (`elora_test`). Cada teste de integração abre transação, executa, dá rollback. Reset entre testes em milissegundos.

**Migração futura para opção (a).** Quando/se Docker incomodar, instala Postgres + Redis + MinIO nativos no Windows (via instaladores oficiais ou WSL2), apaga o `docker-compose.yml`, ajusta variáveis de conexão. Sem refactor de código.

---

## 11. Decisões de escopo (fora do MVP)

Coisas explicitamente **fora do escopo** do projeto, registradas pra evitar revisitar a discussão.

### 11.1 Sem internacionalização

**Decisão.** O Elora opera em PT-BR apenas. Sem i18next, sem arquivos de tradução, sem chaves de tradução em componentes.

**Justificativa.**
- Mercado-alvo é Brasil. Não há plano de venda fora.
- i18next "preventivo" cria fricção em todo componente novo (toda string vira `t('chave')`) sem retorno até existir segundo idioma — que talvez nunca venha.
- Adicionar i18n depois é refactor amplo mas mecânico — find/replace de strings literais por chaves. Custo concentrado no momento que houver demanda real.
- Diferente do sistema anterior, que tem i18next configurado por requisito antigo.

### 11.2 Sem migração do sistema anterior

**Decisão.** O Elora é greenfield. Sem importador de dados do sistema anterior. Sem operação dual-running. Clínicas que adotarem o Elora começam zeradas.

**Justificativa.**
- Sistema anterior continua existindo pra quem está nele; Elora é produto novo pra clínicas novas.
- Importador de clientes/agenda/histórico é trabalho grande e específico, sem retorno proporcional num MVP.
- Schema do sistema anterior é MySQL com `empresa` no lugar de `tenant_id` — qualquer migração exigiria mapeamento manual caso-a-caso, não é "rodar script e pronto".
- Caso surja demanda real de migração específica (ex: a própria rede de franquias original migrando), faz-se importador pontual depois.

---

## 12. Padrões herdados do sistema anterior

Coisas que funcionam bem e ficam:

- Estrutura de módulos por domínio (Controller/Service/Query/Types/Routes).
- Auth com JWT + `AuthVersionStore` + `LoginRateLimiter`.
- Header `X-App-Version` para detectar deploys e oferecer reload no frontend.
- Socket.io com salas por entidade lógica (no Elora: `tenant:${tenant_id}` em vez de `empresa:${empresa}`).
- Validação (com Zod no Elora; era Yup no sistema anterior).
- MinIO para storage.

Coisas que mudam:
- `empresa` (header e coluna) → `tenant_id` + `unit_id`.
- MySQL → Postgres.
- `node-cron` → BullMQ.
- Chat acoplado → Chat como app separado.
- Sem testes → pirâmide pragmática (Vitest unit + integration, Playwright E2E em golden paths). Ver seção 8.
- i18next no frontend → removido. PT-BR apenas. Ver seção 11.1.
- Generic handlers em `shared/generic/` → removidos. Cada Controller é explícito. Ver seção 5.

---

## 13. Apps/chat — decisões operacionais

**Contexto.** A camada WhatsApp e o modelo de domínio estão fechados em §7 e [chat-domain.md](./chat-domain.md). Esta seção fecha as decisões operacionais que faltam pra começar a implementar `apps/chat`: ownership das tabelas, auth entre apps, routing pro frontend e realtime.

### 13.1 Ownership do domain layer

**`conversations` e `messages` são owned pelo `apps/chat`.** Apesar de morarem no schema compartilhado (`packages/db`), o CRUD direto acontece no chat — inbound (webhook), outbound (POST `/messages`) e `internal_note` (staff anota pela UI do chat). `apps/core` consulta via HTTP interno quando precisa renderizar timeline no perfil do cliente; nunca escreve. Reduz hops de rede no caminho write-heavy e mantém o controle perto do canal.

**`clients` e `journeys` também precisam ser escritos pelo chat** durante o webhook normalizer (chat-domain.md §11.1 — primeiro inbound cria cliente + journey automaticamente). Conceitualmente são do core (vai expor CRUD pra UI), mas o chat precisa criar essas linhas antes de existir UI no core. **Decisão (2026-05-13):** chat escreve direto via DB, por trás de uma fachada `shared/coreGateway/CoreGateway.ts`. Quando o core ganhar módulos `clients`/`journeys` próprios + rotas internas, troca o singleton `LocalCoreGateway` por `HttpCoreGateway` — zero mudança nos call sites. RLS protege isolamento entre tenants no caminho atual.

### 13.2 Auth entre apps (service-to-service)

**Shared secret em env (`INTERNAL_API_SECRET`), validado via header `X-Internal-Auth`.** Tráfego interno, mesmo cluster — JWT de serviço é overkill agora. Migra pra JWT assinado quando virar multi-cluster ou tiver outro serviço entrando.

### 13.3 Tenant resolution no chat

Varia por superfície:
- **Webhook `/webhook/whatsapp/:channelId`** → resolve via `whatsapp_channels.tenant_id`. Provedor não conhece subdomínio.
- **HTTP interno do core** → header `X-Tenant-Id` + `X-Internal-Auth`.
- **Frontend autenticado** → mesmo padrão do core (subdomínio + JWT compartilhado).
- **Workers BullMQ** → `tenant_id` no payload do job; worker abre `withTenant()` antes de tocar DB.

### 13.4 Roteamento do frontend → chat

**Path `/chat/*` no mesmo subdomínio do core, via reverse proxy.** Frontend chama `clinicax.elora.app/chat/messages`; proxy roteia pro `apps/chat`. Vantagens: cookies/CORS unificados, JWT único compartilhado entre os 2 apps, mesma origem evita preflight. Em dev, Vite proxy. Em prod, nginx/caddy.

### 13.5 Realtime (socket.io)

**Socket.io só no `apps/core`; `apps/chat` publica eventos canônicos via Redis pub/sub.** Frontend mantém uma única conexão (com auth+tenant context já resolvidos no core). Chat publica em canais nomeados (`wa.message.received`, `wa.status.updated`, etc); core escuta o pub/sub e repassa pras salas socket apropriadas (`tenant:${id}`, `conversation:${id}`).

**Inventário completo** (publishers, payloads, salas, consumers no frontend, queries invalidadas, e gaps conhecidos) vive em [realtime-socket-events.md](./realtime-socket-events.md). Quando adicionar/remover evento, atualizar lá no mesmo PR.

### 13.6 Providers WhatsApp — Evolution + mock-first em dev

**Adapter de produção:**
- **`EvolutionAdapter`** — adapter único pros dois tracks (Baileys e Meta Cloud), via Evolution API v2 como gateway. Container Evolution sobe via `docker-compose` (imagem `evoapicloud/evolution-api:latest`). Ramificação por `provider_config.integration` nos pontos onde Baileys e Cloud divergem (template approval, fluxo de mídia).

**`MockAdapter`** continua relevante mesmo com Evolution rodando — caminho de dev offline, CI sem dependência externa, e exercitar pipeline antes de pareamento QR / credenciais Cloud. Factory escolhe Mock quando `provider_config.mock === true` (válido só em dev).

**Por que NÃO dois adapters (Baileys e Cloud separados)**: Evolution v2 expõe a mesma API REST pros dois modos, com o mesmo formato de webhook. Ramificação interna no adapter custa menos código que dois objetos com 95% do mesmo comportamento.

### 13.7 Módulos do `apps/chat`

```
apps/chat/src/
├── modules/
│   ├── whatsappChannels/       admin cadastra canal (provider+config+phone)
│   ├── whatsappContacts/       transport — vínculo com clients (+ findOrCreateByPhone)
│   ├── whatsappConversations/  transport — link channel↔contact↔conversation, janela 24h
│   ├── whatsappMessages/       transport — payload bruto + status
│   ├── messageTemplates/       templates com surface_in_stage[]
│   ├── conversations/          domain layer (chat é dono)
│   ├── messages/               domain layer (chat é dono) + outbound (enqueueOutbound → worker)
│   ├── webhooks/               POST /webhook/whatsapp/:channelId → enfileira normalizer
│   └── automations/            (pendente — depois do frontend, ver §13.8)
└── shared/
    ├── coreGateway/            fachada pra writes em tabelas core-owned (clients, journeys)
    ├── eventBus/               Redis pub/sub helper (re-exporta @elora/events-contracts)
    ├── providers/whatsapp/     IWhatsAppProvider + MockAdapter + EvolutionAdapter + EvolutionAdmin
    ├── outboundGuard/          rate limit + dedupe Redis pra canais não-Cloud (§7.3)
    ├── workers/inboundNormalizer/  BullMQ Queue + Worker do pipeline de inbound
    ├── workers/outboundDelivery/   BullMQ + lock por conv + reconciler de stuck pending (§7.11)
    ├── openapi/                registry + helpers pro endpoint /openapi.json
    └── (database, errors, middleware, observability, redis, utils — espelhados do core)
```

### 13.8 Ordem de implementação

1. ✅ **Esqueleto** — `apps/chat/` com server.ts, env, lint, tsconfig, módulo shared mínimo, endpoint `/health`.
2. ✅ **`whatsappChannels` CRUD**.
3. ✅ **`IWhatsAppProvider` + `MockAdapter`**.
4. ✅ **`messageTemplates` CRUD**.
5. ✅ **`conversations` + `messages`** (domain layer).
6. ✅ **`whatsappContacts` + `whatsappConversations` + `whatsappMessages`** (transport layer).
7. ✅ **Webhook normalizer** — endpoint `/webhook/whatsapp/:channelId` + worker BullMQ (`shared/workers/inboundNormalizer/`). Migração `0005_resolve_channel_tenant.sql` (SECURITY DEFINER) resolve channel→tenant sem RLS. CoreGateway abstrai writes de `clients` + `journeys`.
8. ✅ **Outbound V1** — `POST /conversations/:id/messages` em `MessagesService.sendOutbound`. Discriminated union por kind (text/media/template), valida opt-in + janela 24h sincronamente, chama adapter, persiste em transação, publica `wa.message.sent`. **Substituído pelo V2 em 2026-05-26.**
9. ✅ **Realtime** — `@elora/events-contracts` extraído. Core ganhou Redis subscriber dedicado + Socket.IO embarcado no mesmo HTTP server. Auth no handshake (cookie ou Bearer). Salas com prefixo `tenant:${id}:` pra isolamento por construção.
10. **`automations`** + workers BullMQ. **Adiado até o frontend amadurecer** — sem UI pra definir triggers/templates/filtros, automação vira código sem teste. Volta na fila quando os módulos principais do frontend estiverem usáveis.
11. **`EvolutionAdapter`** — adapter real único pros dois tracks. Subir container Evolution no `docker-compose.yml`, implementar adapter com ramificação Baileys/Cloud por `provider_config.integration`, endpoint admin pra provisionar instância no Evolution + parear QR. Cobre ambos os tracks; modo Cloud só é exercido quando primeiro tenant Cloud aparecer.
12. ✅ **Outbound V2** — controller agora é `MessagesService.enqueueOutbound`: faz INSERT `delivery_status='pending'` + publica `message.created` + enfileira BullMQ. `OutboundDeliveryWorker` (`shared/workers/outboundDelivery/`) faz pre-flight + adapter + UPDATE pra `sent/failed/rejected` + publica `wa.message.status_changed`. Reconciler via `setInterval` 5min varre `pending` stuck. Frontend perdeu tempId/optimistic. Detalhamento completo em §7.11.

### 13.9 `packages/events-contracts`

✅ Criado no passo 9, estendido no passo 12. Contém:
- `EVENT_CHANNELS` — nomes canônicos dos canais Redis (`wa.message.received`, `wa.message.sent`, `wa.status.updated`, `wa.channel.connection_changed`, `wa.message.revoked`, `lead.created`, `message.created`, `wa.message.status_changed`)
- Tipos dos payloads de cada evento
- `SOCKET_ROOMS` — helpers pra montar nomes de sala socket.io com prefixo `tenant:${id}:`

Mudança de evento = mudança aqui = ambos os apps (chat publisher + core consumer) atualizam no mesmo PR. Inventário com publishers/consumers/payloads em [realtime-socket-events.md](./realtime-socket-events.md).

---

## 14. Design System Frontend

**Contexto.** As primeiras telas autenticadas (Clients, WhatsappChannels) precisavam de um padrão visual e de componentes reutilizáveis pra evitar duplicar layout/scroll/ordenação em cada página. Sem padrão estabelecido cedo, cada tela inventa o seu — e a homogeneidade se perde rápido.

**Opções consideradas.**
- **(a) Cada página resolve sozinha** — máxima flexibilidade, mas duplica layout, scroll, toolbar, etc. Inconsistente.
- **(b) Componentes universais + tokens semânticos** — padrão composto: `PageContainer`, `PageToolbar`, `RowActions`, `SortableHeader`, etc. Páginas viram composição declarativa.
- **(c) Framework pronto (Material/Mantine)** — descartado em §3.1 por peso e cara visual opinada. Inviável reverter agora.

**Escolha.** (b) componentes universais sobre shadcn primitives + Tailwind v4, com tokens semânticos OKLCH.

**Justificativa.**
- Padrão único garante consistência visual sem disciplina manual em cada PR.
- Componentes encapsulam decisões complexas (auto-medição de overflow, cascata flex de altura, cycle tri-state de sort) que cada página teria que reimplementar.
- Tokens semânticos (`primary`/`info`/`success`/`warning`/`error`/etc) substituem hex hardcoded — trocar paleta = editar `index.css`, não 30 arquivos.
- Layout sem `vh`/`calc()` resolve o problema crônico de altura cortada no mobile (barra de nav do browser).

**Catálogo + manual de uso completo em [frontend-design-system.md](./frontend-design-system.md).** Esse documento é a referência prática — antes de criar componente novo, conferir lá se já existe.

**Decisões registradas:**
- 8 categorias semânticas de cor (primary, secondary, tertiary, info, success, warning, error, default=primary). Tokens em OKLCH em `apps/frontend/src/index.css`.
- `PageContainer` reivindica altura do `<main>` com `h-full overflow-hidden` — quem rola é o filho com `flex-1 min-h-0 overflow-y-auto`.
- `PageToolbar` faz colapso responsivo via ResizeObserver + `minWidth`/`priority` declarados — sem CSS magic numbers.
- Ordenação padronizada com helper backend (`createSortSpec` + `sortQuerySchema` + `resolveSort`) e hook frontend (`useSortState`).
- Coluna de ações de tabela: primeira, header vazio, ícones lucide com tooltip; `RowActions` colapsa em popover quando há 3+ ações.
- **Tokens de chat (verde por associação ao WhatsApp)** — namespace dedicado fora das 8 semânticas universais. `--chat-accent` (verde médio em OKLCH) pra avatares, badges unread, send button e indicators; `--chat-bubble` pra bolha outbound (pastel no light, verde escuro no dark estilo WhatsApp). Cria separação visual clara entre core (CRM, azul primary) e chat (atendimento, verde). Adicionado em 2026-05.
- **Tokens `warning-soft` / `error-soft`** (2026-05-26) — pares opacos (lightness alta, chroma baixo) pras superfícies grandes em estado de alerta: bolha de mensagem em falha, banners, cards de erro. `bg-warning` direto é saturado demais pra cobrir um balão inteiro; alpha sobre o pattern do chat-bg fica visualmente sujo (textura passa por trás). Os "soft" são opacos e tem foreground combinando (texto escuro do mesmo matiz pra contraste AA). Usados na bolha outbound `delivery_status='rejected'` (amarelo soft) e `failed` (vermelho soft) — ver §7.11.
- **Wallpaper de conversa via `.chat-bg`** — utility CSS troca `background-image: url('/wpp-{light,dark}.png')` conforme tema (classe `.dark` no `<html>`). Aplicado em `MessageList` + `ChatPaneEmpty`. `background-size: 480px auto` força tile visível (imagens fonte são grandes — 760×1396 light, 1080×1920 dark — sem cap renderizariam fullscreen sem mostrar repetição).
- **Header enxuto** — `<Header>` da área autenticada hospeda apenas: botão mobile de menu + `<MinimizedBar />` (cards de conversas minimizadas, antes ficava `fixed bottom`) + `<HudConversations />` (dropdown de inbox com badge) + `<ChatModeButton />`. Nome do produto, troca de tema e user/logout saíram pra outros lugares: tema vive em `/settings/preferences`, user/logout migraram pro rodapé do `<Sidebar />`. Cards minimizados encolheram pra caber em 56px de header (`text-xs` no nome, `text-[10px]` no preview).

## 15. Grupos e visibilidade de menu: GLOBAIS

**Contexto.** O modelo inicial tinha `groups` como tabela tenant-scoped (cada clínica criava seus próprios grupos) com RLS, e `menu_groups` (qual grupo vê qual menu) também tenant-scoped. Isso gerava uma matriz de customização per-tenant via `CustomizationPage` — em teoria flexível, na prática:

1. Todo tenant deixava o admin enxergar tudo (a "customização" nunca acontecia).
2. CRUD de grupos era exposto ao tenant mas sem UI implementada — placeholder permanente.
3. `loadUserRoles` precisava resolver `userGroups → groups` por tenant, com `withTenant` mesmo só pra ler perfil.
4. Toda mensagem de `addMember`/`removeMember`/`menu_groups` carregava `tenantId` como decoração desnormalizada.

**Opções consideradas.**
- **A — `groups` tenant, `menu_groups` tenant** (status quo): máxima flexibilidade per-tenant. Custo: matriz que ninguém customiza, RLS extra, CustomizationPage.
- **B — `groups` global, `menu_groups` tenant**: simplifica grupos mas mantém matriz per-tenant. Não resolve a CustomizationPage.
- **C — `groups` global, `menu_groups` global** (escolhida): perfil universal, matriz universal, gerência centralizada pela equipe Elora.

**Escolha.** Opção C, com restrições:
- `groups` é global, **1:1 com `role_code`** — 5 linhas fixas (`Administradores`, `Gerentes`, `Profissionais`, `Recepção`, `Visualizadores`). `unique(name)` e `unique(role_code)`.
- `menu_groups` é global. Matriz menu × grupo única no sistema.
- CRUD de `groups` e de `menu_groups` é **super-admin only** (`requirePlatformAccess`). Tenants leem pra membership e pra UI.
- `user_groups` continua **tenant-scoped + RLS** — o vínculo user×grupo é específico do tenant (mesmo email pode existir em N tenants com perfis diferentes).
- `loadUserRoles` continua dentro de `withTenant` porque `user_groups` tem RLS, mas o JOIN com `groups` virou comum (sem filtro de tenant).
- CustomizationPage (frontend) e módulo backend `menuAccess` foram **removidos** — sem matriz per-tenant, perdem propósito. Quando a equipe Elora precisar editar a matriz global, criamos um screen super-admin dedicado (não é prioridade até hoje).

**Justificativa.** O eixo de customização que `menu_groups` per-tenant supostamente habilitava nunca foi exercido — todo tenant deixou o admin ver tudo. Manter essa flexibilidade hipotética custava RLS, código, UI placeholder e uma página de gestão que confundia mais do que ajudava. A unificação reduz superfície de bug (menos código com `tenantId`) e simplifica a história de permissão pro tenant: "seu admin é o grupo Administradores, e ponto".

**Migração.** `0010_foamy_swordsman.sql` — `TRUNCATE menu_groups, user_groups, groups` + DROP da coluna `tenant_id` e das policies/RLS em ambas. Pré-produção, sem dados reais. Seed recria os 5 grupos globais antes dos tenants e popula `menu_groups` global por mapeamento de `role_code → paths visíveis`.

## 16. Conversations: 1 por (cliente, canal-whatsapp)

**Contexto.** Modelo inicial: `conversations` tinha `unique(client_id)` — 1 conversation por cliente, atravessando todos os canais. Mesma pessoa que falasse com 2 números da clínica veria histórico misturado.

**Decisão.** *Migrado em 2026-05.* `conversations` ganhou `whatsapp_channel_id NOT NULL` + FK + index. Unique trocado pra `(client_id, whatsapp_channel_id)`. Mesma pessoa em 2 canais = 2 conversations distintas.

**Justificativa.**
- Cada canal tem identidade própria — número, equipe alocada, lifecycle de pareação, cor (ver §7). Histórico misturado confunde a operação ("essa mensagem veio pra qual número meu?").
- Pareou-se com a feature `whatsapp_channels.color` (§7) que diferencia visualmente cards minimizados e janelas flutuantes. Sem split por canal, a cor não teria semântica clara.
- Custo: ligeiro N maior em listagens (mesmo cliente vira N cards), aceito porque é o efeito desejado pra clareza operacional.

**Backend.**
- `ConversationsService.findOrCreateForClient` renomeado pra `findOrCreateForClientChannel(tenantId, clientId, channelId)`. Pipeline (`handleInbound` + `handleOutboundCaptured`) já tinha `channelId` em escopo no momento certo — passou adiante sem reestruturar.
- `POST /conversations` (find-or-create HTTP) agora exige `whatsappChannelId` no body.
- API de conversation responde `channel: {id, name, color}` embedded — frontend consome direto.

**Frontend.**
- `MinimizedEntry` ganhou `whatsappChannelId` + `channelName` + `channelColor`. Todos os 5 call sites que constroem entry (HudConversations, ChatModeSidebar, MobileChatSheet, FloatingChatWindow, useChatRealtime) populam os 3 campos.
- `MinimizedCard` aplica `border-left: 4px solid {channelColor}`; `FloatingChatWindow` aplica `border-top: 3px solid {channelColor}` no header. Inline style porque a cor vem do DB (Tailwind não suporta classes arbitrárias com cor dinâmica).

**Migração.** `0012_adorable_thunderbolt.sql` — `TRUNCATE conversations CASCADE` (perda de messages de teste em dev, combinado com o time) + ADD COLUMN NOT NULL + ADD UNIQUE composta. Pré-produção, sem dados reais que justificassem backfill. Próximo inbound recria tudo.

**Roadmap.** Quando outros providers (Instagram, email) entrarem, decidir entre (a) generalizar `channel_id` polimórfico com discriminador (`channel_type`) ou (b) adicionar colunas separadas (`instagram_channel_id` etc) também nullable + check constraint exigindo exatamente uma preenchida. Repensar quando virar dor real.

## 17. Frontend: split por domínio (revisitado — voltou pra flat em 2026-05-22)

> **Atualização de 2026-05-22:** Esta seção registra DUAS decisões: o split feito em 2026-05-19, e a reversão em 2026-05-22. Mantenho o histórico inteiro porque a sequência ensina algo (split simétrico antecipou um cenário que veio assimétrico). Quem chega novo no projeto, ver "Reversão" no fim da seção pra estado atual.

**Contexto.** A estrutura original do `apps/frontend` era flat: `components/{ui,layout,data,form,theme,auth,chat}/`, `pages/`, `hooks/`, `lib/`, `stores/`. Componentes de core (clínica) e chat (WhatsApp) conviviam misturados — `components/chat/` tinha 16 arquivos, o `Header` em `components/layout/` importava `MinimizedBar` e `HudConversations` de chat, e o `lib/api/` misturava clientes de `coreApi` e `chatApi`. Funcionou no MVP, mas conforme o chat ganhou padrões visuais próprios (paleta verde, bolhas, wallpaper, janela flutuante, modo dedicado) ficou claro que estava se tornando um sub-sistema com identidade própria — e a mistura tava cobrando custo cognitivo em cada PR ("isso é chat ou core?").

**Opções consideradas.**
- **(a) Manter flat** — minimiza moves, mas o ruído aumenta linearmente com o crescimento dos dois lados. Cedo ou tarde, "qual desses 30 hooks é meu?".
- **(b) `chat/` como módulo isolado, resto flat** — meio termo. Resolve só metade — o core continua misturado com shared.
- **(c) Quatro buckets: `app/`, `shared/`, `core/`, `chat/`** — espelha o eixo do backend (`apps/core` × `apps/chat`), isola o shell que costura tudo.

**Escolha.** (c) quatro buckets, com regra dura: `core` e `chat` nunca se importam mutuamente. Tudo que precisar atravessar vira slot/callback em `app/shell/` (o único bucket autorizado a importar dos dois). Implementado em 2026-05-19.

**Justificativa.**
- Reflete o eixo já consolidado no backend — symmetry reduz fricção cognitiva.
- Torna a "cola" entre core e chat **explícita e localizada**: hoje o `Header` (em `app/shell/`) é o único componente que importa de chat E renderiza dentro do shell core. Sem o bucket `app/`, esse acoplamento ficaria implícito em qualquer `components/layout/*`.
- Habilita a separação visual (ver §14 + `.chat-scope` em [frontend-design-system.md](frontend-design-system.md)) sem duplicar primitivos — shadcn `<Button>`/`<Input>`/`<Checkbox>` continuam em `shared/components/ui/` (agnósticos, leem CSS vars); a paleta verde do chat é injetada via scope class no root das surfaces de chat.
- Caminho de evolução natural: quando o core ganhar mais módulos clínicos (appointments, procedures, units, sessões de laser), `core/` cresce sem encostar em `chat/`. Quando `automations/` (ver §13.8) finalmente entrar, vai pra `chat/` sem cruzar com o core.

**Estrutura final.** Detalhamento completo em [frontend-design-system.md](frontend-design-system.md). Resumo:

```
apps/frontend/src/
├── app/         shell + rotas (compõe os dois lados)
├── shared/     primitivos agnósticos (shadcn, layout, data, form, theme, auth, lib/api/{client,me,auth,interceptors})
├── core/       domínio clínico (Dashboard, clients, settings/{menus,users,preferences}, hooks/api de core)
└── chat/       domínio WhatsApp (composer, bolha, HUD, flutuante, modo chat, settings/whatsappChannels)
```

**Renomes notáveis.**
- `AppLayout` → `AppShell` (componente + arquivo) — reflete o novo papel de "shell de composição entre lados".
- `HudConversations`, `HudNotificationBadge`, `MinimizedBar` saíram de `components/layout/` pra `chat/components/` — são features de chat, não estruturais.
- `ChatRealtimeBoot` saiu de `components/chat/` (que não existe mais) pra `chat/components/` — montado em `app/App.tsx`.

**Trade-offs aceitos.**
- Imports passaram a ser mais longos (`@/shared/components/ui/button` vs `@/components/ui/button`). Compensação: o caminho diz o que a coisa é (primitivo agnóstico).
- A pasta `core/components/` ficou vazia (placeholder) na transição — todos os pedaços visuais do core ainda dependem de `shared/` puros (Table, RowActions, Sheet). Vai povoar quando os módulos clínicos chegarem.
- Settings que mora em `chat/pages/settings/whatsappChannels/` mas é roteado em `/settings/whatsapp-channels` cria uma assimetria URL × código. Aceito: a URL é detalhe de routing, o conteúdo é chat. Mesma lógica vale pro inverso (settings de core em `core/pages/settings/`).

**Migração.** 104 arquivos `.ts/.tsx` movidos via `git mv` (histórico preservado), 50+ regras sed pra reescrever paths `@/*`, `tsc --noEmit` validou. `App.css` órfão deletado. Sem mudança de comportamento — só reorganização + adição de `.chat-scope` no `index.css`.

### Reversão (2026-05-22) — voltou a flat por tipo

**Contexto.** Três dias depois do split, ao construir o kanban de leads, a regra `core ⊥ chat` começou a doer concretamente:

- Lead é projeção sobre `journey` (core no backend), mas o substage reage a mensagens (chat) — a cascata em `@elora/db` lê `messages` e `appointments` na mesma transação, e o frontend de leads precisa invalidar suas queries quando chegam eventos socket de mensagem. Esse acoplamento de runtime (compartilhar o mesmo `useChatRealtime`, o mesmo `chatBridge` pra abrir conversa do card) cruza a fronteira de domínio em todo lugar — não tem como manter `core ⊥ chat` sem ramificar import paths em cada ponto de contato.
- A simetria que justificou o split sumiu: hoje o frontend tem ~11 surfaces de core (clients, leads, journeys, quotes, appointments, procedures, tenants, users, menus, availability, preferences, dashboard, login) contra 1 de chat (whatsappChannels) + componentes UI. **90/10**, não 50/50. Espelhar um eixo backend que é simétrico num frontend que é assimétrico cobra overhead em cada decisão de "onde isso vai".
- O bucket `core/components/` ficou vazio o split inteiro — nenhum componente compartilhado SÓ entre páginas core surgiu. (Cogitamos brevemente reusar `ChatSidebarItem` como base do `LeadCard`, mas a ideia foi descartada: os dois têm propósitos visuais distintos — preview de conversa vs. card de funil — e forçar reuso ali polui ambos. Cada um segue independente.)
- A "cola explícita em `app/shell/`" funcionou bem pra Sidebar (1 ponto de cola), mas cresceria mal — toda nova surface cross-cutting (dashboard de conversion, perfil de cliente com última conversa) viraria mais cola em `app/`, ou exceções na regra.

**Decisão.** Reverter pra **flat por tipo**: `app/`, `components/`, `pages/`, `hooks/`, `api/`, `lib/`, `stores/`. Sem fronteira de domínio entre core e chat. Sub-pasta `components/chat/` permanece como agrupamento *visual* (coesão de palette, ~17 arquivos), não como bucket isolado. Estado descrito em [frontend-design-system.md](frontend-design-system.md).

**Justificativa.**
- O custo de manter a regra cresce com cada caso cross-cutting. O ganho prometido (organização simétrica que segue o backend) não compensa quando o frontend é dominantemente core.
- Flat por tipo mantém o que importava do split (primitivos em `components/ui`, paleta `.chat-scope` por CSS, shell isolado em `app/`) sem o muro entre domínios. Componentes específicos de chat continuam agrupados em `components/chat/` por coesão; primitivos genéricos ficam fora.
- Reuso entre superfícies vira problema de promoção (`components/<sub-domínio>/`) em vez de problema de ergonomia de imports.

**Migração de reversão.** 133 arquivos movidos via `git mv` (histórico segue). Imports reescritos via 14 regras sed (`@/shared/lib/api/` → `@/api/` antes de `@/shared/lib/` → `@/lib/` pra evitar prefix collision, etc — mesma armadilha do split de ida). `tsc --noEmit` validou. Sem mudança de comportamento.

**Trade-offs aceitos novamente.**
- Imports voltam mais curtos (`@/components/ui/button` vs `@/shared/components/ui/button`).
- `components/chat/` segue agrupado por coesão, não por isolamento. Quem precisar trabalhar nele importa direto, sem regras.
- Se daqui meses a equipe crescer e a complexidade do core justificar split de novo, refaz — é refactor mecânico (já fizemos duas vezes em 7 dias, em <1h cada).

## 18. Agenda: grid de tempo + janelas disponíveis

**Contexto.** A agenda principal (`/agenda`, CalendarPage) precisa exibir um grid 6h–22h (intervalos de 30min) com cards posicionados por horário e duração, em duas modalidades: **dia** (colunas = profissionais) e **semana** (colunas = dias). Tentativas iniciais com `flex-col` em coluna + header `sticky top-0` tiveram um bug recorrente — o header "desgrudava" após ~480px de scroll. Diagnóstico: em flex item com `min-height: auto` + `align-stretch`, o containing block do sticky resolve pra altura do parent (= viewport), e o sticky escapa quando o scroll passa esse limite. Já tínhamos encontrado o mesmo problema no projeto legado `corpo-bueno`.

**Escolha.** Colunas como **block container com altura explícita em pixels** (`style={{ height: COLUMN_FULL_HEIGHT_PX }}`), igual ao padrão validado em `corpo-bueno`. O sticky usa os 1960px reais (header + body) como bounds, e funciona em todo o scroll. Cards são `absolute` dentro do body, posicionados por `top = (minutos desde 6h) * PIXELS_PER_MINUTE`.

**Layout final.** PageContainer + toolbar card no topo (mesmo h-14 do `PageToolbar`) + grid card abaixo — visualmente alinhado com as outras pages do core (Clients, Procedures, Journeys). Toolbar tem: navegação dia/semana, popover de mini-calendário (só em day view, week mostra range nos headers das colunas), botão "Hoje", ButtonGroup dia/semana, popover "mais opções" (categorias/anestésico/bloquear período — em breve). Layout anterior com sidebar lateral colapsável foi descartado.

**Visualização de `professional_schedules`.** Faixas horárias do profissional aparecem como **blocos de fundo `bg-success/10`** atrás das linhas de hora e dos cards, calculadas a partir das schedules (sem fetch de slots livres — esse endpoint só é chamado no formulário de agendamento). Helper schedulesToRangesForDate filtra por `day_of_week` + janela `effective_from/to` (comparação string YYYY-MM-DD pra evitar shift de timezone), converte `HH:MM:SS` em minutos desde 6h, e mescla janelas sobrepostas. Regra de exibição:
- **Day view** (colunas = profissionais): faixa de cada profissional pra data selecionada.
- **Week view com foco em profissional**: faixa daquele profissional pra cada dia.
- **Week view sem foco** ("todo mundo"): união das agendas — mostra quando a clínica tem **alguém** disponível naquele intervalo.

## 19. Fichas (`client_forms`) ancoradas em `evaluation_id`

**Contexto.** Módulo de fichas (anamneses) customizáveis pelo tenant — implementado primeiro com unique `(client_id, form_template_id)`, copiando a noção do CB de "1 ficha por (cliente, template)". Na primeira sessão de uso real ficou claro que esse modelo é frágil pra reavaliação: cliente que volta em 6 meses pra uma `evaluation kind=reevaluation` reabriria a mesma `client_form` e sobrescreveria as respostas — perdendo o snapshot do estado inicial pra comparação evolutiva.

**Opções consideradas:**
1. **Versionar `client_forms`** com coluna `version` + chave composta — duplica linha a cada update mesmo dentro da mesma avaliação. Custo de query alto pra "ficha vigente".
2. **Snapshots em jsonb** dentro da ficha vigente — quebra a tipagem das `form_answers` e perde indexação por pergunta.
3. **Anchorar em `evaluation_id`** — cada evento clínico (initial, reevaluation, return) tem seu próprio conjunto de fichas. Atualizações dentro do mesmo evento ainda fazem update da linha (não duplicam).

**Escolha (2026-05-25).** Opção 3. `client_forms` recebeu `evaluation_id NOT NULL` (cascade), `client_id` virou denormalização derivada de `evaluation.client_id` (preserva listagem agregada "todas as fichas do cliente" sem JOIN), unique passou pra `(evaluation_id, form_template_id)`. Endpoint canônico de criação é `POST /evaluations/:id/forms`; `GET /clients/:id/forms` mantido como read-only agregado.

**Justificativa.** Cada `evaluation` é por definição o "momento clínico" — modela o que o profissional viu naquela ocasião. Atrelando a ficha ao evento, preservamos comparação inicial vs reavaliação sem ginástica de versionamento. Trade-off aceito: dois lados precisam manter `client_id` em sync (FK + denormalização) — service garante isso derivando o `clientId` da própria evaluation no momento do insert (defesa em profundidade).

**UI consequente.** ClientDetailPage tem seção "Fichas de avaliação" listando `evaluations` do cliente (não fichas direto) com resumo "X finalizadas, Y rascunho". Cada linha leva pra `/evaluations/:id/forms` — página dedicada com header da avaliação, warning de fichas obrigatórias pendentes (templates com `required_for_evaluation=true`), e lista de todos os templates ativos do tenant com badge de status ("Não iniciada" / "Rascunho" / "Finalizada" / "Arquivada"). Clicar "Preencher" cria a ficha lazy se ainda não existe e abre o sheet de respostas.

**Por que não quebrar a unique no futuro.** Avaliada e descartada (2026-05-25) a hipótese de permitir N fichas do MESMO template por evaluation (caso de uso seria "preencher template várias vezes na mesma avaliação" — ex: snapshot semanal dentro de uma reavaliação mensal). User confirmou que esse caso não existe na operação real: a granularidade clínica relevante é o evento (`evaluation`), não sub-eventos dentro dele. Manter `unique(evaluation_id, form_template_id)` como contrato definitivo simplifica queries (`SELECT … WHERE evaluation_id = ?` devolve no máximo 1 por template, sem precisar de `ORDER BY ... LIMIT 1`) e mantém a UI determinística ("Acessar ficha" sempre aponta pra mesma linha).

**Cores de card.** calendarColors.ts define dois modos via `UserPreferences.calendarColorMode` (jsonb): **status** (cor por status do appointment — scheduled/confirmed/cancelled…) e **procedure** (cor do procedimento, fallback neutro pra evaluations e sessions sem procedure resolvida). Helpers `lighten`/`darken` derivam tons; cor base vem hex (`procedures.color varchar(7)` — migration 0018). Evaluation usa cor fixa (`EVALUATION_HEX`) porque não tem procedure associada.

## 20. Journey strip horizontal no ClientDetailPage

**Contexto.** A linha do tempo da journey no ClientDetailPage era uma lista vertical de events (`journey_events` ordenados por createdAt desc). Era informativa mas pouco escaneável: o "estágio atual da journey" se perdia no meio dos eventos detalhados (form_completed, quote_created, etc.). Detalhe importante — o cliente tem **uma** journey ativa por vez e a equipe operacional precisa entender em 1 segundo onde ela está no funil.

**Escolha.** Strip horizontal full-width com 5 pinos (lead → evaluation → sale → treatment → result) substituindo a Timeline vertical. Substituição, não acréscimo: o detalhe granular vai morar na `/journeys/:id` (página dedicada). No detail do cliente, vale a visão macro com profundidade sob demanda.

**Estados visuais dos pinos.**
- `done` — círculo cheio na cor do stage (`STAGE_PIN_CLASS`) + ícone `Check`.
- `current` — círculo cheio + `ring-4 ring-primary/30` + label bold + `aria-current="step"`.
- `pending` — círculo `bg-muted` com `border-2 border-dashed` + número do stage + label muted.
- `lost` — vermelho com `X` (quando `journey.status = lost`, no stage atual; subsequentes ficam pending).
- `won` — força `done` em todos até o stage final.

**Conectores entre pinos viram trilhos de eventos.** Cada segmento entre os pinos X e X+1 representa o tempo em que a journey esteve no stage X. Eventos secundários (`evaluation_*`, `form_completed`, `quote_*`, `sale_closed`, `treatment_*`, `recycled_from`, `reopened_from_inbound`) viram **dots clicáveis** distribuídos uniformemente ao longo do conector. Distribuição não é temporalmente exata — só preserva ordem cronológica (eventos sorteados por createdAt asc).

**Hover/focus do dot abre Tooltip** com label PT-BR (`labelForEventType`) + relative time. Eventos sem ícone canônico caem em `Activity` (fallback).

**Helper `eventStageOrigin(eventType)`** ([journeyLabels.ts](../apps/frontend/src/pages/journeys/journeyLabels.ts)) mapeia cada evento pro stage onde "vive". Retorna `null` pra:
- `stage_transitioned` e `journey_created` — já representados pelos pinos
- `lead_substage_changed` — ruído pra strip (granular demais)
- `marked_won`/`marked_lost` — já refletidos no estado do pino result

**Tokens de cor.** `STAGE_PIN_CLASS` (sólido pros pinos) e `STAGE_LINE_CLASS` (sólido pros conectores) coexistem com o `STAGE_BADGE_CLASS` legado (tinted, /15) — usados em badges textuais nas outras sections. Manter os três permite combinar a hierarquia visual da strip (cores fortes) sem destoar dos badges (cores suaves).

**Trade-off aceito.** A strip mostra ~5–8 dots por segmento sem perder legibilidade; com mais eventos densos no mesmo stage, os dots começam a se sobrepor visualmente. Quando virar dor real (clínica com 20+ trocas no mesmo stage), considerar agrupar em "+N" expansível. Hoje, a journey típica tem ~3–5 eventos por stage — fica confortável.

## 21. Listagem global de avaliações (`/evaluations`)

**Contexto (2026-05-27).** Avaliações só apareciam dentro do `ClientDetailPage` (seção dedicada cruza `evaluation × appointment × client_forms`). Operação precisa de uma visão tenant-wide — "quais avaliações estão pendentes hoje", "buscar pelo nome do cliente sem ter que entrar no detalhe", "olhar fila do dia". Menu do seed já apontava `/evaluations` mas a rota não existia.

**Escolha.** Página global em [`apps/frontend/src/pages/evaluations/EvaluationsPage.tsx`](../apps/frontend/src/pages/evaluations/EvaluationsPage.tsx) com a mesma lógica de mesclagem do `EvaluationsSection` do detail: cada row exibe status do appointment (quando existe) com fallback no status da própria evaluation, kind, cliente, horário agendado e link pra `/evaluations/:id/forms`. Filtros: busca por nome/telefone do cliente, status e kind.

**Mesclagem agora vive no backend.** `GET /evaluations` mudou de retornar `Evaluation[]` cru pra `EvaluationListItem[]` enriquecido — backend faz inner join com `clients` e attach do appointment latest não-cancelado por evaluation (via `DISTINCT ON (evaluation_id) ORDER BY scheduled_at DESC` num único roundtrip). Espelha o pattern do `GET /quotes` (que já trazia client embutido). Endpoints unitários (`GET /:id`, `POST`, `PATCH`, `/cancel`) continuam com o shape nu de `Evaluation` — só a listagem ganha o join.

**Por que não fazer a mesclagem no frontend (como o detail faz).** No detail, o frontend já está num cliente específico — uma query por entidade (`useEvaluations({clientId})`, `useAppointments({clientId, kind:'evaluation'})`, `useClientForms(clientId)`) custa barato. Numa listagem global, separar viraria N+1 (pedir appointments dos N evaluations da página visível) ou exigiria um endpoint extra de "appointments por lista de evaluation IDs". Resolver com um único `DISTINCT ON` é mais barato e mantém a UI síncrona.

**Por que sem LATERAL.** Drizzle 0.38 não tem helper nativo pra `LEFT JOIN LATERAL`. Em vez de escrever raw SQL no query layer, o service faz duas queries (evaluations paginadas + appointments por lista de IDs) e mescla em memória. Custo extra: 1 roundtrip por listagem. Aceito porque mantém o query layer dentro do dialeto Drizzle e o service ganha controle explícito sobre a mesclagem (mesmo padrão que `useEvaluations` + `useAppointments` no detail).

**Trade-off aceito: fichas (`client_forms`) ficam fora da listagem global.** No detail, cada row mostra "X finalizadas, Y rascunho" — útil porque o agregado é por cliente. Na listagem global, replicar isso exigiria mais um JOIN/COUNT (formas finalizadas por evaluation) e ruído visual. Botão "Fichas" leva pra `/evaluations/:id/forms` onde o detalhe vive — quem quer ver fichas clica.

**Criação fica no detail.** "Nova avaliação" exige journey ativa do cliente; manter o fluxo de criação dentro do `ClientDetailPage` (que já tem o contexto de journey) evita ter que escolher cliente num combo na listagem global. Página global é só visualização + filtros + navegação.

## 22. Capacidades profissionais (`users.can_evaluate` / `users.can_apply_procedures`)

**Contexto (2026-06-10).** O modelo de autorização vivia inteiro em [`shared/permissions/permissions.ts`](../apps/core/src/shared/permissions/permissions.ts) — `PERMISSIONS` mapeia ação (`evaluations:write`, `procedureSessions:write`, etc.) pra `role_code` (admin/manager/professional/reception/viewer). Isso responde "quem pode chamar a API", mas não cobre "quem pode ser **atribuído** a um appointment". Cenário real de clínica: dentro do role `professional`, algumas funcionárias só fazem avaliação (avaliadoras), outras só aplicam procedimento (aplicadoras), algumas fazem as duas. Tratar isso pelo PERMISSIONS map exigiria criar roles novos (`evaluator`, `applicator`, `both`) e multiplicar a matriz — mas a permissão de **acesso ao módulo** é a mesma (todas leem clientes, sessões, treatments). É um eixo ortogonal.

**Opções consideradas.**
- **A — Roles novos** (`evaluator` / `applicator` / `professional_both`): multiplica a matriz `PERMISSIONS` pra cobrir as combinações. Acopla acesso (módulo) com capacidade (atribuição) — flexibilidade falsa.
- **B — Tabela `user_capabilities` (1:N)**: enum `capability` (`'evaluate' | 'apply_procedure'`) com row por user×capability. Extensível, mas overkill pros 2 valores atuais e gera JOIN/in-memory map em toda listagem de profissional.
- **C — Duas colunas booleanas em `users`** (`can_evaluate`, `can_apply_procedures`): adiciona o eixo sem inflar a matriz de roles. Lê direto do row do user (sem JOIN). Migration trivial. Custo: cada capacidade nova vira uma coluna nova — assumido que o catálogo cresce devagar (só 2 procedimentos clínicos hoje).

**Escolha.** Opção C. Duas colunas `boolean NOT NULL DEFAULT false` em `users`. Admin marca quem é avaliadora/aplicadora no cadastro (UI: `UserFormSheet` com dois switches no fieldset "Capacidades", acima de "Grupos").

**Gate.** `assertProfessionalCapability(tx, professionalId, kind)` em [`AppointmentsService`](../apps/core/src/modules/appointments/AppointmentsService.ts):
- `kind=evaluation` exige `users.can_evaluate=true`
- `kind=procedure` exige `users.can_apply_procedures=true`
- Falha = **AppError 409 com nome do profissional** ("Profissional X não está habilitada(o) como avaliadora(o)"). Sem fallback/warning — bloqueio rígido.
- Chamado no `create` (antes do `validateAppointmentSlot`) e no `update` apenas quando `input.professionalId !== current.professionalId`. Kind não muda no update; alterar a capacidade do profissional **depois** não invalida appointment existente (válido no momento da criação, fica).

**Frontend mirror.** [`AppointmentFormSheet`](../apps/frontend/src/pages/appointments/AppointmentFormSheet.tsx) filtra o dropdown de profissional via `eligibleUsers = users.filter(u => kind === 'evaluation' ? u.canEvaluate : u.canApplyProcedures)`. Mudar o `kind` limpa o profissional selecionado se ele perdeu elegibilidade. Quando `eligibleUsers.length === 0`, aparece warning ("Nenhum profissional habilitado como X. Marque a capacidade em Configurações > Usuários").

**Telas de leitura (Calendar, AppointmentsListView) não filtram.** O filtro é só pra *atribuição nova*. Histórico inclui appointments de pessoas que mudaram de capacidade depois — esconder esses appointments seria desinformação.

**Justificativa.** Os dois eixos têm naturezas distintas: `PERMISSIONS` é regra de **acesso à API** (centralizada em código, super-admin gerencia), capacidade é atributo **operacional do profissional** (admin do tenant gerencia caso a caso). Misturar implicaria mais roles e mais decisões super-admin que não escalam. Manter ortogonal: PERMISSIONS = "tem ação", `canEvaluate/canApplyProcedures` = "é elegível pra essa atribuição". Quando aparecer capacidade nova (ex: `can_administer_botox`), basta migration de schema — sem mexer no PERMISSIONS map.

**Migração.** `users.can_evaluate` e `users.can_apply_procedures` adicionadas como `boolean NOT NULL DEFAULT false` em junho/2026 (sem backfill — pré-produção). Admin precisa marcar as flags no UI antes de criar appointments.

---

## 23. Presença assinada de sessões (`procedure_session_attendances`)

**Contexto (2026-06-10).** Até hoje, "presença em sessão de procedimento" colapsava em um único clique no popover da agenda — a aplicadora apertava "Marcar presença" e o backend movia `appointment.status` pra `attended` e `procedure_session.status` pra `done` na mesma cascata. Faltam dois requisitos pra MVP de clínica: (a) **atestado de presença do próprio cliente** (foto + assinatura), pra defesa em eventual disputa ou auditoria sanitária; (b) **separar "compareceu" de "procedimento concluído com evolução clínica"** — hoje a aplicadora só assina presença na recepção, mas a evolução (anotação da técnica do dia, resultado parcial) é escrita depois, durante a aplicação. Misturar os dois eventos no mesmo status apaga rastreabilidade.

**Opções consideradas.**
- **A — Manter clique único** + campo opcional de assinatura no popover do operador (assinatura no tablet da clínica via canvas). Resolve (a), mas operador mediando enfraquece o valor probatório (alguém da clínica pode assinar por outra pessoa); operacionalmente lento; não resolve (b).
- **B — Fluxo 2-status (`pending → signed → done`) + link público pro cliente.** Operador gera link no popover; cliente abre no próprio celular, confirma CPF+nascimento, tira selfie, desenha assinatura; backend marca `signed` + `appointment.attended` + cria `attendance_record` com foto/assinatura/IP/UA. Evolução (signed → done) implementada em junho/2026 — ver §23.1.
- **C — Provider externo de assinatura** (reusar ZapSign do módulo de contratos). Custo: 1 doc por presença, modelagem forçando "documento" onde o que se quer é registro mínimo (selfie + assinatura simples), latência pior, dependência maior de provider externo.

**Escolha.** Opção B. Enum estendido pra `pending | signed | done | cancelled`, três tabelas novas (`procedure_session_attendances`, `procedure_session_attendance_sessions`, `procedure_session_signing_tokens`), página pública `/sessoes/assinar/:token` no frontend, evento Redis `procedure_session_attendance.recorded`.

**Justificativa.**
- O ato de assinar no próprio celular eleva o valor probatório — não há intermediação.
- Separar `signed` de `done` deixa explícito o gap "presença confirmada × evolução clínica concluída" que existe na prática (cliente pode ter compareceu mas a evolução só ficar pronta no fim do turno).
- Reutilizar ZapSign pra registro tão simples seria over-engineering — `selfie + assinatura SVG` cabe no nosso storage S3 (MinIO/R2), bucket dedicado `attendances`, sem dependência externa. Total típico por presença: ~40-90KB (SVG ~2-8KB + WebP ~30-80KB).

**Uma assinatura cobre N sessões do mesmo dia.** Cenário comum em depilação a laser: cliente faz 3 áreas corporais no mesmo turno. Forçar 3 assinaturas seria atrito; uma única foto+assinatura cobre todas as sessões `pending` do cliente no mesmo dia. Modelado como header (`procedure_session_attendances`) + junction com `session_id UNIQUE` (`procedure_session_attendance_sessions`).

**Snapshot do escopo no token.** Se entre clicar "Marcar presença" e o cliente assinar, alguém adicionar sessão extra naquele dia, ela **não é coberta** pela assinatura — o escopo congela no momento da emissão. Operador gera novo link pra cobrir a nova sessão (idempotência do endpoint reconhece "set mudou" e regenera). Comportamento previsível, audita exatamente o que o cliente viu na tela.

**Endpoint autenticado** (operador):
- `POST /appointments/:id/attendance/link` — idempotente: reusa token vivo se cobre o mesmo set; consume + gera novo se set mudou; gera direto se não havia. Resposta: `{ token, signUrl, expiresAt, coveredSessions[], reused }`. Resolve o dia via `scheduledAt` do appointment, em TZ do servidor (pool model).
- `GET /appointments/:id/attendance` — devolve foto+SVG inline (objetos pequenos, sem precisar presigned URL). Usado pelo botão "Ver assinatura" no popover quando `kind=procedure && status=attended`.

**Endpoints públicos** (sem JWT, tenant resolvido via token):
- `GET /public/session-attendance/:token` — preview (primeiro nome + iniciais do sobrenome, clínica, lista de procedimentos do dia).
- `POST /public/session-attendance/:token/verify` — body `{ document, birthDate }`. 3 tentativas; após a terceira, token auto-consumido (proteção brute-force trivial). Resposta: sub-token HMAC determinístico (`HMAC(jwt.secret, "attendance-verify:" + token)`).
- `POST /public/session-attendance/:token/sign` — header `X-Verify-Token`; body com `signatureSvg` + `photoDataUrl` (base64). Transação atômica: cria `attendance_record`, vincula sessions, marca sessions como `signed`, marca appointments como `attended`, consome token, dispara `procedure_session_attendance.recorded` no Redis.

**Janela do token.** 48h. Cobre cliente que demora pra abrir o link (recebeu no fim do dia, só viu de manhã) sem deixar tokens vivos indefinidamente. **Abrir o link sem assinar não consome o token** — cliente pode fechar e reabrir. Token só é consumido em: (i) sign bem-sucedido, (ii) 3 erros de verify, (iii) operador regerar pra escopo diferente.

**Storage.** Bucket dedicado `attendances` (separado de `contracts` e `whatsapp`) pra permitir lifecycle/TTL independente. Foto: WebP recomprimida no cliente via `<canvas>` (lado maior ≤720px, quality 0.75) — backend nunca precisa de Sharp/Jimp. Assinatura: SVG vetorial via `signature_pad`.toSVG()` — escala bem em PDF/impressão futura.

**Cascata clínica preservada.** O fluxo de `sign` cuida do mesmo cascade que `appointment.attend` fazia antes (ensure treatment + linkSessionToTreatment), mas pra cada journey que tem sessão coberta. **Auto-complete de treatment** agora considera `pending`+`signed` como "em andamento" — só dispara quando todas as sessões viraram `done` (evolução concluída). `attend()` continua existindo como override administrativo (mesma cascata mas sem `attendance_record`).

**Permissão.** `procedureSessionAttendances:write` pra `admin/manager/reception` (quem opera o popover da agenda gerando link), `procedureSessionAttendances:read` aberto a todos os roles operacionais (aplicadora precisa ver o atestado pra iniciar evolução).

**Migração.** Enum estendido + 3 tabelas novas + permissions update em junho/2026 (sem backfill — sessions existentes ficam em `pending` e seguem o caminho atual). `markSessionDone` mantido como helper pra fluxos legacy/admin override no [`ProcedureSessionsService`](../apps/core/src/modules/procedureSessions/ProcedureSessionsService.ts); fluxo padrão é `markSessionSigned`.

### 23.1 Evolução clínica (`signed → done`)

**Contexto (2026-06-10).** Fechado o gap remanescente da §23: agora `signed → done` tem fluxo dedicado pela aplicadora encerrar a evolução clínica da sessão. Antes do fluxo, sessões `signed` ficavam presas — treatment nunca completava porque o auto-complete só dispara quando todas as sessões saem de `pending+signed`. Override `markSessionDone` (admin) era a única saída, e pulava o registro de nota clínica.

**Decisão.**
- **Endpoint dedicado** `POST /procedure-sessions/:id/evolve` com `evolutionNotes` obrigatório. Pre-checks específicos por status (pending = "cliente não assinou", done = "já evoluída", cancelled = "sessão cancelada"). Atômico: nota + status `done` + `executedAt`/`By` + cascade `checkAndAutoCompleteTreatment`.
- **Gate de capacidade** ortogonal ao role: actor precisa de `users.canApplyProcedures = true` (mesma flag do AppointmentsService — extraída em [`shared/users/assertProfessionalCapability`](../apps/core/src/shared/users/assertProfessionalCapability.ts) pra reuso). Admin sem essa flag não evolui via fluxo normal — usa override `/done` (restrito a `procedureSessions:delete`).
- **Evento Redis novo** `procedure_session.evolved` com `treatmentCompleted: boolean`. Frontend invalida caches de sessions/treatments/journeys/appointments + toast extra "Tratamento concluído" quando `treatmentCompleted=true`.
- **Página `/evolutions`** no frontend: agenda focada do aplicador (1 coluna, profissional logado pra `professional`; admin/manager escolhem qualquer aplicador via filtro). Mostra a agenda completa do dia — appointments + faixas disponíveis dos schedules + intervalos rotulados entre faixas (gap entre dois turnos). Click em appointment `attended` com session `signed` abre a sheet de evolução. Outros status abrem popover read-only de contexto.
- **Sheet `SessionEvolutionSheet`** reusada na agenda (via `AppointmentDetailPopover` quando `onEvolveSession` é fornecido) e no detalhe do cliente (badge "Aguardando evolução" + ação "Evoluir" na `SessionRow`).

**Justificativa do gate de capacidade hard.** Coerente com `AppointmentsService.assertProfessionalCapability` — quem aplica/avalia é flag do user, não do role. Recepcionista admin não evolui sessão por engano; precisa do override consciente.

**Justificativa da página dedicada.** Aplicadora consome a agenda do dia diferentemente de quem opera a recepção: o foco está em "qual sessão precisa fechar evolução agora?". `/agenda` continua sendo o hub operacional (criar, mover, cancelar appointments); `/evolutions` é a visão de quem aplica. Mesmo `CalendarGrid` reusado nos dois — overhead zero, comportamento focado.

**Intervalos rotulados.** Faixas vazias entre dois `availableRanges` do mesmo profissional viram "Intervalo" (label centralizado sobre o `bg-muted` que o grid já desenha pra fora-de-horário). Gaps no início/fim do dia ficam só com o muted neutro — só interior de turno ganha label, pra não rotular "expediente acabou" como intervalo.

---

## 24. Capacidade da VPS: plano pra 20 tenants (análise 2026-07-02)

**Contexto.** A VPS de produção (HostGator BR, 2 vCPU / 4GB RAM / 100GB NVMe — setup completo em producao-setup-progress.md) foi dimensionada em maio/2026 pra 2 tenants. Desde então entrou o `apps/agent` (agente IA, 3º processo Node — que **não constava** no `ecosystem.config.cjs` até 2026-07-02) e a meta passou a ser aguentar **20 tenants simultâneos (~4 usuários/tenant, ~80 usuários)** sem gargalo.

**Diagnóstico.** O orçamento de RAM atual soma ~3.4GB de limites (Postgres 1G + Redis 256M + Evolution 800M + core 450M + chat 450M + agent ~350M) contra 4GB totais, já contando ~500-600M de SO+Docker+Nginx. Os 80 usuários web em si são triviais pra Node/Postgres — os gargalos reais, em ordem:

1. **Evolution/Baileys é memória elástica por tenant.** Cada instância Baileys conectada consome ~100-200MB na prática (sessão, sync de histórico, crypto por mensagem), e a arquitetura é 1 instância por canal (`tenant-<slug>-<canal>`, §7.8). 20 tenants ≈ 20-30 instâncias ≈ **2-4GB só de Evolution**, contra `mem_limit: 800m`. Estimativa de estouro da config atual: **~6-8 tenants conectados** (OOM-kill em loop do container).
2. **2 vCPU satura antes da RAM em picos** — crypto Baileys por mensagem, sync de histórico no pareamento, decode de mídia base64, pg_dump das 03:00.
3. **Postgres/Redis ficam ok com ajustes menores** — conferir `max_connections=50` contra a soma dos pools (agora 3 apps Node + Evolution); alertar Redis a 80% (BullMQ `noeviction` trava fila quando enche, por design).

**Opções consideradas.**
- **(a) Upgrade da VPS única pra 4 vCPU / 16GB.** Mais simples (1 servidor, 1 deploy). Re-tuning necessário: Evolution `mem_limit: 4g` (~150MB/instância planejada), Postgres `shared_buffers=1GB` + `effective_cache_size=6GB`, Redis `maxmemory 512mb`. Variante 8GB é o mínimo absoluto mas só leva até ~10-12 tenants.
- **(b) Segunda VPS dedicada ao Evolution (2 vCPU / 8GB), mantendo a atual (4GB) pros apps.** Isola o único componente com memória elástica e o mais propenso a crash/leak: OOM do WhatsApp **não derruba o produto** (banco, API, agenda seguem de pé). Custo total geralmente menor que o tier 16GB. É o primeiro passo natural do modular monolith (§1): extrair o que escala diferente.
- **(c) Não fazer nada até doer.** Descartado como plano — mas as mitigações baratas abaixo valem antes de qualquer upgrade.

**Escolha.** Pendente entre (a) e (b) — decisão de custo/benefício do dono quando a contagem de tenants se aproximar do limite. **Pré-requisitos executados/planejados independentes da escolha:**
1. ✅ `elora-agent` adicionado ao `ecosystem.config.cjs` com `max_memory_restart: 350M` (2026-07-02) — era carga fantasma fora do plano de capacidade.
2. ⏳ Monitorar RAM + contagem de instâncias Evolution (UptimeRobot só cobre HTTP; Sentry só exceptions — OOM progressivo passaria invisível). V1 aceitável: cron com `free -m` + `GET /instance/fetchInstances` logando alerta.
3. ⏳ Medir consumo real por instância Baileys (`docker stats elora_evolution` antes/depois de parear um canal) — substitui a estimativa de 100-200MB por número medido e define com precisão em quantos tenants a config atual estoura.

**Justificativa.** O gargalo não é o código do Elora — os 3 apps Node somados usam menos RAM que o Evolution vai usar com 20 tenants. Dimensionar pela peça elástica (Baileys por instância) e isolá-la ou orçá-la explicitamente é o que evita a conversa de capacidade se repetir a cada 6 tenants.

## 25. Storage de assets do core (logo de tenant, decidido 2026-07-15)

**Contexto.** O core precisou de storage próprio pra logo do tenant e futuros anexos de domínio (imagens de orçamento, foto de procedimento antes/depois, docs anexos). MinIO/R2 já rodam pro chat (mídia WhatsApp, §7.9) e pro core (PDF assinado de contratos, foto de atendimento de sessão) com dois buckets dedicados: `contracts` e `attendances`. Faltava definir o padrão pra assets que **não são** de domínio específico — hoje logo de tenant, amanhã attachments polimórficos de qualquer entidade.

**Opções consideradas.**
- **(a) Um bucket novo por caso de uso** — `tenant-logos`, `budget-images`, etc. Alinhado com o que já existe (`contracts`, `attendances`). Governança independente (retention/lifecycle por bucket). Contra: proliferação de buckets, um ensure/init novo por feature.
- **(b) Bucket guarda-chuva com prefixo por domínio** — `elora-media` (ou similar), objectKeys começando com `tenants/`, `budgets/`, etc. 1 lifecycle rule por prefixo cobre casos diferentes; nova feature = novo prefixo, não novo bucket.
- **(c) Reutilizar `contracts` ou `attendances` já existentes** — evita bucket novo mas mistura governança de assets muito diferentes (PDF assinado com retenção legal + logo de UI).

**Escolha.** (b) — bucket `elora-media` (env `MEDIA_BUCKET`) com prefixo por domínio no objectKey. Prefixo inicial: `tenants/{tenantId}/logo.{png|jpg|webp}`.

**Justificativa.** Contracts/attendances existem antes desse padrão e ficam onde estão (retention legal específica). Pra assets "vivos" (logo do tenant, imagens de domínio genérico) um bucket só reduz atrito: nova feature = novo prefixo. `MEDIA_PRESIGNED_TTL_SEC` separado do `CONTRACTS_PRESIGNED_TTL_SEC` deixa TTLs independentes.

**Como funciona.**
- **`shared/storage/TenantLogoStorage.ts`** — fachada `persistLogo(tenantId, buffer, mime)` / `deleteLogoQuiet(objectKey)` / `getPresignedUrl(objectKey)`. Allow-list PNG/JPEG/WebP (SVG omitido — XSS embutido). `ensureMediaBucket()` em `shared/storage/storageClient.ts` cria o bucket idempotentemente na primeira operação.
- **`tenants.logo_url` guarda o objectKey**, não URL — mesma convenção de `whatsapp_contacts.profile_picture_url` (§7.9). Path canônico estável, sobrescreve na atualização.
- **Endpoints (super-admin, `requirePlatformAccess`):**
  - `POST /tenants/:id/logo` — multipart (`file`), multer memoryStorage 5MB. Devolve `{ objectKey, size, mimeType }` e persiste em `tenants.logo_url`.
  - `DELETE /tenants/:id/logo` — apaga objeto (best-effort, `deleteLogoQuiet`) + zera `logo_url`.
  - `GET /tenants/:id/logo-url` — devolve `{ url, expiresInSec }` com presigned URL. Null se tenant sem logo.
- **Fluxo do frontend** — `TenantFormSheet` (edit mode apenas) mostra `LogoUploader` inline: preview via `useTenantLogoUrl`, upload/delete direto pelas mutations `useUploadTenantLogo`/`useDeleteTenantLogo`. Bloco é **out-of-band do form** (não participa de `isDirty`/submit) — upload persiste na hora. Create mode mostra aviso "faça upload após criar o tenant".

**Roadmap: attachments polimórficos.** Quando surgir o primeiro caso "N imagens por entidade" (imagem de orçamento, foto de procedimento com histórico), extrair `ObjectStorage` genérico do `TenantLogoStorage` + criar tabela `attachments` polimórfica (`entity_type`, `entity_id`, `object_key`, `mime_type`, `size`, `tenant_id` + RLS/FORCE RLS). Logo de tenant fica como caso especial (path estável, single-file, sem histórico) — **não migra pra `attachments`**.

## 26. Login por username (decidido 2026-07-21)

**Contexto.** Até 2026-07-21 o login era `{email, password}` — `users.email` era `NOT NULL` + `UNIQUE(tenant_id, email)` e o JWT carregava `email` no payload. Recovery de senha não estava implementado e o email na prática era um identificador de login: seed cria endereços fictícios (`admin@{slug}.test`, `agent@system.elora.test`) e o super-admin criando um tenant recebe um placeholder que ninguém abre. Isso obrigava o dono da clínica a inventar um endereço só pra logar; o valor operacional de exigir formato de e-mail era zero. Para o system agent (`isSystemAgent=true`), que autentica HTTP no core via JWT mas não loga via `/auth/login`, o `NOT NULL` obrigava criar um endereço-fantasma por tenant.

**Opções consideradas.**
- **(a) Manter email como credencial + adicionar recovery** — resolve o problema real (recovery), mas mantém a fricção de "inventar endereço" enquanto o tenant não tem contato de e-mail confirmado.
- **(b) Adicionar `username` opcional que substitui email no login quando presente** — flexibilidade máxima, mas dois caminhos de login (email e username) dobram superfície de auth e criam ambiguidade em enumeração de contas.
- **(c) Troca dura: `username` NOT NULL como credencial única; `email` vira opcional (contato/recovery futuro)** — separa responsabilidades: username é identidade de login, email é canal de contato quando existir.

**Escolha.** (c). Coluna nova `username varchar(255) NOT NULL` com `UNIQUE(tenant_id, username)`; `email` fica nullable sem unique. JWT passa a carregar `{ userId, tenantId, username }`. Backfill: `username = local-part(email)` com sufixo numérico (`_2`, `_3`, ...) em caso de colisão dentro do mesmo tenant, ordenado por `created_at, id` (mais antigo fica sem sufixo).

**Justificativa.** Separa "quem é você" (username, obrigatório) de "onde te encontro" (email, opcional). Deixa de exigir e-mail antes de existir fluxo que dependa dele — quando recovery de senha entrar, o admin adiciona o e-mail no cadastro e o fluxo passa a existir naturalmente. Troca dura em vez de coexistência elimina rota alternativa de login e simplifica a superfície de auth. Migration 0042 é idempotente na coluna nova, com backfill entre `ADD COLUMN (nullable)` e `SET NOT NULL`.

**Impacto operacional.**
- `AuthService.login` chama `UsersQuery.findByUsername`; `findByEmail` foi removido (login era o único caller).
- Seed: super-admin da plataforma tem `username='admin'` + `email='admin@elora.app.br'` (o único e-mail real); admins de tenants demo têm `username='admin'` + `email=null`; system agent user tem `username='system_agent'` + `email=null` (invariante "1 por tenant" mantida).
- Provisioning de tenant novo (`TenantsService.create`) cria admin com `username='admin'` + `email=null` — dono da clínica escolhe o próprio identificador de login ao ativar via UI.
- Frontend: campo do form de login troca de `type="email"` pra `type="text"` com `autoComplete="username"`; UserFormSheet ganha campo `Usuário` obrigatório no topo e mantém `E-mail (opcional)` como contato.

## 27. Link de pagamento: conta Asaas própria de cada clínica (decidido 2026-11-11)

**Contexto.** A venda (`sales`) e as parcelas (`payments`) existem, mas a baixa é sempre manual (`POST /sales/:id/payments/:paymentId/mark-paid`). O objetivo é que a operadora gere um link de pagamento para a parcela, envie pelo chat e o Elora dê baixa sozinho quando o cliente pagar. Como o Elora é multi-tenant, a pergunta central não era o provedor, e sim **de quem é a conta que recebe o dinheiro**. Regras e requisitos em [payment-links-domain.md](./payment-links-domain.md).

**Opções consideradas.**
- **(A) Cada clínica conecta a própria conta do provedor** (API key por tenant). O dinheiro cai direto na clínica e o Elora é só software. Contra: o Elora não ganha percentual por transação, e cada clínica precisa abrir conta no provedor.
- **(B) Elora como plataforma, com conta-mãe + subcontas/split.** Permite cobrar percentual por transação e dá um onboarding mais "dentro do produto". Contra: o Elora passa a responder pelo KYC das clínicas, por disputas e pelo suporte financeiro, com implicações regulatórias e muito mais complexidade.
- **Provedores avaliados:**
  - **Asaas:** cobrança de serviços, Pix + boleto + cartão no mesmo link, API simples, sandbox, subcontas se um dia for B.
  - **Mercado Pago:** marca conhecida pelo paciente e OAuth, mas API mais extensa.
  - **Pagar.me, PagBank, Efí:** sólidos. A Pagar.me é forte em split e a Efí em Pix.
  - **Stripe:** a melhor API, mas menos comum em clínica pequena no Brasil e menos competitivo em boleto.
  - **Pix direto pelo banco:** a menor taxa, mas exige certificado e configuração por banco e só cobre Pix.

**Escolha.** (A) com **Asaas**. Uma cobrança Asaas por parcela, com `billingType=UNDEFINED` (o cliente escolhe o meio) e `externalReference = payments.id`. A baixa vem pelo webhook, e uma conciliação periódica cobre os webhooks perdidos. O provedor fica atrás da interface `IPaymentProvider` em `shared/providers/payment/` (mesmo padrão de `ISignatureProvider`/ZapSign), com `MockPaymentProvider` em dev.

**Justificativa.** A clínica é dona do dinheiro e da relação com o provedor, e o Elora fica fora do papel de intermediador financeiro. O recurso entra como valor do software, não como fonte de receita por transação. O Asaas cobre os três meios de pagamento que a clínica usa num único link e tem sandbox para validar sem dinheiro real. O adapter mantém aberta a troca de provedor ou a migração para (B) sem refazer o domínio.

**Impacto.**
- **Credencial por tenant, criptografada** (AES-256-GCM, chave mestra em env). É diferente da ZapSign (conta única via env) e do `apiKey` do Evolution em texto puro: a chave do Asaas movimenta dinheiro.
- **Webhook público por integração**, com tenant resolvido por função SECURITY DEFINER (padrão 0005/0028) e token próprio no header. O Elora cadastra o webhook no Asaas via API ao conectar.
- **A baixa automática reaproveita a mesma regra do `mark-paid` manual**, para que haja uma única fonte de recálculo da venda.
- O CPF do cliente (`clients.document`) passa a ser exigido para gerar link, porque o Asaas exige `cpfCnpj` no customer.
