# Contracts Domain — assinatura digital de documentos

Estado vivo do módulo de contratos digitais. Atualizar quando uma fase fechar ou quando uma decisão arquitetural relevante mudar.

---

## 1. Escopo

Termos de consentimento, contratos de pacote e cessão de imagem assinados eletronicamente pelo cliente via WhatsApp. Casos de uso:

- **Pré-procedimento**: termo de consentimento (depilação a laser, fototipo, contraindicações) que tem que sair assinado antes da 1ª sessão.
- **Pós-venda**: contrato de pacote (sessões + preço + política de remarcação) assinado no fechamento da venda.
- **Cessão de imagem**: opcional — autorização pra usar foto antes/depois em marketing.

O documento + marcação de variáveis vive no painel da ZapSign. Aqui guardamos só o apontamento (template ID externo + lista de variáveis esperadas) e o ciclo de cada documento enviado.

---

## 2. Provider

**ZapSign** (BR) via API REST. Conta única da Elora servindo todos os tenants — não há configuração de provider por tenant (diferente de WhatsApp). Token rotacionado no painel deles → Integrações → API ZapSign.

Ambiente é decidido pelo subdomínio em `ZAPSIGN_API_BASE_URL`:
- `https://api.zapsign.com.br/api/v1` → produção (requer Plano de API ZapSign — pago)
- `https://sandbox.api.zapsign.com.br/api/v1` → sandbox (gratuito, sem validade jurídica)

**Templates cadastrados em uma conta NÃO existem na outra.** Pra testar em dev, criar template no sandbox e cadastrar o ID separadamente.

### Adapter

Interface canônica `ISignatureProvider` em [apps/core/src/shared/providers/signature/ISignatureProvider.ts](../apps/core/src/shared/providers/signature/ISignatureProvider.ts). Adapter concreto `ZapSignAdapter`. Resto do app conhece SÓ a interface — trocar provider = trocar implementação no factory. Operações:

- `createDocumentFromTemplate({ externalTemplateId, signer, variables, expiresAt, ... })` → `DocumentRef { externalDocumentId, externalOpenId, signUrl }`. Cria doc no provider, sem disparar email/WhatsApp do lado deles (`disable_signer_emails: true`, `send_automatic_email: false`, `send_automatic_whatsapp: false`). O link sai pelo WhatsApp da clínica (Fase 3.5). `expiresAt` é um `Date` único calculado pelo service — antes era duplicado (service em ms local + adapter via `addDays` UTC) e podia divergir 1 dia perto da meia-noite.
- `getDocument(externalDocumentId)` → `DocumentStatus`. Usado pra reconciliação se webhook falhar.
- `cancelDocument(externalDocumentId)` → void. ZapSign rejeita se já estiver signed.
- `downloadSignedPdf(externalDocumentId)` → Buffer. Throws 409 se ainda não tá signed.
- `verifyWebhook(req)` → boolean. ZapSign não tem HMAC nativo — usamos header custom `X-Elora-Webhook-Token` (gerado por nós, cadastrado no painel deles).
- `normalizeWebhook(rawPayload)` → `NormalizedSignatureEvent`. Mapeia `event_type` deles pros canônicos `document.signed | document.viewed | document.declined | document.expired | unknown`.

### Armadilhas conhecidas do `createDocumentFromTemplate`

- **Substituição de variáveis é string-replace LITERAL no DOCX.** `{{clientName}}` ≠ `{{ clientName }}` (com espaço). O Word frequentemente insere espaços ao redor da variável (autocorrect, paste-as-formatted). O adapter envia DUAS variações por variável em `data: [{de, para}]` — `{{name}}` e `{{ name }}` — pra cobrir os dois casos comuns sem exigir que o admin "limpe" o Word. A não-correspondente vira no-op silencioso.
- **Template tipo DOCX vs Form**. Marcação "DOCX" no painel ZapSign não garante substituição: o admin pode uploadar um DOCX e adicionar campos editáveis no editor visual em cima. Nesse caso, `data` enviado vira `answers[]` (pré-preenchimento dos campos editáveis), mas o PDF base não muda. Sintoma: `answers` no response vem populado com os valores corretos, mas o `signed_file` final continua com layout original. Solução: editar o DOCX no Word com `{{x}}` literal no texto e re-uploadar.
- **`extractVariablesFromZapsignModel`** strip `{{}}` e trim espaços ao ler o template (`getTemplate`) — então o nome armazenado em `contract_templates.variables` é sempre canônico. Re-empacotamento com braces e variações de espaço acontece só no momento do envio.

