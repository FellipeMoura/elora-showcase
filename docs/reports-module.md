# Módulo de Relatórios

Doc operacional. **Leia antes de criar/modificar relatório.** Pra histórico das fases de implementação e decisões cronológicas, ver reports-module-implementation.md.

## Visão geral

3 conceitos formam a infra:

1. **Registry** (código) — catálogo de slugs → handlers. Fonte da verdade.
2. **Banco** (3 tabelas globais) — projeção do registry + visibility (tenant × grupo).
3. **Sync no boot** — `apps/core` faz upsert do registry pra tabela `reports` ao subir.

**Slug** é a chave natural (`<domain>.<snake_case_action>`, ex: `leads.summary`). Frontend casa renderer/form por slug. NUNCA usar id inteiro como method_id — slug rename-safe e legível em logs.

## Estrutura

### Backend
```
apps/core/src/modules/reports/
├── registry.ts                # slug → { name, description, category, paramsSchema, handler }
├── ReportsTypes.ts            # Zod schemas + types do contrato HTTP
├── ReportsQuery.ts            # Visibility queries (reports × report_tenants × report_groups × user_groups)
├── ReportsService.ts          # Dispatch + validação params (via paramsSchema do handler)
├── ReportsController.ts       # try/catch + next(err)
├── reportsRoutes.ts           # Router + openApiRegistry.registerPath
├── syncRegistry.ts            # Boot-time sync (chamado em server.ts)
└── handlers/                  # 1 arquivo por relatório
    └── leadsSummary.ts        # Referência canônica
```

### Frontend
```
apps/frontend/src/pages/reports/
├── ReportsPage.tsx            # Lista de relatórios visíveis (ButtonGroup categoria + cards verticais)
├── ReportRunPage.tsx          # Página dedicada de execução /reports/:slug
├── categoryLabels.ts          # REPORT_CATEGORIES + labels PT-BR
├── components/
│   ├── PrintableReport.tsx    # Shell de impressão (header tenant + nome + período + gerado em/por)
│   └── ReportSection.tsx      # Accordion via <details> nativo
├── forms/                     # Forms inline pra relatórios SEM PeriodFilter
│   ├── formId.ts              # REPORT_RUN_FORM_ID compartilhado
│   └── index.tsx              # Dispatch por slug + fallback "sem parâmetros"
└── renderers/                 # Visualização do resultado
    ├── ComparisonCell.tsx     # Célula numérica com comparativo (↑/→/↓ + cor)
    ├── leadsSummaryHelpers.ts # compareDelta, deltaToStatus, formatadores, labels
    ├── index.tsx              # Dispatch por slug + fallback <pre>
    └── LeadsSummaryRenderer.tsx
```

**Compartilhado** (servem fora do módulo também):
- `apps/core/src/shared/period/period.ts` — `periodEnum`, `resolvePeriodRange`, `periodQuerySchema`
- `apps/frontend/src/hooks/usePeriodFilter.ts` — estado do filtro de período na URL
- `apps/frontend/src/components/data/PeriodFilter.tsx` — Select 9 presets + popover custom

### Banco
3 tabelas globais (sem RLS — espelham `menus`/`menu_tenants`/`menu_groups`):

- **`reports`** — `slug` (unique), `name`, `description`, `category`, `active`, timestamps
- **`report_tenants`** — visibility por tenant (super-admin gerencia)
- **`report_groups`** — visibility por grupo dentro do tenant

### Endpoints

| Método | Path | Permission | Descrição |
|---|---|---|---|
| GET | `/reports` | `reports:read` | Lista visíveis (filtra por tenant × grupo) |
| GET | `/reports/:slug` | `reports:read` | Metadata do relatório |
| POST | `/reports/:slug/run` | `reports:read` | Executa — body = params validados via paramsSchema |

Permissions em [apps/core/src/shared/permissions/permissions.ts](../apps/core/src/shared/permissions/permissions.ts).

