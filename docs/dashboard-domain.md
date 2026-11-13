# Dashboard — escopo, métricas e design

Documento de referência da home (`/`). Define **quais** componentes entram no V1, **de onde** os dados vêm, **por que** cada um existe, **como** vai parecer e **com qual biblioteca**.

> **Exceção ao design system:** o dashboard **não segue** estritamente o catálogo do [frontend-design-system.md](./frontend-design-system.md). É a interface mais complexa do sistema e a tela de maior peso visual em apresentação de produto — vale priorizar impacto visual sobre consistência com o resto. Componentes universais (`PageContainer`, `<Card>`) ainda são usados onde fizer sentido; charts e composições próprias do dashboard são livres pra fugir do padrão.

## Filtro global de período

Filtro único no header do dashboard, aplicado a **todos** os blocos exceto onde explicitamente marcado. Default `30d`.

Opções: `hoje / 7d / 30d / 90d / 6m / 12m / mês corrente / mês anterior / custom`.

> A extensão pra `6m` e `12m` (que não existiam no esboço inicial) foi feita pra acomodar o bloco E (evolução comercial), que precisa de horizonte longo. Mantém um único filtro coerente em todo o dashboard.

Comparativo vs período anterior nos KPI cards (delta % + seta) — implementado já no V1 por ser barato e de alto valor percebido.

**Fora de escopo no V1:** filtro por unidade (`units`). Cliente real com 2+ unidades vai entrar como V1.1. Afeta queries de quase todos os blocos.

## Bloco A — KPI cards (faixa superior)

Cards numéricos com delta vs período anterior.

| # | Métrica | Fonte | Observação |
|---|---|---|---|
| A1 | Vendas no período (R$ + qtd) | `sales` onde `closedAt` no range, `status ≠ 'cancelled'` | — |
| A2 | Recebido no período (caixa efetivo) | `payments` onde `paidAt` no range, `status = 'paid'` | Soma de `amount` |
| A3 | Agendamentos hoje (total + breakdown attended/no_show/scheduled) | `appointments` onde `scheduledAt::date = CURRENT_DATE` | **Ignora filtro global** — sempre "hoje" |
| A4 | Leads novos no período | `journeys` onde `createdAt` no range, `stage = 'lead'` no momento da criação | — |
| A5 | Taxa de conversão lead→venda | `count(status='won') / count(status IN ('won','lost'))` no período | Considera só journeys fechadas no range |
| A6 | Ticket médio | `avg(sales.totalAmount)` no período | — |

## Bloco B — Funil de conversão

Gráfico de funil horizontal com 5 etapas, quantidade absoluta + % de conversão entre cada par adjacente. Usa o filtro global.

**Etapas:**
1. Leads novos — `journeys.createdAt` no range
2. Avaliação agendada — `appointments.kind='evaluation'` com qualquer status, `createdAt` no range
3. Avaliação realizada — `evaluations.status='performed'`, `performedAt` no range
4. Orçamento enviado — `quotes.status ≠ 'draft'`, `sentAt` no range
5. Venda fechada — `sales.closedAt` no range, `status ≠ 'cancelled'`

**Decisão de modelagem:** cada etapa filtra pelo timestamp do **evento dela**, não pela coorte do lead. Mais simples e suficiente pra V1 — análise de coorte (taxa de conversão real lead→venda dentro do mesmo ciclo) fica como V2.

Complemento (Tier 2, dentro do V1): tempo médio entre etapas (lead→avaliação, avaliação→orçamento, orçamento→fechamento). Calculado via `journey_events`.

## Bloco C — Tendência e distribuição

| # | Chart | Visual | Fonte |
|---|---|---|---|
| C1 | Receita diária (granularidade adaptativa) | line/area | `sales.closedAt + totalAmount` |
| C2 | Leads por origem (`journeys.source`) | donut horizontal | `journeys` no período |
| C3 | Motivos de perda (`lostReason`) — top 5 | bar horizontal | `journeys` com `status='lost'` no período |
| C4 | Mix de métodos de pagamento | donut | `payments` com `status='paid'` no período |
| C5 | Distribuição de leads por substage (snapshot kanban) | stacked bar | `journeys.leadSubstage` (snapshot, **ignora filtro global**) |

C1 reusa o eixo temporal do filtro global com granularidade adaptativa (ver bloco E).

## Bloco D — Operação / alertas (listas)

Não são charts — listas curtas pro dia-a-dia da recepção. **Ignoram o filtro global** (semântica fixa).

| # | Item | Fonte |
|---|---|---|
| D1 | Pagamentos vencendo (próximos 7d) + inadimplentes | `payments` com `dueDate ≤ today + 7`, `status = 'pending'` |
| D2 | Avaliações pendentes hoje/amanhã | `appointments.kind='evaluation'`, `scheduledAt` entre hoje e amanhã, status não-terminal |
| D3 | Conversas sem resposta há >2h | última `messages` do tipo `inbound` sem `outbound` posterior, por `conversation` |

## Bloco E — Evolução comercial (destaque, full-width)

Line chart com **3 séries normalizadas** (índice 100 no primeiro bucket), pra visualizar trajetória e correlação ao longo do período.

**Séries:**
- Leads cadastrados — count de `journeys` com `createdAt` no bucket
- Vendas fechadas (qtd) — count de `sales` com `closedAt` no bucket, `status ≠ 'cancelled'`
- Vendas fechadas (R$) — sum de `sales.totalAmount` com `closedAt` no bucket, `status ≠ 'cancelled'`

> **Por que normalizar?** As 3 séries vivem em ordens de grandeza diferentes (dezenas/unidades/milhares de R$). Em escala absoluta no mesmo eixo Y, R$ esmaga as outras. Normalização perde valores absolutos mas mantém a leitura de tendência limpa.