---

## 3. Schema

Migration `0026_nebulous_paladin.sql` (tabelas base) + `0032_overconfident_mockingbird.sql` (Fase 7: tabela `consent_template_procedures`, coluna `contracts.sale_id` e índices). Todas as tabelas de domínio com RLS+FORCE.

### `contract_templates`

Apontamento pra template no painel ZapSign + lista de variáveis declaradas.

```
id              uuid PK
tenant_id       uuid FK tenants (cascade)
name            varchar(255)         # nome amigável
kind            contract_kind        # consent_term | service_contract | image_release | other
zapsign_template_id varchar(64)      # ID externo no painel ZapSign
variables       jsonb (string[])     # ['clientName', 'procedure', ...]
active          boolean
created_at, updated_at
UNIQUE (tenant_id, name)
```

### `contracts`

Cada documento enviado pra assinatura.

```
id              uuid PK
tenant_id       uuid FK tenants (cascade)
client_id       uuid FK clients (restrict)
journey_id      uuid FK journeys (set null)  # opcional — vincula à jornada ativa
sale_id         uuid FK sales (cascade)      # nullable — Fase 7; avulsos pré-Fase 7 ficam NULL
template_id     uuid FK contract_templates (restrict)  # nullable (upload avulso futuro)
variables       jsonb ({name,value}[])  # snapshot dos valores enviados
kind            contract_kind
title           varchar(255)
status          contract_status      # draft | sent | viewed | signed | declined | expired | cancelled
                                     # `draft` está reservado pra fluxo futuro (salvar rascunho antes
                                     # de enviar) — hoje `create` sempre seta `sent` direto
zapsign_document_id varchar(64)      # = token na API ZapSign
zapsign_open_id varchar(64)
sign_url        varchar(1024)
signed_pdf_object_key varchar(1024)  # path no R2/MinIO; null antes do webhook signed
sent_at, viewed_at, signed_at, declined_at, expires_at  timestamps
failure_reason  text
created_by_user_id uuid FK users (set null)
idempotency_key varchar(64)          # UUID gerado pelo frontend ao abrir o sheet (§12)
metadata        jsonb                # snapshot do evento do webhook + extras
created_at, updated_at

UNIQUE PARTIAL (zapsign_document_id) WHERE zapsign_document_id IS NOT NULL
UNIQUE PARTIAL (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
UNIQUE PARTIAL (sale_id) WHERE kind='service_contract' AND status<>'cancelled' AND sale_id IS NOT NULL
UNIQUE PARTIAL (sale_id, template_id) WHERE kind='consent_term' AND status<>'cancelled' AND sale_id IS NOT NULL
INDEX (tenant_id), (client_id), (journey_id), (sale_id), (tenant_id, status)
```

O UNIQUE em `zapsign_document_id` garante idempotência do webhook (e do `findByZapsignDocumentId`). O UNIQUE em `(tenant_id, idempotency_key)` resolve race de duplo-submit no envio (§12). Os dois UNIQUE parciais de `sale_id` impõem as regras de negócio da Fase 7 no banco (1 contrato de serviço ativo por venda; 1 termo de consentimento ativo por (venda, template) — ver §13).

### `consent_template_procedures` (Fase 7)

Vínculo N:M entre templates de termo de consentimento e procedimentos — define quais procedimentos exigem qual termo. Dependência aponta do domínio de contratos PRA o catálogo (`procedures` não conhece contratos).

```
tenant_id       uuid              # denormalizado (sem FK — pattern de sale_items); RLS+FORCE
template_id     uuid FK contract_templates (cascade)
procedure_id    uuid FK procedures (cascade)
created_at      timestamp
PK (template_id, procedure_id)    # par único; link idempotente via onConflictDoNothing
INDEX (procedure_id), (tenant_id)
```

`ContractTemplatesService.linkProcedure` valida `template.kind='consent_term'` no app (409 caso contrário). Linha imutável (vincula/desvincula, não edita — sem `updated_at`).

---

## 4. Fluxo end-to-end