## Padrões de design (estabelecidos no leads.summary)

### 1. Página dedicada, nunca sheet

TODA execução de relatório vira página em `/reports/:slug`. Sheet fica reservado pra forms curtos do app (cadastro/edição), não pra relatórios.

**Por que:** full-width pra tabelas largas, URL bookmarkable/compartilhável, PDF export natural, padrão consistente.

### 2. URL como source of truth dos filtros

Params do relatório vivem em `?period=...&from=...&to=...`. ReportRunPage observa URL via `useSearchParams` + `usePeriodFilter` e re-executa a mutation automaticamente quando muda.

**Vantagens:** bookmark/share preserva filtro, refresh sobrevive, back/forward do navegador funcionam.

### 3. Filtro de período padronizado

**Use o `<PeriodFilter>` compartilhado** ([components/data/PeriodFilter.tsx](../apps/frontend/src/components/data/PeriodFilter.tsx)) sempre que o relatório aceitar range temporal. NUNCA criar form custom com 2 date inputs.

9 presets: hoje, 7d, 30d, 90d, 6m, 12m, mês atual, mês anterior, personalizado.

**Integração**:
- **Backend** handler aceita `{ period, from?, to? }` via `periodQuerySchema` de `shared/period/period.ts`. Resolve via `resolvePeriodRange(params.period, params.from, params.to)` — retorna `{ from: Date, to: Date }` com `to` exclusivo.
- **Output** devolve `period: { from, to }` resolvido como ISO YYYY-MM-DD (renderer mostra no header do PDF).
- **Frontend** adicionar slug em `SLUGS_WITH_PERIOD_FILTER` em [ReportRunPage.tsx](../apps/frontend/src/pages/reports/ReportRunPage.tsx). Não criar form inline.

### 4. Forms inline (relatórios SEM período padrão)

Pra relatórios com params customizados (não-período) ou misto, criar form em `forms/<Name>Form.tsx` com `react-hook-form` + Zod. Registrar em `forms/index.tsx`.

Form inline mostra botão "Aplicar" no fim (atualiza URL no submit). Diferente do PeriodFilter, que aplica on-change.

### 5. PrintableReport + ReportSection

ReportRunPage envolve TODO o conteúdo do renderer em `<PrintableReport>` (responsabilidade do shell, não do renderer). Renderer recebe `result` e renderiza diretamente as seções.

Cada bloco do relatório é um `<ReportSection title defaultOpen? subtitle?>`. Seção principal recebe `defaultOpen`; auxiliares começam colapsadas (`defaultOpen` omitido).

**CSS `@media print`** em [index.css](../apps/frontend/src/index.css) força todas as sections abertas no PDF + esconde shell do app (sidebar, toolbar, filtros).

### 6. ComparisonCell pra comparativos vs média

Pra colunas que comparam valor diário vs média do período, usar `<ComparisonCell value status direction>` ([ComparisonCell.tsx](../apps/frontend/src/pages/reports/renderers/ComparisonCell.tsx)).

Direção (`above`/`within`/`below`) e cor (`success`/`primary`/`error`) são **desacopladas**. Métricas onde menor é melhor (tempo de resposta) passam `inverted=true` no `deltaToStatus` — mantém a seta (↑/↓) mas troca a cor.

**Helpers** em [leadsSummaryHelpers.ts](../apps/frontend/src/pages/reports/renderers/leadsSummaryHelpers.ts):
- `compareDelta(value, avg, threshold)` → `'above' | 'within' | 'below'`
- `deltaToStatus(delta, inverted?)` → `'success' | 'primary' | 'error'`
- `responseTimeThreshold(avg)` — threshold proporcional `±20%` pra métricas de tempo

**Threshold** vive no renderer (frontend), não no backend. Backend devolve só os números brutos + a média.

### 7. Daily breakdown com `tfoot` totalizador

Quando o relatório tem tabela com breakdown por dia/grupo, **incluir `<tfoot>`** com totais. Sem comparativos no footer (é a referência).