**KPIs derivados (números compactos abaixo do chart, do período selecionado):**
- Ticket médio (R$)
- Taxa de conversão lead→venda (%)
- Ciclo médio lead→venda (dias) — via `journey_events`

**Granularidade adaptativa** (em função do range do filtro global):

| Range global | Granularidade |
|---|---|
| `< 14d` | Empty state — "Selecione um período de pelo menos 14 dias pra visualizar a evolução" |
| `14–60d` | Semanal |
| `60–180d` | Mensal |
| `180–540d` | Mensal |
| `> 540d` | Trimestral |

**Empty state em ranges curtos:** o componente permanece no layout (mantém o grid estável, sem layout shift) com a mensagem explicativa. Não esconde — ensina o usuário que aquele chart pede horizonte mais longo.

## Resumo do escopo V1

| Bloco | Itens | Posição no layout (preliminar) |
|---|---|---|
| A | 6 KPI cards | Faixa superior |
| B | Funil de 5 etapas | Coluna principal |
| C | 5 charts (donut + bar + line) | Grid 2–3 colunas |
| D | 3 listas operacionais | Coluna lateral ou rodapé |
| E | Line chart de evolução (3 séries normalizadas) | Full-width, destaque |

## Design e biblioteca de charts

### Biblioteca: Nivo

**Escolha:** [Nivo](https://nivo.rocks) (pacotes modulares — `@nivo/line`, `@nivo/pie`, `@nivo/bar`, `@nivo/funnel`).

**Contexto:** o dashboard precisa de qualidade visual de apresentação (animações, gradientes, polish out-of-the-box), não só funcionalidade. O critério padrão (fit com shadcn + bundle mínimo) cederia espaço pra impacto visual.

**Opções consideradas:**
- shadcn/charts (Recharts) — descartado: visual minimalista demais pro propósito do dashboard
- Apache ECharts — finalista; maior catálogo de chart types, mas integração React via config JSON é menos natural pro stack
- Tremor — sem funnel nativo, opinião de design forte que limita customização
- Apexcharts — visual "marketing dashboard" genérico, menos premium
- Highcharts — descartado: licença comercial paga

**Razões da escolha:**
1. Integração React declarativa via props (combina com o resto do `apps/frontend`).
2. Animações via react-spring (physics-based) — transições entre estados de filtro saem naturais.
3. Tooltips são componentes React — podem compor com primitivos shadcn (best of both worlds).
4. Visual padrão alinhado com estética SaaS ocidental moderna — menos retrabalho de "destinização".
5. Pacotes modulares — só instala os charts usados.
6. Funnel nativo (suporta trapezoides clássicos — escolha do bloco B).

### Layout

Hierarquia visual fixada: **A → E → B+D → C**.

```
┌──────────────────────────────────────────────────────────────────┐
│ Header: filtro de período                                        │
├──────────────────────────────────────────────────────────────────┤
│ [A1] [A2] [A3] [A4] [A5] [A6]                                    │  ← Bloco A
├──────────────────────────────────────────────────────────────────┤
│ Bloco E — Evolução comercial (full-width, destaque)              │
├─────────────────────────────────────┬────────────────────────────┤
│ Bloco B — Funil                      │ D1 Pagamentos a vencer    │
│                                      │ D2 Avaliações próximas    │
│                                      │ D3 Conversas sem resposta │
├─────────────────────┬────────────────┴────────────────────────────┤
│ C1 Receita          │ C2 Origem      │ C3 Motivos de perda        │
├─────────────────────┼────────────────┴────────────────────────────┤
│ C4 Métodos pagto    │ C5 Substages                                │
└─────────────────────┴─────────────────────────────────────────────┘
```

Lógica: números rápidos (A) → história do negócio (E) → foco comercial vs operacional lado a lado (B+D) → drill-down por dimensão (C).

### Mobile (V1)

Responsivo desde o V1 (não fica pra polish posterior). Breakpoints orientadores:

- `≥ lg` (desktop): grid completo descrito acima.
- `md` (tablet): A vira 2 colunas × 3 linhas, B e D empilham, C em 2 colunas.
- `< md` (mobile): tudo em coluna única. A em 1 ou 2 colunas. Charts ocupam 100%.

Charts Nivo são SVG responsivo nativo (`<ResponsiveLine />`, etc.) — não precisa de breakpoint manual no chart, só no grid container.

### Funnel chart (Bloco B)

Estilo **trapezoides clássicos decrescentes** (não horizontal bar com largura proporcional). Cada etapa renderiza um trapezoide cuja largura no topo é proporcional ao volume da etapa anterior — leitura visual clássica de funil de conversão.

Via `@nivo/funnel`.

### Tokens de cor por série (mapeamento sugerido)

Aplicado de forma consistente em todos os blocos:

| Conceito | Token / cor |
|---|---|
| Leads (entrada) | `primary` |
| Vendas em quantidade | `success` |
| Vendas em R$ / receita | `info` ou neutro escuro |
| Perda / lost / inadimplência | `error` |
| Pendente / vencendo | `warning` |
| Avaliações | `accent` |

## Fora de escopo (registrado pra futuro)

- Heatmap de ocupação por profissional / equipamento
- Métricas de WhatsApp (volume in/out, tempo médio de resposta, templates mais usados)
- Análise de coorte e retenção (taxa de conversão **da mesma coorte**, não por evento no período)
- Drill-down clicável em cada métrica (ir do KPI pra lista filtrada)
- Filtro por unidade (V1.1, quando primeiro tenant multi-unidade entrar em prod)