```
┌─ Operadora ─┐                              ┌─ ZapSign ─┐    ┌─ Cliente ─┐
│             │                              │           │    │           │
│ POST /contracts ───createDocument──────────►│           │    │           │
│             │◄──signUrl + zapsign_doc_id───│           │    │           │
│ "Copiar link" │                            │           │    │           │
│      │       │                             │           │    │           │
│      └─via WhatsApp manual──────────────────────────────────►│           │
│                                            │           │    │  assina    │
│                                            │◄──────────┤    │ no browser │
│                                            │           │    │           │
│                                            │── webhook ►│   │           │
│                                            │  doc_signed│    │           │
└─────────────────────────────────────────────┘            │    └───────────┘
                                              │
                                              ▼
POST /webhooks/zapsign (público)
  → verifyWebhook (header X-Elora-Webhook-Token)
  → normalizeWebhook → kind: 'document.signed'
  → resolveTenantByZapsignDocumentId (SECURITY DEFINER)
  → ContractsService.handleSignatureEvent:
      - download PDF (event.signedPdfUrl OU provider.downloadSignedPdf fallback)
      - ContractStorage.persistSignedPdf → R2/MinIO
      - UPDATE contracts SET status='signed', signed_at, signed_pdf_object_key
```

---

## 5. Webhook do ZapSign

### Endpoint

`POST /webhooks/zapsign` — **público** (não passa pelo `tenantContextMiddleware`). Em prod: `https://api.elora.app.br/webhooks/zapsign`. Cadastrar essa URL no painel ZapSign → Webhooks com header `X-Elora-Webhook-Token: <ZAPSIGN_WEBHOOK_TOKEN>`.

### Resolução de tenant

ZapSign não conhece subdomínio nem tenant. Identificamos o contrato via `token` do payload (= `zapsign_document_id` no nosso DB), mas pra abrir `withTenant()` precisamos descobrir o tenant. Tabela `contracts` tem RLS+FORCE, role `elora_app` é NOBYPASSRLS — SELECT direto retorna vazio sem `app.current_tenant` setado.

**Solução: SECURITY DEFINER function**. Migration `0028_resolve_contract_tenant.sql`:

```sql
CREATE OR REPLACE FUNCTION resolve_contract_tenant(p_zapsign_document_id varchar)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM contracts
  WHERE zapsign_document_id = p_zapsign_document_id;
  RETURN v_tenant_id;
END;
$$;
REVOKE EXECUTE FROM PUBLIC;
GRANT EXECUTE TO elora_app;
```

Mesmo padrão do webhook do WhatsApp (`0005_resolve_channel_tenant.sql`).

### Política de status code

- **200 + `{status:'processed'}`** — caminho feliz.
- **200 + `{status:'ignored', reason:'no_document_id'|'unknown_document'}`** — eventos sem token ou contrato órfão (apagado, instância de teste). Acknowledge pra parar retries do provider.
- **401** — assinatura/token inválida.
- **500** — erro interno (provider retenta).

### Idempotência

Implementada em `ContractsService.handleSignatureEvent`:

- Eventos sem token → drop limpo (200 ignored).
- Token sem contrato no DB → drop limpo (200 ignored).
- Contrato em estado terminal (`signed`/`declined`/`cancelled`/`expired`) → skip silencioso. ZapSign pode reenviar webhook na retentativa.
- Eventos `unknown` → log debug, sem update.

### Persistência do PDF

Quando o evento é `document.signed`:

1. **Tenta** baixar PDF do `signedPdfUrl` do evento (vem direto no payload do ZapSign).
2. **Fallback**: se falhar ou URL ausente, chama `provider.downloadSignedPdf` (consulta API ZapSign).
3. **Persiste** em `ContractStorage` (objectKey = `{tenantId}/{yyyy}/{mm}/{contractId}.pdf`).
4. **UPDATE** com `status='signed'`, `signed_at`, `signed_pdf_object_key`.

Se download ou persistência falharem, **o UPDATE de status ainda acontece** — o fallback de `downloadSignedPdf` no GET cai pro ZapSign on-demand. Idempotência por `(tenantId, contractId)` no objectKey — re-up sobrescreve sem erro.

---

## 6. Storage

S3-compatível, mesma lib (`minio`) que o chat usa. Em dev: MinIO opt-in via `docker-compose profile storage-local`. Em prod: Cloudflare R2.