Médias ponderadas > média-de-médias quando aplicável. Ex: ticket médio geral = `totalConvertedValue / totalWon`, NÃO `avg(avgTicket diário)` — dias com 1 venda não pesam o mesmo que dias com 10.

### 8. Renderer dispatchar por slug

Cada relatório tem um renderer dedicado em `renderers/<Name>Renderer.tsx`. Adicionar entry em `renderers/index.tsx`:

```ts
const renderers: Record<string, RendererComponent> = {
  'leads.summary': LeadsSummaryRenderer,
  // novo: 'sales.monthly_revenue': SalesMonthlyRevenueRenderer,
}
```

Sem entry → fallback renderiza JSON cru em `<pre>` (útil em dev antes do renderer existir).

### 9. Helpers de formatação compartilhados

Em [leadsSummaryHelpers.ts](../apps/frontend/src/pages/reports/renderers/leadsSummaryHelpers.ts):
- `formatInt(n)`, `formatPct(n)`, `formatMoney(n)`, `formatMinutes(n)`, `formatDayShort(yyyymmdd)`

Reusar antes de criar novo formatador. Quando um helper servir 2+ renderers, mover pra `leadsSummaryHelpers.ts` (ou renomear arquivo pra `reportHelpers.ts` quando crescer).

### 10. Labels em PT-BR

Labels de enums (sources, lost reasons) vivem em `leadsSummaryHelpers.ts`. Labels de categorias em `categoryLabels.ts`. Adicionar entry quando entrar relatório novo com enum no output.

### 11. Categorias canônicas

Hoje 3 categorias (ButtonGroup full-width na `ReportsPage`):
- `comercial` — leads, vendas, conversões
- `operacional` — agenda, equipe, processos, validação técnica
- `financeiro` — caixa, fluxo, contas

Definidas em:
- Backend: [`registry.ts`](../apps/core/src/modules/reports/registry.ts) (campo `category` de cada entry)
- Frontend: [`pages/reports/categoryLabels.ts`](../apps/frontend/src/pages/reports/categoryLabels.ts) (`REPORT_CATEGORIES`, `CATEGORY_LABELS`, `REPORT_CATEGORY_OPTIONS`)

Adicionar categoria nova: atualizar os dois (+ aparece no ButtonGroup automaticamente).

### 12. Card clicável (ReportsPage)

Cards na lista de relatórios são `<button>` nativos com o card inteiro clicável. SEM botão "Executar" dentro do card. Click → `navigate(/reports/:slug)`.

Cards renderizados full-width (1 coluna vertical).

## PDF export

CSS `@media print` em [index.css](../apps/frontend/src/index.css) + `window.print()` nativo do browser. **Zero libs**.

Botão "Exportar PDF" na toolbar da `ReportRunPage` chama `window.print()`. O CSS:
- Esconde shell (sidebar, toolbar, filtros inline) via `body * { visibility: hidden }` + revela só `[data-report-printable]`
- Reposiciona o `PrintableReport` pra cobrir a folha inteira
- Força `<details data-report-section>` abertos
- A4 portrait, margens 12mm × 10mm

**O que o renderer precisa respeitar:**
- Envolver seções em `<ReportSection>` (auto-abertas no print)
- Usar `tabular-nums` em colunas numéricas (alinhamento consistente)
- Cores via tokens semânticos (`text-success`/`text-primary`/`text-error`) — print preserva
- Sem JS dinâmico no DOM final (gráficos canvas/svg funcionam; animações não)
- `print:hidden` em conteúdo interativo (botões, popovers)

Se a qualidade do browser-print algum dia não satisfizer: migrar pra puppeteer server-side em UM ponto (`PrintableReport` + nova rota backend), sem mexer em cada renderer.

## Como criar um novo relatório

### Backend

**1.** Criar `apps/core/src/modules/reports/handlers/<slug>.ts`. Estrutura:

