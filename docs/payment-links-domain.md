# Payment Links Domain — cobrança de parcelas via Asaas

> **Status: esboço (2026-11-11).** Nada implementado. Regras e requisitos levantados antes do código. A decisão de arquitetura está em [arquitetura.md §27](./arquitetura.md). Atualize este documento conforme as fases fecharem.

**Não confundir** com o "Modelo de billing" de decisoes-pendentes.md, que trata de como o **Elora cobra as clínicas** pela assinatura do SaaS. Este documento trata de como a **clínica cobra o paciente**.

---

## 1. Escopo

A operadora gera um link de pagamento para uma parcela da venda e o envia ao cliente pelo chat do próprio Elora. Quando o cliente paga, o Elora recebe o aviso do Asaas e dá baixa na parcela sozinho, sem ninguém clicar em "marcar como paga".

**Entra no V1:**
- conectar a conta Asaas da clínica;
- gerar a cobrança e o link de uma parcela;
- enviar o link pelo chat;
- dar baixa automática via webhook;
- conciliação periódica;
- cancelar e editar a cobrança junto com a parcela.

**Fica fora do V1** (§10): estorno automático, parcelamento no cartão dentro do link, split ou subcontas (modelo B), juros e multa por atraso, régua de cobrança automática.

---

## 2. Glossário

| Termo | Significado aqui |
|---|---|
| **Parcela** | Linha de `payments` (1 venda → N parcelas). É a unidade que se cobra. |
| **Cobrança (charge)** | Objeto criado no Asaas (`POST /v3/payments`, id `pay_...`) que representa **uma** parcela. |
| **Link / fatura** | `invoiceUrl` da cobrança: a página do Asaas onde o cliente escolhe Pix, boleto ou cartão. |
| **Customer** | Cadastro do cliente dentro da conta Asaas da clínica (`POST /v3/customers`, id `cus_...`). Precisa existir antes da cobrança. |
| **Webhook** | POST do Asaas para o Elora quando a cobrança muda de status. É a fonte principal da baixa automática. |
| **Conciliação** | Job que consulta o Asaas pelas cobranças ainda abertas. É a rede de segurança quando um webhook se perde. |
| **Liquidação** | Quando o dinheiro cai na conta da clínica. Pix cai no mesmo dia; cartão fica para D+30 por parcela. **"Pago" ≠ "liquidado"**: o Elora só controla o "pago". |

> As referências à API do Asaas (endpoints, eventos, campos e header de autenticação) foram levantadas de memória durante o desenho. **Confira na documentação oficial (docs.asaas.com) antes de implementar.**

---

## 3. Modelo de conta (decisão)

**Modelo A: cada clínica conecta a própria conta Asaas.** O dinheiro vai direto para a clínica e o Elora é só o software. Ele não é intermediador financeiro, não responde pelo KYC da clínica e não cobra percentual por transação. Detalhes e alternativas em [arquitetura.md §27](./arquitetura.md).

Consequências práticas:
- **Credencial por tenant.** Diferente da ZapSign (conta única Elora via env), cada tenant tem a sua API key.
- **O tenant sem integração** não vê nenhum botão de link. É o mesmo padrão de gate do `chatEnabled`.
- **LGPD:** nome, CPF e telefone do paciente vão para o Asaas sob o contrato da **clínica** com o Asaas. O Elora atua como operador e só repassa os dados por ordem da clínica.

---

## 4. Fluxos

### 4.1 Conectar a conta (admin da clínica)
1. O admin abre **Configurações → Integrações → Asaas**, cola a API key e escolhe o ambiente (produção ou sandbox).
2. O Elora valida a chave com uma chamada leve (por exemplo, `GET /v3/myAccount`). Se a chave for inválida, devolve erro de campo e não salva.
3. O Elora gera um `webhook_token` aleatório e **cadastra o webhook sozinho** via API (`POST /v3/webhooks`), com a URL da integração e os eventos de §6.2. O admin não precisa mexer no painel do Asaas.
4. A integração é salva como `active`. A chave fica criptografada (§7.2).
5. Desconectar marca a integração como `inactive` e tenta remover o webhook no Asaas (*best-effort*). As cobranças abertas continuam válidas no Asaas. O Elora apenas para de gerar novas e continua aceitando os webhooks das existentes até a conciliação fechá-las.