Config em [apps/core/src/env.ts](../apps/core/src/env.ts) bloco `storage`. **Opt-in**: quando `MINIO_ACCESS_KEY`/`SECRET_KEY` ausentes, `ContractStorage.isConfigured = false` e callers degradam graciosamente:

- `persistSignedPdf` retorna null sem lançar.
- `downloadSignedPdf` no GET serve do ZapSign on-demand (mesmo caminho que existia pré-Fase 4).

Bucket separado da mídia WhatsApp: `CONTRACTS_BUCKET` (default `contracts`). Governança independente (retenção legal de PDFs de contratos costuma ser maior que de mídia de chat).

**Layout de paths**: `{tenantId}/{yyyy}/{mm}/{contractId}.pdf`. Tenant namespace na raiz garante que listagem de bucket nunca cruza tenants. Particionamento por mês simplifica lifecycle rules.

---

## 7. Permissões

Registradas em [apps/core/src/shared/permissions/permissions.ts](../apps/core/src/shared/permissions/permissions.ts):

- `contractTemplates:read|write|delete` — gerência de templates (admin/manager).
- `contracts:read|write` — operadora pode enviar/cancelar contratos.

---

## 8. UI

Páginas em `apps/frontend/src/pages/contracts/`:

| Componente | Rota | Função |
|---|---|---|
| `ContractsPage` | `/contracts` | Lista do tenant com filtros (pendentes/assinados/todos), copiar link, cancelar, baixar PDF |
| `ContractTemplatesPage` | `/settings/contract-templates` | CRUD de templates |
| `ContractTemplateSheet` | (sheet) | Form de cadastro/edição de template |
| `ContractSendSheet` | (sheet) | Form de envio: escolhe template, preenche variáveis dinâmicas, mostra signUrl no sucesso. Painel de sucesso + `ContractRow` têm "Abrir conversa no chat" (`useOpenClientChat` → resolve/cria a conversa do cliente e abre o `FloatingChatWindow` via `chatBridge`, **com a mensagem do link já pré-preenchida no composer** — draft via `chatStore.pendingDraft`, consumido uma vez pelo `MessageComposer`; operador só revisa e envia) + copiar/abrir link. **Não** é a Fase 3.5 (que dispara automático pelo canal e entra no histórico — segue pendente). Props `saleId`/`kindFilter` (Fase 7) vinculam à venda e restringem o select ao kind pedido |
| `ContractRow` | (subcomponente) | Linha de contrato reutilizada (badge de status + título + ações copiar-link/cancelar/baixar). Extraída na Fase 7 (usada por `ClientContractsSection` + `SaleContractsSection`) |
| `ClientContractsSection` | (subcomponente) | Plugada em `ClientDetailPage`. **View-only desde a Fase 7** — lista o histórico do cliente, sem criar (criação migrou pra venda) |
| `SaleContractsSection` | (subcomponente) | Plugada em `SaleDetailPage` (Fase 7). Contrato de serviço (CTA único) + termos de consentimento ("Gerar termos pendentes") |

Pontos de entrada do envio:
- `/sales/:id` (SaleDetailPage → SaleContractsSection): **ponto único de criação** desde a Fase 7 — todo contrato nasce com `saleId` (rastro comercial). `journeyId` vem da venda automaticamente.
- `/clients/:id` (ClientDetailPage → ClientContractsSection): só leitura do histórico do cliente — ações sobre contratos existentes (copiar/cancelar/baixar) continuam.

Na `/settings/contract-templates` (ContractTemplatesPage), templates `consent_term` ganham um addon de linha (`renderRowAddon`) com os procedimentos vinculados + Combobox "Adicionar procedimento" (Fase 7).

Cadastro de template (ContractTemplateSheet) busca a lista de modelos via Combobox direto do painel ZapSign (`GET /contract-templates/zapsign/templates`). Ao selecionar:
1. ID externo é preenchido.
2. Variáveis declaradas no template são puxadas automaticamente via `inspectZapsignTemplate`.
3. Cada variável ganha badge **`auto`** se está no catálogo conhecido (§11).

Quando ZapSign não está provisionado, cai num fallback de input texto + botão "Buscar variáveis" manual. Link "Abrir painel ZapSign" sempre disponível.