```ts
import { sql, withTenant } from '@elora/db'
import { db } from '../../../shared/database/db.js'
import { z } from '../../../shared/openapi/registry.js'
import {
  periodEnum,
  resolvePeriodRange,
  toIsoDateUtc,
} from '../../../shared/period/period.js'
import type { ReportContext } from '../registry.js'

// Params (se aceitar período, use o pattern abaixo)
export const <slug>ParamsSchema = z
  .object({
    period: periodEnum.default('30d'),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.period === 'custom' && (!val.from || !val.to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'period=custom exige from e to', path: ['from'] })
    }
  })
  .openapi('<Slug>Params')

export type <Slug>Params = z.infer<typeof <slug>ParamsSchema>

// Tipos do output
export interface <Slug>Data {
  period: { from: string; to: string }
  // ... blocks específicos
}

// Handler
export async function <slug>Handler(
  params: <Slug>Params,
  ctx: ReportContext,
): Promise<<Slug>Data> {
  const range = resolvePeriodRange(params.period, params.from, params.to)
  const fromIso = toIsoDateUtc(range.from)
  const toInclusiveIso = toIsoDateUtc(new Date(range.to.getTime() - 86_400_000))

  return withTenant(db, ctx.tenantId, async (tx) => {
    // Queries — usar tx pra RLS funcionar.
    // Comparações de data: ${range.from} e ${range.to} (to exclusivo).
    return {
      period: { from: fromIso, to: toInclusiveIso },
      // ...
    }
  })
}
```

**2.** Adicionar entry em [`registry.ts`](../apps/core/src/modules/reports/registry.ts):

```ts
'<slug>': {
  name: 'Nome PT-BR',
  description: '...',
  category: 'comercial' | 'operacional' | 'financeiro',
  paramsSchema: <slug>ParamsSchema,
  handler: <slug>Handler,
},
```

**3.** Atualizar [`packages/db/seed.ts`](../packages/db/seed.ts) (array `seedReports`) pra dev ter visibility default ao subir o banco.

### Frontend

**4.** Criar `apps/frontend/src/pages/reports/renderers/<Name>Renderer.tsx`:

```tsx
import type { RunReportResponse } from '@/api/reports'
import { ReportSection } from '../components/ReportSection'
import {
  compareDelta,
  deltaToStatus,
  formatInt,
  formatMoney,
  formatPct,
} from './leadsSummaryHelpers'
import { ComparisonCell } from './ComparisonCell'

interface <Slug>Data {
  period: { from: string; to: string }
  // espelha do backend
}

export function <Name>Renderer({
  result,
}: { result: RunReportResponse<unknown> }): React.ReactElement {
  const data = result.data as <Slug>Data
  return (
    <div className="flex flex-col gap-3">
      <ReportSection title="Bloco principal" defaultOpen>
        {/* tabela / KPIs / etc */}
      </ReportSection>
      <ReportSection title="Bloco auxiliar">
        {/* colapsado por default */}
      </ReportSection>
    </div>
  )
}
```

**5.** Adicionar entry em [`renderers/index.tsx`](../apps/frontend/src/pages/reports/renderers/index.tsx).

**6.** Decidir filtro:
- **Período padrão** → adicionar slug em `SLUGS_WITH_PERIOD_FILTER` em [`ReportRunPage.tsx`](../apps/frontend/src/pages/reports/ReportRunPage.tsx). **Sem form inline.**
- **Params custom** → criar `forms/<Name>Form.tsx` com react-hook-form + Zod, registrar em `forms/index.tsx`. Aparece com botão "Aplicar".

**7.** (Opcional) Labels novos:
- Categoria nova → `categoryLabels.ts`
- Enum no output (sources, statuses, etc) → `leadsSummaryHelpers.ts` (ou novo `<slug>Helpers.ts` se específico)

### Rodar
**8.** Restart `apps/core` — `syncRegistry` cria/atualiza a row em `reports` automaticamente. Nada de migration.