### 4.2 Gerar o link de uma parcela
Disparo: botão **"Gerar link"** na parcela `pending` (detalhe da venda).

1. **Pré-requisito do cliente:** CPF em `clients.document`, porque o Asaas exige `cpfCnpj` no customer. Sem CPF, a interface pede o CPF antes de continuar e grava no cadastro.
2. **Customer:** procura o mapeamento cliente ↔ customer dessa integração. Se não existir, cria no Asaas (`externalReference = client.id`) e grava o mapeamento.
3. **Cobrança:** `POST /v3/payments` com:
   - `customer`;
   - `billingType = UNDEFINED` (o cliente escolhe entre Pix, boleto e cartão);
   - `value = payment.amount`;
   - `dueDate = payment.due_date` (se a data já passou, usa a de hoje);
   - `description` (procedimentos e "parcela 2/3");
   - `externalReference = payment.id`.
4. Grava na parcela: `provider_charge_id`, `payment_url` e `provider_status`.
5. **Idempotência:** se a parcela já tem cobrança ativa, devolve a existente em vez de criar outra. Para evitar corrida no duplo clique, use `SELECT ... FOR UPDATE` na parcela, ou chave de idempotência como em contratos.

### 4.3 Enviar pelo chat
Botão **"Enviar link"**, que só aparece quando há `payment_url` e `chatEnabled`. Abre a conversa do cliente via `openChatConversation(conversationId, draftText)` (mesmo padrão de contrato e presença), com rascunho editável:

> Olá {primeiro nome}! Segue o link para pagamento da parcela {n}/{total} ({valor}), com vencimento em {data}: {payment_url}

O texto vai como **rascunho, nunca envio automático**: a operadora revisa e envia. Também há um botão "Copiar link", para outros canais.

### 4.4 Pagamento confirmado (webhook)
1. O Asaas faz POST em `/webhooks/payments/asaas/:integrationId`.
2. O Elora valida o token (§6.1), registra o evento cru (§7.3) e **enfileira** um job no BullMQ. Responde 200 rápido; o processamento pesado não acontece dentro do request.
3. O worker resolve o tenant e abre `withTenant`. Depois localiza a parcela por `provider_charge_id`, e, se não achar, por `externalReference`.
4. Em evento de pago (§6.2), executa a **mesma lógica do `mark-paid` manual**, com três ajustes:
   - `paid_at` = data de pagamento informada pelo Asaas, não o horário de chegada do webhook;
   - `payment_method` passa a ser o meio **efetivamente usado** (PIX → `pix`, BOLETO → `bank_transfer`, CREDIT_CARD → `credit_card`);
   - `SalesQuery.recomputeSaleStatus` recalcula `paid_amount` e `sales.status`.
5. Publica um evento no socket (sala `tenant`) para a tela da venda e o caixa atualizarem ao vivo. Opcional: push "Pagamento recebido".

### 4.5 Conciliação
Um job BullMQ repetível (por exemplo, a cada 6 h) percorre as parcelas `pending` com cobrança ativa e vencimento dentro de uma janela, consulta `GET /v3/payments/{id}` e aplica o mesmo handler do webhook. Também roda sob demanda por um botão "Atualizar status" na parcela.

---

## 5. Regras de negócio