Menus seed em [packages/db/seed.ts](../packages/db/seed.ts): "Contratos" no menu raiz (position 9, ícone `file-signature`), "Templates de contrato" em Configurações (position 8).

---

## 9. Fases de implementação

| Fase | Estado | Conteúdo |
|---|---|---|
| 1. Schema + migration | ✅ | `0026_nebulous_paladin.sql` — `contract_templates`, `contracts`, enums, RLS+FORCE |
| 2. Adapter ZapSign + factory | ✅ | `ISignatureProvider`, `ZapSignAdapter`, opt-in via env |
| 3. CRUD backend + UI | ✅ | Templates + contracts (find, create, cancel, copyLink, downloadSignedPdf). Inclui Combobox de seleção de template ZapSign no cadastro, autofetch de variáveis via `getTemplate`, resolver de variáveis "conhecidas" pré-preenchendo o envio (§11), botão "Gerar contrato" em `/sales/:id`, banner de aviso pra campos faltantes/inválidos do cadastro, e idempotência client-side (§12) |
| 3.5 Auto-disparo via WhatsApp | ⏳ | `copyLink` e `create` deveriam enfileirar mensagem WhatsApp via OutboundDeliveryWorker em vez de devolver signUrl pra operadora copiar manualmente. Hoje `ContractsService.copyLink` só lê o contrato e devolve a signUrl. Quando essa fase entrar, voltar a renomear pra `resend` faz sentido |
| 4. Webhook + persistência PDF | ✅ | `POST /webhooks/zapsign`, `handleSignatureEvent`, `ContractStorage`, migration `0028_resolve_contract_tenant.sql` |
| 5. Realtime `contract.status_changed` | ✅ | Canal canônico `contract.status_changed` em `@elora/events-contracts` (payload com snapshot de `clientName`+`contractTitle` pra UI montar toast sem fetch extra). `ContractsService.handleSignatureEvent` publica pós-commit nas 4 transições (viewed/signed/declined/expired). `redisSubscriber` reemite na sala `tenant:${id}`. Frontend (`useChatRealtime`) invalida `['contracts']` em todas as transições; toast só em `signed`/`declined` (viewed flooda; expired silencioso) — respeita `chatNotificationLevel: quiet`. Sem sala por contrato específico — granularidade no nível do tenant cobre todas as telas (ContractsPage + ClientContractsSection compartilham `CONTRACTS_QUERY_KEY`) |
| 6. Reconciler periódico | ⏳ | `setInterval` 5min varrendo `status IN ('sent','viewed')` com `sent_at < now() - 1d` → `provider.getDocument` pra cobrir webhook perdido. Padrão do `OutboundDeliveryWorker` |
| 7. Contratos × Vendas | ✅ | `0032` — tabela `consent_template_procedures`, `contracts.sale_id` + 2 uniques parciais, bulk `generateConsentTermsForSale`, CRUD de vínculo template×procedimento, `SaleContractsSection`, `ClientContractsSection` view-only, subtabela em Settings. Detalhe em §13 |

---

## 10. Como testar end-to-end (sandbox)

1. Criar conta sandbox em `sandbox.app.zapsign.com.br`.
2. Cadastrar template lá com algumas variáveis (`{{clientName}}`, `{{procedure}}`).
3. `.env` local:
   ```
   ZAPSIGN_API_BASE_URL=https://sandbox.api.zapsign.com.br/api/v1
   ZAPSIGN_API_TOKEN=<token sandbox>
   ZAPSIGN_WEBHOOK_TOKEN=$(openssl rand -hex 32)
   ```
4. (Opcional, pra Fase 4) Subir MinIO: `docker compose --profile storage-local up minio -d` e configurar `MINIO_*` no `.env`.
5. Expor backend via ngrok: `ngrok http 5501`. Cadastrar webhook em sandbox.app.zapsign.com.br → Webhooks: URL = `https://<ngrok>.ngrok.io/webhooks/zapsign`, header `X-Elora-Webhook-Token: <ZAPSIGN_WEBHOOK_TOKEN>`.
6. UI: cadastrar template em `/settings/contract-templates` (cole o ID do sandbox), enviar contrato pra um cliente pelo `ClientContractsSection`.
7. Abrir signUrl no browser, assinar.
8. Conferir: webhook chega no backend → status do contrato vira `signed` → `signed_pdf_object_key` preenchido → GET `/contracts/:id/signed-pdf` baixa do MinIO.