**9.** Pra dev: se o seed já listou o slug, visibility tá pronta. Caso contrário, atualizar `report_tenants`/`report_groups` manualmente ou rerodar `pnpm seed`.

## Anti-patterns

- **Sheet pra execução de relatório** — sempre página dedicada.
- **Form custom com 2 date inputs** — usar `<PeriodFilter>`.
- **Botão "Aplicar" pra filtros de período** — PeriodFilter aplica on-change.
- **KPI cards no topo quando a tabela tem `tfoot`** — duplica informação (decisão revertida no leads.summary).
- **Inventar token de cor pra comparativos** — usar `success`/`primary`/`error` semânticos.
- **`JSON.stringify(result)` no renderer final** — fallback `<pre>` é só pra dev antes do renderer existir; renderer real precisa estar dedicado.
- **Lógica de threshold no backend** — threshold vive no renderer (frontend). Backend devolve números brutos + média.
- **Resolver `period → from/to` no frontend antes de enviar** — backend resolve via `shared/period/`.
- **Categoria hardcoded como string** — usar `REPORT_CATEGORIES` (tipo `ReportCategory`).
- **Schema TS independente do backend** — renderer cast `result.data as <Slug>Data` e os tipos refletem o output (manter espelhado manualmente até zod-to-openapi v4 + drizzle-zod v4 destravarem geração automática). **Quando o backend nomeia campos parecidos em níveis diferentes (ex: `summary.lossRate` vs `daily[].lostRate`), repetir a inconsistência no tipo do renderer** — TS pega na hora se cruzar.

## Apêndice — arquivos de referência

| Tema | Backend | Frontend |
|---|---|---|
| Registry + sync | [`registry.ts`](../apps/core/src/modules/reports/registry.ts), [`syncRegistry.ts`](../apps/core/src/modules/reports/syncRegistry.ts) | — |
| Período | [`shared/period/period.ts`](../apps/core/src/shared/period/period.ts) | [`hooks/usePeriodFilter.ts`](../apps/frontend/src/hooks/usePeriodFilter.ts), [`components/data/PeriodFilter.tsx`](../apps/frontend/src/components/data/PeriodFilter.tsx) |
| Handler de referência | [`handlers/leadsSummary.ts`](../apps/core/src/modules/reports/handlers/leadsSummary.ts) | — |
| Renderer de referência | — | [`renderers/LeadsSummaryRenderer.tsx`](../apps/frontend/src/pages/reports/renderers/LeadsSummaryRenderer.tsx) |
| Helpers de comparativo | — | [`renderers/leadsSummaryHelpers.ts`](../apps/frontend/src/pages/reports/renderers/leadsSummaryHelpers.ts), [`renderers/ComparisonCell.tsx`](../apps/frontend/src/pages/reports/renderers/ComparisonCell.tsx) |
| Shell de impressão | — | [`components/PrintableReport.tsx`](../apps/frontend/src/pages/reports/components/PrintableReport.tsx), [`components/ReportSection.tsx`](../apps/frontend/src/pages/reports/components/ReportSection.tsx) + `@media print` em [`index.css`](../apps/frontend/src/index.css) |
| Categorias | [`registry.ts`](../apps/core/src/modules/reports/registry.ts) (campo `category`) | [`categoryLabels.ts`](../apps/frontend/src/pages/reports/categoryLabels.ts) |
| Permissions | [`shared/permissions/permissions.ts`](../apps/core/src/shared/permissions/permissions.ts) | — |
| Lista + execução | [`reportsRoutes.ts`](../apps/core/src/modules/reports/reportsRoutes.ts), [`ReportsService.ts`](../apps/core/src/modules/reports/ReportsService.ts) | [`ReportsPage.tsx`](../apps/frontend/src/pages/reports/ReportsPage.tsx), [`ReportRunPage.tsx`](../apps/frontend/src/pages/reports/ReportRunPage.tsx) |