1. **Uma cobrança ativa por parcela.** Nunca uma cobrança cobrindo várias parcelas, nem uma parcela com duas cobranças ativas (garantido por UNIQUE parcial no banco).
2. **Só parcela `pending` pode gerar link.** Parcela `paid` ou `cancelled` não pode.
3. **Baixa manual com cobrança ativa:** se a operadora marcar como paga na mão (o cliente pagou em dinheiro, por exemplo), o Elora **cancela ou dá baixa na cobrança no Asaas** (`receiveInCash` ou `DELETE`) para o cliente não pagar duas vezes pelo link. Se o Asaas falhar, a baixa local continua valendo e aparece um aviso para resolver no painel.
4. **Editar a parcela** (`amount` ou `due_date`) com cobrança ativa atualiza a cobrança no Asaas. Se não der para atualizar (a cobrança já está paga ou expirou), a edição é recusada com 409.
5. **Cancelar a parcela ou a venda** cancela a cobrança no Asaas.
6. **O webhook nunca regride um status.** Parcela `paid` não volta para `pending` por evento atrasado ou fora de ordem. Estorno é tratado à parte (§10).
7. **Valor pago diferente do valor da parcela** (raro: desconto ou juros configurados no Asaas): a baixa usa o valor da parcela e o valor recebido fica registrado no evento. Divergência gera log de aviso.
8. **Cobrança órfã** (não acha parcela nem integração): responde 200 `ignored` e loga.
9. **Cartão parcelado ≠ parcelas do Elora.** No V1 o link aceita cartão só à vista, por parcela. Se o paciente quer 3x no cartão, a operadora cria a venda com **uma** parcela e a decisão sobre o parcelamento no cartão fica para §10.
10. **Taxa do Asaas** não altera o valor da venda. O caixa mostra o valor bruto. O líquido (`netValue`) fica guardado para um relatório futuro.

---

## 6. Webhook

### 6.1 Endpoint e autenticação
- `POST /webhooks/payments/asaas/:integrationId`, **público** (fora do `tenantContextMiddleware`), no mesmo padrão de `/webhooks/zapsign`.
- O Asaas manda o token configurado no header `asaas-access-token`. Comparar com `webhook_token` da integração usando **comparação em tempo constante**.
- Resolução de tenant: função `resolve_payment_integration_tenant(p_integration_id uuid)` **SECURITY DEFINER**, igual a `resolve_contract_tenant` (0028) e `resolve_channel_tenant` (0005).

### 6.2 Eventos
| Evento Asaas | Efeito no Elora |
|---|---|
| `PAYMENT_RECEIVED` | **Baixa** (Pix e boleto compensados, cartão liquidado) |
| `PAYMENT_CONFIRMED` | **Baixa** (cartão aprovado; dinheiro em D+30). Decisão: considerar pago aqui, porque o paciente já pagou e o risco é da operadora |
| `PAYMENT_OVERDUE` | Atualiza `provider_status` (badge "vencida"). A parcela continua `pending` |
| `PAYMENT_DELETED` | Cobrança cancelada fora do Elora: limpa `payment_url` e marca a cobrança como inativa. A parcela continua `pending` e pode gerar link novo |
| `PAYMENT_REFUNDED`, `PAYMENT_CHARGEBACK_*` | V1: registra, alerta (log de aviso + aviso na interface) e **não** altera a parcela automaticamente (§10) |
| Outros | Registra e ignora |

### 6.3 Política de resposta
Igual à da ZapSign (contracts-domain §5):
- **200 `processed`**;
- **200 `ignored`** (órfão ou evento irrelevante);
- **401** (token inválido);
- **500** (erro interno; o Asaas retenta).

O Asaas **pausa a fila de webhooks** depois de falhas seguidas. Por isso o request deve só validar, gravar e enfileirar, e a conciliação (§4.5) cobre o período em que a fila ficou pausada.

### 6.4 Idempotência
O payload do webhook traz um id de evento. `UNIQUE (integration_id, provider_event_id)` na tabela de eventos: um evento repetido é descartado no INSERT (`ON CONFLICT DO NOTHING`). Além disso, a baixa é idempotente por estado: uma parcela já `paid` não é tocada.

---

## 7. Modelo de dados (esboço)