---

## 11. Catálogo de variáveis "conhecidas"

Convenção de nomenclatura (Opção A): o template no painel ZapSign declara variáveis com **estes nomes específicos** (camelCase, regra 1 do CLAUDE.md), e o backend resolve automaticamente a partir de `clients` + `tenants` no momento do envio. Operador não digita — os inputs no `ContractSendSheet` aparecem pré-preenchidos. Implementação em [apps/core/src/modules/contracts/variableResolvers.ts](../apps/core/src/modules/contracts/variableResolvers.ts).

Prefixo `client*` pra dados do cliente, `tenant*` pra dados da clínica (bate com a tabela `tenants` — "clínica" é o vertical de produto, tenant é a infra).

Variáveis que **não** estão neste catálogo continuam como input manual (ex: `procedure`, `sessionCount`, `saleTotal` — coisas específicas de cada envio).

### Cliente

| Chave (`{{...}}` no template) | Coluna de origem | Formato |
|---|---|---|
| `clientName` | `clients.name` | — |
| `clientDocument` | `clients.document` | `000.000.000-00` |
| `clientDocumentRaw` | `clients.document` | dígitos |
| `clientEmail` | `clients.email` | — |
| `clientPhone` | `clients.phone_e164` | `+55 (11) 98765-4321` |
| `clientPhoneRaw` | `clients.phone_e164` | E.164 cru |
| `clientBirthDate` | `clients.birth_date` | `dd/mm/aaaa` |
| `clientAddress` | `clients.address` (jsonb) | concatenado em uma linha |
| `clientAddressZip` | `clients.address.zip_code` | `00000-000` |
| `clientAddressStreet` | `clients.address.street` | — |
| `clientAddressNumber` | `clients.address.number` | — |
| `clientAddressComplement` | `clients.address.complement` | — |
| `clientAddressNeighborhood` | `clients.address.neighborhood` | — |
| `clientAddressCity` | `clients.address.city` | — |
| `clientAddressState` | `clients.address.state` | — |
| `clientAddressCountry` | `clients.address.country` | — |

### Clínica (tenant)

| Chave | Coluna de origem | Formato |
|---|---|---|
| `tenantName` | `tenants.name` | nome curto / sidebar |
| `tenantLegalName` | `tenants.legal_name` | razão social |
| `tenantTradeName` | `tenants.trade_name` | nome fantasia |
| `tenantDocument` | `tenants.document` | `00.000.000/0000-00` |
| `tenantDocumentRaw` | `tenants.document` | dígitos |
| `tenantRepresentativeName` | `tenants.representative_name` | — |

### Tempo

| Chave | Resolve para | Formato |
|---|---|---|
| `today` | data atual | `dd/mm/aaaa` |
| `todayLong` | data atual | `dd de mês de aaaa` |

### Comportamento

- Campo de origem vazio → resolver devolve string vazia (nunca `undefined` no template renderizado).
- ContractTemplateSheet marca cada variável conhecida com badge **`auto`** (verde).
- ContractSendSheet pré-preenche e permite override manual antes de enviar.
- Endpoints:
  - `GET /contracts/variables/catalog` → `string[]` — lista de chaves (estático).
  - `GET /contracts/variables/resolve?clientId=X` → `{ resolved, knownKeys, missing }` — valores resolvidos + lista de campos faltantes.

### Detecção de campos faltantes (preflight)

A resposta do `resolve` inclui `missing[]` — campos do catálogo que ficaram vazios (ou com formato inválido — ex: CPF com menos de 11 dígitos) pra esse cliente/clínica, agrupados por **label PT-BR** (deduplicado: `clientDocument` + `clientDocumentRaw` viram só "CPF do cliente") e marcados com `reason: 'empty' | 'invalid'`. Source `system` (datas geradas) nunca entra em `missing`.

```json
{
  "resolved": { "clientName": "Maria Silva", "clientDocument": "", ... },
  "knownKeys": ["clientName", "clientDocument", ...],
  "missing": [
    { "keys": ["clientDocument", "clientDocumentRaw"], "source": "client", "label": "CPF do cliente", "reason": "empty" },
    { "keys": ["tenantLegalName"], "source": "tenant", "label": "Razão social da clínica", "reason": "empty" }
  ]
}
```

No `ContractSendSheet`, ao escolher template, fazemos a interseção entre `missing[].keys` e as variáveis declaradas no template — só mostra banner pros campos que **realmente impactam** esse contrato. Comportamento: **avisa, não bloqueia** — operador pode enviar mesmo assim (campo sai em branco) ou fechar o sheet, completar o cadastro e voltar.

Além do banner de missing, o sheet expõe outros dois sinais visuais pra evitar UI silenciosa:

- **Template sem variáveis declaradas** (`template.variables = []`) → banner info com orientação pra editar o template e usar "Buscar variáveis".
- **Template com variáveis, nenhuma bate com o catálogo** → banner warning sugerindo renomear no painel ZapSign pra ganhar pre-fill automático (`client*`, `tenant*`, `today`).
- **Resumo "N preenchidas pelo cadastro, M manuais"** logo abaixo do header da seção de variáveis. Sem isso, template com vars não-canônicas (ex: `nome_completo` em vez de `clientName`) gerava UI silenciosa — inputs vazios, banner vazio, operador achava bugado.

Log focado no backend quando há campos faltantes:
```
INFO contracts.resolveVariables.missing
  missingLabels: ['client:CPF do cliente', 'tenant:Razão social da clínica']
  missingKeys: ['clientDocument', 'clientDocumentRaw', 'tenantLegalName']
```

Caminho feliz (nada faltando) não loga — reduz ruído.

### Adicionar nova chave conhecida

1. Acrescentar entrada em [variableResolvers.ts](../apps/core/src/modules/contracts/variableResolvers.ts) → `CATALOG`.
2. Pra chaves com formatter (CPF/CNPJ/CEP/data), declarar `rawValue: (ctx) => string | null` no entry — permite que `reason: 'invalid'` apareça quando o cadastro tem valor mas o formato falha.
3. Atualizar a tabela acima no mesmo PR.
4. Não há migration nem mexer em templates já cadastrados — chaves não-mapeadas continuam como input manual.

---

## 12. Idempotência da criação

Protege contra criação duplicada de contrato (= 2 documentos cobrando quota da ZapSign + 2 rows no banco) em três cenários: duplo-clique no botão "Enviar", retry de rede do client, e duas abas/dispositivos enviando simultaneamente.

### Camadas

1. **Client gera UUID** (`crypto.randomUUID()`) ao abrir o `ContractSendSheet`. Mesmo valor é reenviado em retries do mesmo submit. Re-abrir o sheet pro mesmo cliente gera UUID novo — comportamento desejado (operadora pode enviar 2 contratos legítimos).
2. **Backend pre-flight**: `ContractsService.create` faz `findByIdempotencyKey` ANTES de chamar o provider. Se já existe, devolve o existente sem chamar a ZapSign de novo.
3. **DB unique parcial** `(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL` — pega race residual entre 2 POSTs simultâneos. Service captura `23505` filtrando pelo constraint name (`contracts_tenant_idempotency_unique`), re-busca pela chave e devolve o vencedor.

### Trade-off conhecido

Race entre 2 POSTs simultâneos (mesmo `idempotencyKey`): ambos passam pelo pre-flight (timing), ambos chamam o provider, mas só um INSERT vence. O documento criado pelo perdedor fica **órfão na ZapSign** — sem `contract` no banco apontando pra ele. Logado como `contracts.create.idempotent_race_resolved` com o `orphanedZapsignDocumentId` pra eventual auditoria. Caso comum (double-click) é eliminado pelo pre-flight.

### Replay sem race

Quando o cliente reenvia exatamente o mesmo POST (retry de rede após timeout, por exemplo), o pre-flight encontra o contract já criado e devolve sem custo extra. Logado como `contracts.create.idempotent_replay`.

### Não-vetor

Não há idempotência por `(client_id, template_id)` propositalmente — operadora pode legitimamente criar 2 contratos do mesmo tipo pro mesmo cliente em jornadas diferentes (renovação, segunda compra).

---

## 13. Contratos × Vendas (Fase 7)

Amarração de contratos a vendas. Toda criação de contrato passou a nascer da venda (rastro comercial), e procedimentos podem exigir termos de consentimento que são gerados em lote.