Todas as tabelas novas seguem a regra de sempre: `tenant_id`, policy de isolamento, `FORCE ROW LEVEL SECURITY` e `updated_at` com `$onUpdate`.

### 7.1 `payment_integrations`
```
id uuid PK
tenant_id uuid
provider            enum payment_provider ('asaas')
environment         enum ('production','sandbox')
status              enum ('active','inactive')
api_key_encrypted   text      -- §7.2
api_key_last4       varchar(4)  -- só pra exibir "••••abcd" na UI
webhook_token       varchar(64)
provider_webhook_id varchar(64) -- id do webhook cadastrado no Asaas
account_name        varchar(255) -- nome da conta Asaas, pra conferência visual
created_at, updated_at, created_by_user_id
UNIQUE PARTIAL (tenant_id, provider) WHERE status = 'active'
```

### 7.2 Criptografia da API key
A chave do Asaas **movimenta dinheiro** (transferências, saques), então não pode ficar em texto puro como o `apiKey` do Evolution em `whatsapp_channels.provider_config`. Regras:
- AES-256-GCM em `shared/crypto/`, com a chave mestra em env (`PAYMENTS_ENCRYPTION_KEY`, 32 bytes base64);
- o formato gravado inclui versão: `v1:<iv>:<tag>:<ciphertext>`;
- a chave nunca volta para o frontend nem aparece em log (o redact do Pino deve cobrir `apiKey`/`access_token`);
- recomendar à clínica gerar uma chave dedicada ao Elora (se o Asaas permitir restringir o escopo, usar escopo mínimo: a confirmar).

### 7.3 `payment_provider_events`
Log cru dos webhooks e da conciliação: auditoria e idempotência.
```
id uuid PK, tenant_id, integration_id
provider_event_id varchar(64)
event_type        varchar(64)
provider_charge_id varchar(64)
payload           jsonb
processed_at      timestamp null
error             text null
created_at
UNIQUE (integration_id, provider_event_id)
```

### 7.4 `payment_provider_customers`
Mapeamento cliente ↔ customer **por integração**. Se a clínica trocar de conta Asaas, os ids antigos não valem mais.
```
id, tenant_id, integration_id, client_id, provider_customer_id
UNIQUE (integration_id, client_id)
```
Ao editar nome, CPF ou telefone do cliente, atualizar o customer no Asaas na próxima cobrança, não em tempo real.

### 7.5 Colunas novas em `payments`
```
provider_integration_id uuid null FK payment_integrations
provider_charge_id      varchar(64) null
payment_url             text null
provider_status         varchar(32) null   -- espelho cru (PENDING, OVERDUE, ...)
provider_net_amount     decimal(12,2) null -- líquido após taxa
charge_created_at       timestamp null
UNIQUE PARTIAL (provider_charge_id) WHERE provider_charge_id IS NOT NULL
```

---

## 8. Backend

- **Adapter** em `shared/providers/payment/`. Interface `IPaymentProvider` no mesmo padrão de `ISignatureProvider`:
  - `verifyCredentials()`;
  - `registerWebhook()` e `removeWebhook()`;
  - `upsertCustomer()`;
  - `createCharge()`, `getCharge()`, `updateCharge()`, `cancelCharge()`, `markReceivedInCash()`;
  - `verifyWebhook()`;
  - `normalizeWebhook()`, que devolve `NormalizedPaymentEvent` com `kind: 'charge.paid' | 'charge.overdue' | 'charge.deleted' | 'charge.refunded' | 'unknown'`.

  A implementação concreta é o `AsaasAdapter`. Em dev, usar `MockPaymentProvider` (mock-first, como o WhatsApp) com um endpoint de dev que simula o pagamento.
- **Módulos:**
  - `modules/paymentIntegrations/`: CRUD da integração, permissão `payments:manage`;
  - em `modules/sales/`: rotas de cobrança da parcela (`sales:write`):
    - `POST /sales/:id/payments/:paymentId/charge` (gerar ou obter);
    - `DELETE .../charge` (cancelar);
    - `POST .../charge/refresh` (consultar agora);
  - `modules/paymentWebhooks/`: rota pública + worker.
- **Baixa:** extrair o corpo de `SalesService.markPaid` para uma função interna reutilizada pelo `mark-paid` manual e pelo worker. Uma única fonte de regra para recalcular a venda.
- **Permissões:** `payments:manage` = admin. Gerar e enviar link = `sales:write`. Atualizar os **dois** mapas de permissão (core e chat), se o chat precisar.
- **OpenAPI:** toda rota nova com `registerPath` (regra 10).
- **Eventos socket:** `sale.payment.paid` (nome a definir) em [realtime-socket-events.md](./realtime-socket-events.md).

## 9. Frontend

- **Configurações → Integrações → Asaas:** formulário em Sheet (skill `sheets-dialogs`) com API key, ambiente e status. Mostra `account_name` e `••••last4`. Botão "Desconectar" com `useConfirm`.
- **`/auth/me`** devolve `paymentLinksEnabled` (há integração ativa). Sem isso, nenhum botão de cobrança aparece.
- **Detalhe da venda (parcela):** badge do status da cobrança (`Link gerado`, `Vencida`, `Paga via Pix`...) e ações em `RowActions`: Gerar link, Enviar pelo chat, Copiar link, Atualizar status, Cancelar link.
- **Caixa:** sem mudança estrutural. A baixa automática entra pelo `paid_at` como qualquer outra. Opcional: ícone indicando "baixa automática".

---

## 10. Fora do V1 (ideias registradas)

- **Estorno e chargeback:** status novo `refunded` em `payment_status` (ou reabrir a parcela), estornar pelo Elora e refletir em `sales.status`.
- **Parcelamento no cartão dentro do link:** cobrança com `installmentCount` gera N cobranças no Asaas. É preciso decidir como isso conversa com as parcelas do Elora.
- **Régua de cobrança:** lembrete automático de vencimento pelo WhatsApp, usando o motor de automações do chat.
- **Juros e multa** por atraso configuráveis por tenant.
- **Modelo B (subcontas e split)**, se o Elora passar a cobrar percentual por transação: ver arquitetura §27.
- **Link avulso** sem venda (sinal de agendamento, por exemplo).
- **Relatório de taxas** (bruto × líquido) a partir de `provider_net_amount`.

## 11. Perguntas em aberto

1. **CPF obrigatório:** sem CPF não há link. É aceitável pedir na hora, ou o CPF deve ficar obrigatório no fechamento da venda?
2. **`PAYMENT_CONFIRMED` (cartão) conta como pago?** Proposta: sim (§6.2). Confirmar com a operação de uma clínica.
3. **Vencimento do link:** usar o `due_date` da parcela ou um prazo fixo (por exemplo, 3 dias a partir da geração)?
4. **Quem pode gerar o link:** qualquer `sales:write` (recepção incluída) ou só admin/manager?
5. **Desconectar com cobranças abertas:** bloquear, avisar ou cancelar todas no Asaas?
6. **Notificação push** de "pagamento recebido": para quem? (quem gerou o link, admins, todos com `sales:read`?)

## 12. Fases sugeridas

| Fase | Entrega |
|---|---|
| 1 | Schema + migration (§7), crypto, `IPaymentProvider` + Mock + `AsaasAdapter` (credenciais, customer, cobrança) |
| 2 | Tela de integração (conectar, validar, registrar webhook) + `paymentLinksEnabled` no `/auth/me` |
| 3 | Gerar, copiar e enviar link na parcela (chat com rascunho) |
| 4 | Webhook + worker + baixa automática + evento socket |
| 5 | Sincronização de editar, cancelar e baixa manual com o Asaas (regras 3–5) + conciliação |
| 6 | Validação em sandbox Asaas ponta a ponta, depois piloto em uma clínica |