### Regras de negócio

1. Cada venda tem no máximo **1 contrato de serviço** ativo (unique parcial `contracts_sale_service_active_unique`).
2. Cada procedimento vendido pode ter **1 termo de consentimento** (via vínculo template×procedimento).
3. Se 2 procedimentos da mesma venda compartilham o **mesmo template**, só **1 termo** é criado — dedup por template (unique parcial `contracts_sale_consent_template_active_unique` + `selectDistinct` no `listTemplatesForProcedures`).
4. UI mostra contratos por venda (`SaleContractsSection`).
5. Cancelar (`status='cancelled'`) libera criar outro pra mesma posição — os uniques são parciais (`status<>'cancelled'`).
6. Settings/contract-templates: templates `consent_term` exibem subtabela com procedimentos vinculados + Combobox de adicionar.

### Decisões fechadas

| Decisão | Por quê |
|---|---|
| `ClientContractsSection` vira **view-only** | Criação centralizada na venda evita contratos sem rastro comercial |
| Termos criados **manualmente** via "Gerar termos pendentes" | Auto-gerar ao abrir cobra quota ZapSign sem ação explícita |
| "Excluir" é **soft cancel** | Preserva histórico; unique parcial filtra cancelled e libera nova criação |
| UI em **seção dentro de SaleDetailPage** | Consistência com `ClientContractsSection`; menos navegação |
| **Sem `procedure_id` em `contracts`** | Lista de procs cobertos sai por JOIN sob demanda — evita decidir qual proc guardar quando o template cobre vários |
| **Tabela N:M dedicada** (não coluna `consent_template_id` em `procedures`) | Mantém a direção natural da dependência (contratos → catálogo); `procedures` é foundational e não deve conhecer contratos. Custo da N:M é baixo (tabela já especificada) |

### Endpoints (4)

| Método | Path | Função |
|---|---|---|
| `GET` | `/contract-templates/:id/procedures` | Lista procedimentos vinculados |
| `POST` | `/contract-templates/:id/procedures` | Vincula (`{procedureId}`). Valida `kind='consent_term'`. Idempotente (`onConflictDoNothing`) |
| `DELETE` | `/contract-templates/:id/procedures/:procedureId` | Remove vínculo (idempotente) |
| `POST` | `/sales/:saleId/contracts/consent-terms` | Bulk: gera termos pendentes da venda → `{created, skipped}` |

Permissões: `contractTemplates:read/write` no vínculo, `contracts:write` no bulk. Rota do bulk mora em `salesRoutes.ts` (REST: recurso aninhado em `/sales`), controller em `contracts/` (domínio).

### Fluxo do bulk `generateConsentTermsForSale`

1. Lê a venda + `sale_items` (procedureIds distintos) + cliente.
2. `ConsentTemplateProceduresQuery.listTemplatesForProcedures` → templates ativos `consent_term` que cobrem ≥1 procedimento (já deduplicados por `selectDistinct`).
3. **Pré-check** `ContractsQuery.listActiveConsentTemplateIdsForSale` → templates que já têm termo ativo pra venda. Esses vão direto pra `skipped: already_active` **sem chamar a ZapSign** (rerun não gasta quota — o botão é "termos PENDENTES").
4. Pros demais, chama `ContractsService.create` por template (`saleId`, `journeyId` da venda, `idempotencyKey` server-side por template, variáveis conhecidas resolvidas via catálogo §11; variáveis manuais saem vazias).
5. Resiliência: o unique parcial vira só **guarda de corrida** (2 cliques simultâneos → 23505 → `skipped: already_active`). Erro de provider (ZapSign 5xx) num template **não aborta os outros** → `skipped: provider_error`, `created` parcial. Erro inesperado (config/bug) aborta o lote.

O `create` carimba `AppError.details.code` nos conflitos de venda (`sale_service_contract_active` / `sale_consent_term_active`) pro bulk classificar sem parsear mensagem. Mensagens 409 amigáveis (PT-BR) chegam ao `ContractSendSheet` como toast.

### Contratos avulsos pré-Fase 7

Ficam com `sale_id=NULL`. Os uniques parciais ignoram (`sale_id IS NOT NULL`). Sem backfill — cutover hard, sem contratos em produção via ZapSign.
