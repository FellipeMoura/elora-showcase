# Frontend Design System

Padrões em uso no `apps/frontend`. Documento prático — quando for mexer em UI, ler antes pra reaproveitar o que já existe em vez de duplicar.

## Princípios

1. **Minimalista, achatado.** Aproveita o máximo da tela pra informação. Sem títulos repetidos quando o item de menu já indica a página. Sem descrições "didáticas" que viram ruído depois da curva de aprendizado.
2. **Profundidade via tema.** Fundo da página em bege (token `--page`); toolbar e cards em branco (`bg-background`). Ilhas elevadas sobre uma superfície calma.
3. **Flex layout em cascata, nunca `vh`/`calc(100vh - Npx)`.** A altura cai naturalmente: `h-svh` → `flex-1` → `h-full` → `flex-initial min-h-0`. Mobile-safe sem magic numbers.
4. **Componentes universais antes de ad-hoc.** Toolbar, container, tabela, ações de linha, ordenação — todos têm primitivo pronto. Conferir [Catálogo](#catálogo-de-componentes-universais) antes de inventar.
5. **8 categorias semânticas de cor.** `primary`, `secondary`, `tertiary`, `info`, `success`, `warning`, `error`, `default(=primary)`. Cores fora dessa lista exigem motivo claro.

## Estrutura de pastas (`apps/frontend/src/`)

Organização **flat por tipo**, sem fronteira de domínio. Decisão revisitada em 2026-05-22 — ver [arquitetura.md §17](./arquitetura.md) pra histórico (a separação anterior `core/chat/shared` foi revertida porque a assimetria entre os dois domínios no frontend tornou o custo de manutenção da regra simétrica maior que o ganho).

```
src/
├── app/                       shell + rotas
│   ├── App.tsx
│   ├── AppShell.tsx
│   ├── shell/                 Sidebar, SidebarItem, MobileDrawer, MobileTopBar
│   └── routes/routes.tsx
├── components/                tudo visual junto
│   ├── ui/                    primitivos shadcn (kebab-case)
│   ├── layout/                PageContainer, PageToolbar, SheetContainer, SheetToolbar, LucideIcon
│   ├── data/                  Table, SubTable, RowActions, SortableHeader
│   ├── form/                  TextField, TextArea, SelectField, ComboboxField, MaskedField, MoneyField…
│   ├── auth/                  RequireAuth, LoginForm
│   ├── theme/                 ThemeProvider, ThemeToggle
│   └── chat/                  composer, bolha, ChatSidebarPanel/Item, FloatingChatWindow, MobileChatSheet…
├── pages/                     1 pasta por surface
│   ├── DashboardPage.tsx, LoginPage.tsx, NotFoundPage.tsx
│   ├── clients/, leads/, journeys/, quotes/, appointments/, procedures/, tenants/
│   └── settings/{menus,users,availability,whatsappChannels,PreferencesPage}
├── hooks/                     todos os hooks (use*)
├── api/                       HTTP clients (axios) por recurso
├── lib/                       format, socket, sorting, tenant, utils, chatBridge
├── stores/                    chatStore.ts, uiStore.ts (zustand)
├── main.tsx, index.css, env.d.ts, assets/, config/
```

**Sem regra dura de dependência por domínio.** Qualquer arquivo importa de qualquer outro via `@/<path>`. A organização por tipo (`components`, `pages`, `hooks`, `api`, `lib`, `stores`) é convenção pra encontrar coisas, não isolamento.

**Pasta `components/chat/`.** É a única sub-pasta de domínio dentro de `components/` — agrupa ~17 arquivos de UI específica de WhatsApp (bolhas, composer, sidebar item, janela flutuante). Mantida agrupada porque tem coesão visual e palette própria (`.chat-scope`), não porque está isolada do resto. Componentes que servem tanto chat quanto outras superfícies (avatar, lista de contato) ficam fora dessa pasta — em `components/` direto ou numa sub-pasta neutra (ex: futuro `components/contact/`).

**Pasta `components/`** (sub-organização preservada do design system original):
- `ui/` — primitivos shadcn (kebab-case): `button`, `input`, `popover`, `tooltip`…
- `layout/` — composições estruturais: `PageContainer`, `PageToolbar`, `SheetContainer`, `SheetToolbar`, `LucideIcon`
- `data/` — exibição de dados: `Table`, `SubTable`, `RowActions`, `SortableHeader`
- `form/` — kit de campos de formulário (`TextField`, `TextArea`, `SelectField`, `ComboboxField`, `MaskedField`, `MoneyField`) — ver [Campos de formulário](#campos-de-formulário--componentsform)
- `theme/` — `ThemeProvider`, `ThemeToggle`
- `auth/` — `RequireAuth`, `LoginForm`
- `chat/` — UI específica de WhatsApp (ver acima)

## Tokens (`index.css`)

Tema OKLCH (light em `:root`, dark em `.dark`). 1 token = 1 cor com `-foreground` correspondente:

- **shadcn base**: `background`, `foreground`, `card`, `popover`, `muted`, `accent`, `border`, `input`, `ring`
- **Elora (profundidade)**: `page` + `surface` (ver §"Hierarquia de profundidade" abaixo)
- **Semânticos**: `primary`, `secondary`, `tertiary`, `info`, `success`, `warning`, `error`
- **Variantes "soft" de alerta**: `warning-soft`, `error-soft` — opacas, lightness alta, chroma baixo. Pra **superfícies grandes** em estado de alerta onde alpha sobre pattern (ex: `chat-bg`) ficaria visualmente sujo. Foreground correspondente é texto escuro do mesmo matiz (contraste AA). Hoje usado na bolha outbound com `delivery_status='rejected'` (warning-soft) e `delivery_status='failed'` (error-soft) — ver `MessageBubble`. **Não substitui** `warning`/`error` base, que continuam pra ícones, borders, badges e texto destacado.
- **Alias**: `destructive = error` (compat shadcn)
- **Chat (namespace de produto)**: `chat-accent` (verde médio — avatar, send button, badges unread, active indicators) + `chat-bubble` (verde pastel light / verde escuro dark — bolha outbound estilo WhatsApp). NÃO faz parte das 8 categorias universais — é específico do domínio chat pra separar visualmente do core. Documentado em [arquitetura.md §14](./arquitetura.md).
- **Stages de Journey (`journey-*`) e substages de Lead (`lead-*`)**: paleta exclusiva de funil. NÃO usam os semânticos universais porque precisam de hierarquia visual entre os estados (alguns mais relevantes que outros) — uma reutilização tipo "lead=info, evaluation=primary" achatava todos os stages no mesmo peso. **Valores idênticos em light e dark** (definidos só em `:root`, sem override em `.dark`) — calibração L 0.55–0.75 + chroma variável garante legibilidade nos dois temas. Detalhes na seção [Paleta de funil](#paleta-de-funil-journey-e-lead) abaixo.

Disponíveis como classes Tailwind: `bg-info`, `text-success`, `border-warning`, `bg-error/15` (alpha funciona), `bg-warning-soft text-warning-soft-foreground`. Calibração: editar lightness/chroma/hue em `:root` e `.dark` — todas as classes Tailwind seguem.

### Hierarquia de profundidade — `page` / `surface` / `card`

Três camadas pra construir profundidade percebida sem sombra:

| Camada | Token | Quem usa |
|---|---|---|
| 1 — fundo da página | `bg-page` | Exclusivo do `<PageContainer>` (root da rota autenticada). |
| 2 — agrupador intermediário | `bg-surface` | Containers que agrupam cards mas não são cards eles mesmos: colunas do kanban de leads, painéis sectorizados, faixas de seção dentro de uma página. |
| 3 — superfície elevada | `bg-card` (ou `bg-background`) | Cards individuais, popovers, sheets, formulários — qualquer coisa que "flutua" sobre a camada 2. |

**Regras:**
- Não usar `bg-page/<n>` (opacidade) pra simular camada intermediária — use `bg-surface`. O hack de opacidade tinha sido aplicado no `LeadColumn` antes do token existir, foi removido.
- Não inverter a hierarquia: card sobre surface sobre page. Nunca colocar `bg-surface` dentro de `bg-card` (cria efeito "afundado" estranho).
- No light a diferença `page → surface` é sutil (~1pp de lightness) — proposital. Quem precisa de mais contraste deve revisar se o caso é mesmo "camada intermediária" ou se já é card.
- Adicionar uma 4ª camada (`elevated-card`, `popover-2`) só quando o caso for inevitável — preferir composição (border + shadow) primeiro.

## Escopo de paleta — `.chat-scope`

Mecanismo pra "pintar" superfícies inteiras de chat com a paleta verde sem trocar componente. `.chat-scope` (em [index.css](../apps/frontend/src/index.css)) remapeia `--primary`, `--primary-foreground`, `--accent`, `--accent-foreground` e `--ring` pra versões chat-tinted (light + dark). Mantém intactos os semânticos (`info`/`success`/`warning`/`error`) — eles continuam significando o mesmo nos dois lados do sistema.

```css
.chat-scope {
  --primary: var(--chat-accent);
  --primary-foreground: var(--chat-accent-foreground);
  --accent: oklch(0.95 0.04 158);
  --accent-foreground: oklch(0.205 0 0);
  --ring: var(--chat-accent);
}
.dark .chat-scope { /* ... versão dark ... */ }
```

**Como aplicar.** Coloca `className="chat-scope"` no root do componente/página de chat. Qualquer `<Button>`/`<Input>`/`<Checkbox>` shadcn dentro do escopo renderiza verde automaticamente. Hoje aplicado em [ChatSidebarPanel](../apps/frontend/src/components/chat/ChatSidebarPanel.tsx), [FloatingChatWindow](../apps/frontend/src/components/chat/FloatingChatWindow.tsx) e [MobileChatSheet](../apps/frontend/src/components/chat/MobileChatSheet.tsx). Falta aplicar em `WhatsappChannelsPage` (settings de canal — conteúdo é chat, mas vive em `/settings/whatsapp-channels`); aplique conforme dor visual aparecer.

**Padrão de badge em duas variantes:**
- Categorias com cor vívida (`info`/`success`/`warning`/`error`): `bg-X/15 text-X` — alpha no fundo, cor sólida no texto.
- Categorias de superfície (`tertiary`/`secondary`): `bg-X text-X-foreground` — pareamento clássico shadcn, porque essas têm L≈0.92 (quase branco) em light mode e não funcionam como cor de texto.

**Padrão de superfície grande em alerta** (bolha de mensagem, banner de erro, card com falha): `bg-X-soft text-X-soft-foreground border border-X/40-50`. Diferente do badge porque cobre mais área — alpha sobre wallpaper/pattern fica sujo. Existe em `warning-soft` (atenção/rejeitado) e `error-soft` (falha/erro técnico). Não há `info-soft` ou `success-soft` por enquanto — adicionar quando aparecer caso real.

## Wallpaper de chat — `.chat-bg`

Classe utilitária pra superfícies de conversa (`MessageList`). Usa uma imagem doodle única (`fundo-wpp.jpg`) em ambos os temas — o que muda entre light/dark é a cor de fundo (`--background-chat`) que aparece por baixo. A imagem fica em opacidade reduzida via overlay translúcido da própria cor de fundo:

```css
.chat-bg {
  background-color: var(--background-chat);
  background-image:
    linear-gradient(
      color-mix(in oklab, var(--background-chat) 85%, transparent),
      color-mix(in oklab, var(--background-chat) 85%, transparent)
    ),
    url('/fundo-wpp.jpg');
  background-repeat: repeat;
  background-size: 100% 100%, 480px auto;  /* overlay full, imagem tila */
}
```

Imagem em `apps/frontend/public/fundo-wpp.jpg`. `480px` força tile visível; sem cap, a imagem renderiza fullscreen sem mostrar repetição. Pra ajustar quão sutil fica o pattern, mexe no `85%` do `color-mix` (mais alto = imagem mais apagada).

## Catálogo de componentes universais

### `<PageContainer>` — `components/layout/PageContainer.tsx`

Wrapper raiz de toda página autenticada. Define o ritmo vertical, o respiro nas bordas (`p-1.5`, `gap-1.5`) e reivindica `h-full overflow-hidden` pra cascata de scroll interno funcionar. **Sempre** o root da página.

### `<PageToolbar>` — `components/layout/PageToolbar.tsx`

Barra de ferramentas universal. Compound:
- `.Search` — input de busca, ocupa espaço residual
- `.Filter` — qualquer filtro (ButtonGroup, Select), declara `label`, `minWidth`, `priority`. Colapsa em popover via auto-medição (ResizeObserver) quando o orçamento estoura.
- `.Action` — botão de ação principal, label vira ícone-only no mobile (`hidden sm:inline`)

### `<SheetContainer>` + `<SheetBody>` — `components/layout/SheetContainer.tsx`

Wrappers de layout pra forms em sheet. Paralelizam `PageContainer` no universo dos sheets: definem a cascata flex que mantém a `SheetToolbar` sticky no topo (via `shrink-0`) enquanto o conteúdo rola dentro do `SheetBody` (`flex-1 overflow-y-auto`).

- `SheetContainer` — flex shell `-m-6 flex h-full flex-col` que cancela o `p-6` default do `SheetContent` e reclama o full inner area.
- `SheetBody` — scroll container `min-h-0 flex-1 overflow-y-auto p-6` que absorve o overflow e restaura o padding pra respiro do conteúdo.

**Sempre** usar a combinação `SheetContent hideCloseButton` + `SheetContainer` + `SheetToolbar` + `SheetBody`. Sem `SheetContainer`, a `SheetToolbar` perde o sticky e sobe junto com o scroll. Sem `SheetBody`, o `SheetContent` precisaria de `overflow-y-auto` no className — pattern antigo, agora deprecated.

### `<SheetToolbar>` — `components/layout/SheetToolbar.tsx`

Barra de ferramentas padrão pra **forms em sidebar** (`<Sheet>`). Espelha o papel do `PageToolbar` mas pra superfícies inline/temporárias. Compound:
- `.Action` — botão (label opcional, `type='submit'` aceita `form={FORM_ID}` pra disparar form fora da árvore visual)

Filosofia minimalista: o próprio sheet já sinaliza contexto — sem título redundante ou descrição didática no topo. A toolbar carrega só o essencial (close X + actions). `srTitle` obrigatório (Radix Dialog exige `DialogTitle` pra a11y) renderiza `sr-only`.

Não usa `position: sticky` nem offsets negativos — é apenas um flex item `shrink-0` que depende da cascata flex do `<SheetContainer>` pai pra ficar fixa enquanto o `<SheetBody>` irmão rola.

Texto que antes morava no `SheetDescription` é descartado. Se uma informação for genuinamente load-bearing (ex: contagem de itens, identificador externo), realocar pro corpo do form, não criar legenda no topo.

### `<ButtonGroup>` — `components/ui/button-group.tsx`

Segmented control (radio-style). Genérico no tipo do `value`. Usado em filtros da toolbar.

Aceita prop opcional `optionClassName(value, isActive)` pra sobrescrever o visual de uma opção específica sem tocar nas outras. Cenário canônico: tab CHAT da sidebar em verde (`bg-chat-accent`) quando ativo, enquanto MENU mantém `bg-primary` azul — usado em [Sidebar](../apps/frontend/src/app/shell/Sidebar.tsx).

### Campos de formulário — `components/form/`

Um único visual pra todo campo com rótulo: **outlined com label na notch** (estilo MUI). A label vive na borda superior do campo; em `TextField`/`TextArea` ela desce pra dentro quando vazio e sem foco, em `SelectField`/`ComboboxField` fica fixa na notch (o campo nunca está "vazio"). Todos compartilham `h-12`, `gap-1.5`, bloco de erro/helper em `px-3 text-xs`, `required` com asterisco e `aria-invalid`/`aria-describedby` ligados.

| Campo | Componente | Observação |
|---|---|---|
| Texto, número, data, hora, datetime | `TextField` | `type="date"`/`"time"`/`"datetime-local"` funcionam — label fica sempre na notch porque o browser nunca reporta `:placeholder-shown` nesses tipos |
| Texto longo | `TextArea` | `rows` default 5, `resize-y` |
| Lista fechada | `SelectField` + `SelectItem` | importar `SelectItem` **de `form/SelectField`** (re-export); Radix não aceita `value=""` — use sentinela (`'__none__'`) e traduza no `onValueChange` |
| Busca com lista filtrada | `ComboboxField` | mesma API do `Combobox` (`search`/`onSearchChange`/`selectedLabel`…) + `label`/`error`/`helperText` |
| CPF/CNPJ/telefone/CEP | `MaskedField` | react-hook-form `control` + `name` |
| Dinheiro | `MoneyField` | **Obrigatório pra todo valor monetário** — ver regra abaixo. `compact` pra célula de tabela (sem label) |

**Regra.** Dentro de `<form>`, todo campo com rótulo usa um desses wrappers. **Nunca** `<Label>`/`<label>` + `<Input>`/`<Select>`/`<Combobox>`/`<textarea>`/`<select>` cru — é exatamente isso que gera campos desalinhados lado a lado (um com label na notch, outro com label em cima). O lint (`eslint.config.js`) bloqueia em `src/pages/**` o import de `ui/input`, `ui/select`, `ui/combobox` e o JSX cru de `<textarea>`, `<select>` e `<input>` (exceto `checkbox|radio|color|file|hidden|range`).

**Onde `<Label>` solto continua certo.** Rótulo de grupo (cabeçalho de um bloco de checkboxes, `ButtonGroup`, lista de itens) — ou use `<fieldset>` + `<legend className="px-1 text-sm font-medium">`. Checkbox/Switch com texto ao lado: `<label className="flex items-center gap-2">`.

**Valor monetário = `MoneyField`, sempre.** Preço, valor, desconto em R$, custo, frete, valor de parcela, valor contado no caixa: nunca `TextField`/`Input`/`<input>` com `type="number"` ou `step="0.01"`. O `MoneyField` tem entrada em centavos (o usuário só digita dígitos — não existe vírgula/ponto "errado"), exibe `R$ 1.234,56` e entrega `number` em reais. Dois modos de ligação:

- **react-hook-form** (padrão dos forms): `<MoneyField control={control} name="amount" label="Valor" />`. O campo do form guarda `number`.
- **Controlado** (tela com `useState`, linha de tabela, dialog pequeno): `<MoneyField value={price} onValueChange={setPrice} label="Preço" />`. `value` aceita `number` ou a string decimal da API (`"12.50"`); quem guarda string converte no callback (`onValueChange={(v) => setPrice(v.toFixed(2))}`), e campo opcional volta pra vazio quando zerado (`v > 0 ? v.toFixed(2) : ''`). Form RHF que guarda dinheiro como string usa este modo com `watch`/`setValue`.
- **`compact`** pra célula de tabela/edição inline: sem label (passe `aria-label`), aceita `inputRef` e `onKeyDown` (Enter salva / Esc cancela).

O lint de `pages/**` bloqueia por heurística: campo comum cujo `label`/`aria-label`/`placeholder` fala de dinheiro (preço, valor, custo, desconto, frete, salário, R$) ou com `step="0.01"`. Rótulo com `%` (percentual) e `(m)` (medida) fica de fora. Falso positivo (campo que NÃO é dinheiro) → `eslint-disable-next-line no-restricted-syntax` dizendo o que o campo é. Atenção: o `eslint-disable` de "input compacto em tabela" silencia esta regra junto — em célula de tabela, dinheiro também é `MoneyField compact`.

**Exceções permitidas (com `eslint-disable-next-line` + motivo no comentário).** Filtro em `PageToolbar.Filter`/popover de filtro (primitivo `Select`/`Input`/`Combobox` cru, sem label na notch — o label é o do filtro); input compacto **não monetário** dentro de linha de tabela (`<input type="number">` de quantidade/medida em célula — dinheiro em célula é `MoneyField compact`, sem exceção); `type="color"`/`"file"`.

**Layout lado a lado.** `grid grid-cols-2 gap-3` com dois wrappers — nunca misturar wrapper com primitivo na mesma linha.

### `<Table>` — `components/data/Table.tsx`

Tabela de página padronizada. Junta card branco, scroll wrapper, thead sticky, body, estados (loading/erro/vazio), `footer` opcional e `mobileCard` opcional num único componente.

API declarativa via `columns: TableColumn<T, SF>[]`. Cada coluna tem `key`, `header`, `cell(row)`, opcionalmente `sortField` (header vira `SortableHeader`) e `className` (aplicado em `<th>` E `<td>`). Slots:

- `actions: (row) => RowAction[]` — primeira coluna automática com `RowActions`.
- `renderRowLead: (row) => ReactNode` — coluna ANTES de actions (chevron de expand, checkbox).
- `renderRowAddon: (row, totalCols) => ReactNode` — `<tr>` extra após cada row. `totalCols` passa pro `colSpan` da `<SubTable>`.
- `mobileCard: (row, actions) => ReactNode` — renderer alternativo abaixo do `md:` breakpoint.
- `footer: ReactNode` — wrapper já aplica `border-t` + `flex justify-between`; passar o conteúdo direto.

Substitui o pattern inline antigo (`<div className="rounded-md border…"><table>…`). Quando o caso de uso não couber (dashboard, fullscreen, etc), compor manualmente — mas o catálogo cobre 95% das telas de listagem.

### `<RowActions>` — `components/data/RowActions.tsx`

Ações de linha de tabela. Recebe `actions: RowAction[]` e decide automaticamente:
- ≤ 2 ações → ícones inline com tooltip
- ≥ 3 ações → único `MoreVertical` que abre popover com tudo

Cada ação: `{ label, icon, onClick, destructive?, disabled? }`. **Sempre primeira coluna**, header vazio.

### `<SubTable>` — `components/data/SubTable.tsx`

Tabela aninhada que mora dentro da linha expandida de outra tabela. Recebe o `colSpan` da tabela pai e renderiza `<tr><td colSpan>` envolvendo um cartão com header próprio + linhas, indentado pra reforçar a relação parent → child. API declarativa: `columns: SubTableColumn<T>[]` + `data` + `rowKey` (+ `actions` opcional reaproveitando `RowActions`). Usado em [MenusPage](../apps/frontend/src/pages/settings/menus/MenusPage.tsx) pra mostrar submenus.

### `<SortableHeader>` — `components/data/SortableHeader.tsx`

Substitui `<th>` cru em colunas ordenáveis. Renderiza o `<th>` + button com chevron. Pareado com `useSortState` (cycle tri-state: asc → desc → limpa).

### `<Accordion>` — `components/ui/accordion.tsx`

Radix wrapper (shadcn new-york): `Accordion` + `AccordionItem` + `AccordionTrigger` + `AccordionContent`. Usar pra agrupar listas longas em seções recolhíveis, em vez de toggle `useState` + chevron feito à mão. `type="multiple"` quando o usuário pode querer abrir vários grupos ao mesmo tempo, `type="single" collapsible` quando só faz sentido um aberto por vez. O trigger já traz o chevron; o conteúdo do header vai como `children` do `AccordionTrigger` (pode ter badges/contagens). Animação via `animate-accordion-down|up`, com keyframes em `index.css`. Referência: seção Tratamentos do [ClientDetailPage](../apps/frontend/src/pages/clients/ClientDetailPage.tsx), com um item por procedimento.

### `<Tooltip>` — `components/ui/tooltip.tsx`

Radix wrapper. `TooltipProvider` já está em `app/App.tsx` (delay 300ms) — não instanciar de novo.

### Confirmação e alerta — `useConfirm` — `components/ui/confirm-dialog.tsx`

Substitui `window.confirm`/`window.alert` nativos (bloqueantes, sem estilo, inacessíveis) por um `AlertDialog` Radix. `ConfirmProvider` (`confirm-dialog.tsx`) já está montado em `app/App.tsx` — não instanciar de novo. O hook vive em `components/ui/confirm-context.ts` (separado do provider por causa do Fast Refresh): **importe `useConfirm` de `@/components/ui/confirm-context`**. Camada `z-alert`: cobre Sheet e Dialog.

```tsx
import { useConfirm } from '@/components/ui/confirm-context'

const confirm = useConfirm()

const handleDelete = async () => {
  const ok = await confirm({
    title: 'Excluir item?',
    description: 'Essa ação não pode ser desfeita.',
    confirmLabel: 'Excluir',
    variant: 'destructive',
  })
  if (!ok) return
  // segue com a ação
}
```

`ConfirmOptions`: `title` (obrigatório), `description?`, `confirmLabel?` (default "Confirmar"), `cancelLabel?` (default "Cancelar"), `variant?` — variante do botão de confirmação (sem `variant` = `primary`; também `success`/`warning`/`destructive`/etc., mesmas variantes do `<Button>`). Usar `destructive` pra exclusão/cancelamento permanente, `warning` pra ações com efeito colateral relevante mas reversível, `success` pra confirmação positiva (ex: marcar presença), sem variant pra ações neutras.

**Nunca usar `window.confirm`/`window.alert` em código novo** — bloqueia a thread, não segue o tema, quebra em alguns contextos mobile. Toast (`sonner`, via `toast.success`/`toast.error`) cobre o caso de "alert informativo não-bloqueante"; `useConfirm` cobre o caso de "confirmação antes de ação destrutiva/irreversível".

### `<Switch>` vs `<Checkbox>` — `components/ui/{switch,checkbox}.tsx`

Ambos wrappers Radix com a paleta `--primary` pro estado ativo. Diferença é **semântica**, não visual:

- **`<Switch>`** — toggle de estado binário **independente**, com efeito imediato no comportamento do sistema. Use pra: capacidades profissionais (`canEvaluate`, `canApplyProcedures` no [UserFormSheet](../apps/frontend/src/pages/settings/users/UserFormSheet.tsx)), feature flags, preferências on/off. Form factor "ligado/desligado". Esperado que mudar reflita "agora vale assim".
- **`<Checkbox>`** — marcação que faz parte de uma **seleção** ou de uma **lista** de opções relacionadas. Use pra: vincular usuário a grupos (também no `UserFormSheet`), filtros multi-select, checklist de termos. Form factor "incluir/não incluir". Esperado que múltiplas marcações compõem o input.

Regra rápida: se a label começa com substantivo ("Avaliadora", "Aplicadora") → Switch. Se começa com verbo ou é item de lista paralela ("Administradores", "Gerentes") → Checkbox.

### Shell autenticado — `<AppShell>` + `<Sidebar>` + `<MobileTopBar>`

Layout do app dentro de `RequireAuth`. Mora em `app/`. Sem Header desktop — a sidebar fixa à esquerda hospeda tudo, o conteúdo ganha a faixa de volta.

- **`<AppShell>`** (`app/AppShell.tsx`) — flex column ocupando `h-svh`. Mobile-only top bar em cima, drawer/sidebar+main embaixo. Renderiza `<ChatFloatingPortal>` ao final (janelas flutuantes em z-index alto).
- **`<Sidebar>`** (`app/shell/Sidebar.tsx`) — flex column. Topo: `<ButtonGroup>` MENU/CHAT (badge com `totalUnread` no CHAT). Meio: dois painéis montados sempre, alternados via `display:hidden` — `MenuPanel` (lista de menus do server-driven) e `ChatPanel` (que monta `<ChatSidebarPanel>` de `components/chat/`). Rodapé fixo: `user.name` (link → `/settings/preferences`) + botão `LogOut`. Reutilizado em `<MobileDrawer>` com prop `showTabs={false}` (tabs vivem no mobile top bar).
- **`<MobileTopBar>`** (`app/shell/MobileTopBar.tsx`, h-12, só `md:hidden`) — dois botões: **Menu** e **Chat** (badge unread). Cada toque abre o drawer **e** seleciona o tab correspondente em 1 ação. Se o drawer já está aberto, só troca o tab sem fechar. `relative z-[60]` mantém os botões tappable acima do overlay do drawer (z-50). Substitui o header desktop que existia até 2026-05 (que abrigava `MinimizedBar` + `HudConversations`).
- **`<MobileDrawer>`** (`app/shell/MobileDrawer.tsx`) — Sheet shadcn lateral que envolve `<Sidebar showTabs={false} />` em mobile. Fecha automaticamente ao navegar (via `onNavigate`).

**Pattern de tabs MENU/CHAT** — estado em `useUiStore.sidebarTab` (`'menu' | 'chat'`, não persistido, default `'menu'`). Painéis montados simultaneamente e alternados via `display:hidden` em vez de unmount, pra preservar scroll, input de busca e cache da query ao trocar de tab (re-fetchar é caro, montar não é). Badge de unread no botão CHAT lê `useChatStore.totalUnread`, que é alimentado pelo `<ChatRealtimeBoot>` (fetch inicial de `/conversations` page 1) e incrementado por evento de inbound em conversa não-ativa.

### Color dos canais nos componentes de chat

`whatsapp_channels.color` (hex `#RRGGBB`, nullable) propaga via `Conversation.channel.color`. Aplicado como `border-top: 3px solid {color}` no header da `FloatingChatWindow`.

Inline style (não classe Tailwind) porque a cor vem do DB e arbitrary classes com cor dinâmica não funcionam no Tailwind v4. Quando `color === null`, nenhum style é aplicado e o componente fica com visual default.

### Componentes especializados de chat (`components/chat/`)

Catálogo dos componentes que cobrem o lifecycle de mensagem na tab CHAT da sidebar + janela flutuante. Todos respeitam o token `--chat-bubble` e o helper `avatarColorFromId` pra consistência visual entre sessões.

- **`<ChatSidebarPanel onSelect?>`** — conteúdo do tab CHAT na sidebar. Busca + segmented control (Todas/Não-lidas) + lista virtualizada (@tanstack/react-virtual, 50 itens por página). Click numa conversa chama `chatStore.openConversation(id)` (abre a flutuante) e dispara `onSelect?.()` (fechar o drawer mobile). Wrapper aplica `chat-scope` pra paleta verde nos primitivos shadcn dentro. **Items têm altura variável** (com/sem chip de funil) — o virtualizer usa `measureElement` pra medir cada item via `getBoundingClientRect`, evitando que itens com linha 3 sobreponham o seguinte. `ITEM_HEIGHT_ESTIMATE = 84` cobre só o bootstrap antes da 1ª medição.
- **`<ChatSidebarItem conv, active, onClick>`** — item da lista. **3 linhas:** (1) avatar + nome + VIP badge + timestamp; (2) preview da última mensagem + badge unread; (3) chip do funil — prefere substage quando `currentJourneyStage='lead'` (mais informativo que o "Lead" genérico), cai pro stage nos demais (`evaluation`/`sale`/`treatment`/`result`), some sem journey ativa. Usa `LEAD_SUBSTAGE_BADGE_CLASS` + `LEAD_SUBSTAGE_LABELS_SHORT` ou `STAGE_BADGE_CLASS` + `STAGE_LABELS_SHORT` ([leadSubstageLabels.ts](../apps/frontend/src/pages/leads/leadSubstageLabels.ts) / [journeyLabels.ts](../apps/frontend/src/pages/journeys/journeyLabels.ts)). Barra lateral `bg-chat-accent` indica conversa ativa. Preview via `derivePreview` em [lib/messagePreview.tsx](../apps/frontend/src/lib/messagePreview.tsx) (compartilhado com `LeadCard`).
- **`<ContactAvatar contactId, name, colorSeed, size>`** — avatar do contato. Tenta foto via `useContactProfilePictureUrl` (lazy, staleTime 10min, cai pra inicial colorida em erro/sem foto). `colorSeed` deve ser estável por cliente (ex: `client.id`) pra cor não mudar entre renders. Usado em `ChatSidebarItem` e `LeadCard`.
- **`<MediaPreview message, variant?>`** — renderiza mídia da mensagem conforme `message.mediaType`. Image inline (max 320px) com lightbox fullscreen ao clicar; **audio usa player custom** (play/pause em `bg-chat-accent` + range slider estilizado via `.audio-range` em [index.css](../apps/frontend/src/index.css) com `currentColor` — adapta cor da bolha — + countdown estilo WhatsApp Web); video tem tag HTML nativa com `controls`; document vira card com ícone+download; sticker (`variant='standalone'`) sai sem bolha. Lazy fetch da presigned URL via `useMessageMediaUrl`. **Não voltar pro `<audio controls>` nativo** — pseudo-elementos `::-webkit-media-controls-*` são instáveis entre versões e o tema do widget briga com `bg-chat-bubble`.
- **`<MessageBubble message, fontSize, conversationId?>`** — único ponto de renderização da bolha. Cobre: `text`, `media`, `template`, `system`, `sticker` (sem bolha, alinhado), `call` (notificação centralizada com ícone+status+duração+cor por tom missed/received/declined), `internal_note`. Estados `editedAt` (badge "editada") e `deletedAt` (bolha neutra com texto contextual por `deletionOrigin`). `conversationId` opcional habilita o menu de ações. **Estado de entrega outbound** (`message.deliveryStatus`): `pending` = spinner no canto inferior; `sent` = checkmark cascata (✓ → ✓✓ → ✓✓ ao receber `delivered_at`/`read_at`); `failed` = bolha **error-soft** (vermelho claro) + linha inline com `failure_reason` mapeado pra label PT-BR; `rejected` = bolha **warning-soft** (amarelo claro) + linha inline igual. Ações (editar/apagar) ocultas em `failed`/`rejected` — o que a bolha precisa é correção/retry, não edição.
- **`<MessageActions message, conversationId, onStartEdit>`** — popover "⋯" no canto da bolha (visível on-hover ou enquanto popover aberto). Itens: **Editar** (só `kind='text'`), **Apagar para o cliente**. Confirm dialog modal centralizado pra revoke. Chama `useEditMessage`/`useRevokeMessage`. Caller renderiza só pra outbound não-deletada.
- **`<MessageEditInline message, conversationId, fontSize, onClose>`** — substitui a bolha durante edição. Textarea pré-preenchido + Salvar/Cancelar; Enter salva, Esc cancela. Borda info pra sinalizar estado mutável.
- **`<MessageComposer conversationId>`** — composer estilo WhatsApp Web em pill único (`rounded-3xl border bg-card/70 backdrop-blur-sm`, `focus-within:ring` pulsa o pill inteiro, auto-resize do textarea via `useLayoutEffect`). Layout: `Plus` (anexar) → `EmojiPickerPopover` (lazy via `emoji-picker-react` em chunk separado) → textarea → **slot direito Mic-OR-Send** (Mic quando o textarea está vazio; Send quando há texto ou arquivo). Anexo + áudio gravado caem no mesmo fluxo de `pendingFile` → upload via `useUploadMedia` → send via `useSendMessage`. Caption opcional no textarea. **Sem tempId/optimistic** (revisão 2026-05-26 — ver [arquitetura.md §7.11](./arquitetura.md)): texto e mídia seguem o mesmo caminho — POST recebe a row real com `delivery_status='pending'`, `useSendMessage.onSuccess` injeta no cache via `setQueriesData`, bolha aparece com spinner; worker do backend confirma sucesso/falha via socket `wa.message.status_changed`. Mídia mantém a barra de progresso de upload antes do POST. **Atalho**: Enter envia + refoca; Shift+Enter quebra linha.
- **`<EmojiPickerPopover onSelect, disabled?>`** — botão Smile + Popover com `emoji-picker-react`. Lazy load: o chunk só baixa quando user abre. Tema sincronizado com `useTheme()`. Insere emoji no cursor (preserva posição em multi-line).
- **`<AudioRecorder onComplete, onCancel>`** — captura via `MediaRecorder` nativo (sem deps). Negocia mimeType: webm/opus → webm → mp4 (Safari) → ogg/opus. UI: ponto vermelho pulsante + timer + cancel/check. Cap hard de 5min. Cleanup defensivo no unmount libera o microfone. `onComplete(file)` injeta no fluxo de `pendingFile`.

### Atalhos de teclado do chat flutuante

- **Enter** no `MessageComposer` envia e mantém foco no textarea (deferido via `requestAnimationFrame` pra esperar o `disabled` cair). Shift+Enter quebra linha.
- **Esc** com flutuante aberta chama `closeFloating()` (= mesmo comportamento do botão "X": some). Listener mora em [ChatFloatingPortal](../apps/frontend/src/components/chat/ChatFloatingPortal.tsx), só vive enquanto `open=true`, e respeita `defaultPrevented` — Radix overlays (popover, dialog) e `MessageEditInline` já consomem Esc primeiro, então só fecha quando ninguém mais quis.

### Hooks de chat (`hooks/`)

- `useConversationMessages(conversationId)` + `useSendMessage`, `useEditMessage`, `useRevokeMessage`, `useUploadMedia`, `useMessageMediaUrl` (presigned, staleTime 1h)
- `useContactProfilePictureUrl(contactId)` (staleTime 10min), `useRefreshContactProfilePicture`
- `useChatRealtime` (mount único em `components/chat/ChatRealtimeBoot.tsx`, montado em `app/App.tsx`) — escuta `wa.message.received`, `wa.message.sent`, `wa.message.revoked`, `wa.channel.connection_changed`

### Abrir o chat de fora (bridge + draft)

Telas fora do domínio chat (lista de clientes, card de lead, seção de contratos da venda) abrem o `FloatingChatWindow` sem importar de `components/chat/` — o acoplamento mora no `app/` shell. Peças:

- **`openChatConversation(conversationId, draftText?)`** ([lib/chatBridge.ts](../apps/frontend/src/lib/chatBridge.ts)) — bridge imperativo registrado pelo `AppShell` (que é o único autorizado a colar `core` ↔ `chat`). Antes do registro é no-op + warn. `draftText` opcional pré-preenche o composer.
- **`useOpenClientChat()`** ([hooks/useOpenClientChat.ts](../apps/frontend/src/hooks/useOpenClientChat.ts)) — `{ openClientChat(clientId, draftText?), openingFor }`. Resolve a conversa do cliente (busca o `Client` pra pegar `conversationId`/`whatsappChannelId`, cria lazy via `findOrCreateConversation` se ainda não existe) e abre a flutuante. Use quando a tela só tem o `clientId` (ex: `ContractRow` — o Contract não carrega a conversa). `openingFor` dá spinner/disable no botão. Erro de "cliente sem WhatsApp" vira toast, não quebra.
- **Draft pré-preenchido** — `chatStore.pendingDraft: { conversationId, text } | null`. `openConversation(id, draftText)` o seta; o `MessageComposer` consome **uma vez** (`useEffect` que bate o `conversationId` → `setText` + `clearDraft`, foca e leva o cursor pro fim). Vivo da sessão, não persistido. Operador só revisa e envia. Usado pelo "Abrir conversa no chat" da seção de contratos (manda o link do contrato pronto).

## Padrão de página com tabela

```tsx
<PageContainer>
  <PageToolbar>
    <PageToolbar.Search ... />
    <PageToolbar.Filter ... />
    <PageToolbar.Action ... />
  </PageToolbar>

  <Table<Row, SortField>
    columns={[
      { key: 'name', header: 'Nome', sortField: 'name', cell: (r) => r.name },
      ...
    ]}
    data={items}
    rowKey={(r) => r.id}
    actions={(r) => [...]}
    sortField={sortState.sortBy}
    sortDir={sortState.sortDir}
    onSort={toggleSort}
    isLoading={isLoading}
    isError={isError}
    onRetry={() => refetch()}
    emptyText="..."
    mobileCard={(r, actions) => <li>...</li>}    {/* opcional */}
    footer={<>...paginação...</>}                {/* opcional */}
  />
</PageContainer>
```

Referência: [ClientsPage](../apps/frontend/src/pages/clients/ClientsPage.tsx) (paginação + mobile cards), [MenusPage](../apps/frontend/src/pages/settings/menus/MenusPage.tsx) (`renderRowLead` + `renderRowAddon` com `SubTable`).

## Padrão de página de detalhe

Rotas `/<recurso>/:id` (cliente, jornada, orçamento, venda, etc) seguem o mesmo esqueleto da página com tabela — `<PageToolbar>` no topo (sem `Search`/`Filter`) com voltar como leading action + ações do recurso como trailing — e o conteúdo do detalhe em sections abaixo, com a identificação (cliente/status/badges/links) na primeira section.

```tsx
<PageContainer>
  <PageToolbar>
    <PageToolbar.Action
      icon={<ArrowLeft />}
      onClick={() => navigate('/<recurso>')}
      variant="ghost"
      aria-label="Voltar"
      placement="leading"
    />
    <PageToolbar.Action label="Ação A" icon={<Pencil />} onClick={…} variant="outline" />
    <PageToolbar.Action label="Ação B" icon={<Trash2 />} onClick={…} variant="outline" />
  </PageToolbar>

  <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
    <section className="flex flex-col gap-2 rounded-md border bg-background p-4">
      {/* identificação: nome/cliente + status badge + origem + links externos */}
    </section>

    {/* demais sections (info, timeline, listas, etc) */}
  </div>
</PageContainer>
```

**Regras.**
- Toolbar é a única faixa com ações imperativas. Não recriar header ad-hoc com `<div className="flex … rounded-md border bg-background p-3">` envolvendo back button + título + ações — isso quebra em mobile (botões empilham sobre o título). `PageToolbar` resolve via auto-medição: labels somem em viewport estreito (`hidden sm:inline`), restam só ícones.
- Voltar usa `placement="leading"` + `variant="ghost"` + `aria-label="Voltar"`, sem label visível.
- Trailing actions: variante semântica (`default` pra CTA primário, `outline` pra secundárias). Destrutivas confirmam via `useConfirm` (ver [Confirmação e alerta](#confirmação-e-alerta-useconfirm)) — sem `className="text-error"` (PageToolbar.Action não aceita className).
- A identificação do recurso (nome do cliente, badge de status, links pra recursos correlatos, "somente leitura" quando terminal) mora numa `<section>` logo abaixo da toolbar, **não** dentro dela. Mantém a toolbar com altura fixa e respiro pras ações.
- Conteúdo do detalhe usa `gap-1.5` entre sections (default do design system) e `gap-3` interno em cada section.

Referências: [ClientDetailPage](../apps/frontend/src/pages/clients/ClientDetailPage.tsx) (caso canônico — info section + strip de jornada + grid 2×2), [QuoteDetailPage](../apps/frontend/src/pages/quotes/QuoteDetailPage.tsx) (toolbar dinâmica por status: rascunho × enviado × terminal).

## Padrão de form em sheet

```tsx
const FORM_ID = 'foo-form'

<Sheet open={open} onOpenChange={onOpenChange}>
  <SheetContent side="right" hideCloseButton className="w-full sm:max-w-md">
    <SheetContainer>
      <SheetToolbar srTitle={isEdit ? 'Editar foo' : 'Novo foo'}>
        <SheetToolbar.Action
          label="Cancelar"
          variant="ghost"
          onClick={() => onOpenChange(false)}
          disabled={isSubmitting}
        />
        <SheetToolbar.Action
          label={isSubmitting ? 'Salvando…' : isEdit ? 'Salvar' : 'Criar'}
          type="submit"
          form={FORM_ID}
          disabled={isSubmitting}
        />
      </SheetToolbar>

      <SheetBody>
        <form id={FORM_ID} onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {/* fields */}
        </form>
      </SheetBody>
    </SheetContainer>
  </SheetContent>
</Sheet>
```

**Regras.**
- `SheetContent` **sempre** com `hideCloseButton` — a toolbar já tem o X. Sem `overflow-y-auto` no className — o `SheetBody` gerencia scroll.
- `SheetContainer` envolve toolbar + body. Sem ele, a toolbar sobe junto com o scroll quando o form é maior que a viewport.
- `SheetBody` envolve TODO o conteúdo abaixo da toolbar (forms, badges realocados, blocos extras). É o único scroll container do sheet.
- `srTitle` é o título acessível (sr-only). NÃO renderizar título visual em cima do form.
- Labels curtos no submit: "Salvar" / "Criar" (não "Salvar alterações" / "Criar foo") — a toolbar é estreita.
- Form ganha `id` constante por módulo (`FORM_ID`), submit aponta pra ele via prop `form`. Permite o botão morar fora da árvore do `<form>`.
- Sem botão Cancelar/Submit duplicado no rodapé do form — toda ação primária mora na toolbar.
- Descartar texto da antiga `SheetDescription`. Se algo for genuinamente necessário, vira `helperText` do field ou conteúdo no corpo, nunca legenda no topo.

**Variações.**
- **Subcomponentes com `<form>` próprio** (ex: `CreateForm`/`EditForm` em [TenantFormSheet](../apps/frontend/src/pages/tenants/TenantFormSheet.tsx)): cada subcomponente renderiza seu próprio `<SheetContainer>` envolvendo seu `<SheetToolbar>` + `<SheetBody>`. Pai só renderiza `<Sheet><SheetContent hideCloseButton>` + um dos dois — evita lifting de `isSubmitting`.
- **Estados loading/error** (ex: query falhou): mesma estrutura `SheetContainer + SheetToolbar minimal (só Cancelar) + SheetBody com mensagem` — usuário sempre tem como sair via X ou Cancelar.
- **Detail view sem form** (ex: [LeadDetailSheet](../apps/frontend/src/pages/leads/LeadDetailSheet.tsx)): actions imperativas viram `<SheetToolbar.Action onClick=… />` (sem `type='submit'`/`form`). Conteúdo de leitura vai dentro do `SheetBody` normalmente.
- **Sheet sem ações no topo** (ex: [ChannelConnectionSheet](../apps/frontend/src/pages/settings/whatsappChannels/ChannelConnectionSheet.tsx), [GroupsSheet](../apps/frontend/src/pages/settings/users/GroupsSheet.tsx)): `<SheetToolbar srTitle="…" />` sem children — fica só com o X. Ações contextuais ficam no corpo do `SheetBody`.

Referências: [UnitFormSheet](../apps/frontend/src/pages/settings/units/UnitFormSheet.tsx) (caso canônico — form simples com submit), [TenantFormSheet](../apps/frontend/src/pages/tenants/TenantFormSheet.tsx) (subcomponentes), [LeadDetailSheet](../apps/frontend/src/pages/leads/LeadDetailSheet.tsx) (detail view).

## Padrão de dialog (modal centralizado)

`components/ui/dialog.tsx`. Mesma filosofia de cascata flex dos sheets, só que o `DialogContent` já é o container: coluna flex limitada à viewport (`max-h-[calc(100%-2rem)] w-[calc(100%-2rem)]` — o containing block de um `fixed` é a viewport, então isso não é `vh`), com 1rem de margem em cada lado no mobile. `DialogHeader` e `DialogFooter` são `shrink-0`; **`DialogBody` é a única região rolável** (`min-h-0 min-w-0 flex-1 overflow-y-auto`).

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="max-w-lg">
    <DialogHeader>
      <DialogTitle>…</DialogTitle>
      <DialogDescription>…</DialogDescription>
    </DialogHeader>

    {/* controles fixos (filtros, "selecionar todos") — shrink-0 */}

    <DialogBody>
      {/* lista / Table / mapa — o que pode ficar longo */}
    </DialogBody>

    <DialogFooter>…</DialogFooter>
  </DialogContent>
</Dialog>
```

**Regras.**
- Conteúdo que pode ficar alto (lista de seleção, `Table`, mapa) vai dentro de `DialogBody`. Nunca `max-h-[45vh] overflow-y-auto` numa `div` interna — o body já limita e rola, e o card nunca "vaza" pra fora do dialog.
- `Table` dentro de `DialogBody`: passar `className="flex flex-col"` no body pra ativar o scroll interno da tabela (`flex-initial min-h-0`).
- Form curto (2-4 campos) dispensa `DialogBody` — o `DialogContent` rola como fallback se passar da viewport, e as regras de `p-6`/`gap-4` continuam valendo.
- Largura via `className="max-w-md|lg|2xl|3xl"` no `DialogContent`; sem `w-[95vw]`, `p-0` ou `overflow-hidden` ad-hoc.
- Confirmação destrutiva continua sendo `useConfirm` (AlertDialog), não `Dialog`.
- **Dialog sempre tem prioridade sobre Sheet** (ver [Camadas (z-index)](#camadas-z-index)): abrir um dialog de dentro de um sheet é normal; abrir um sheet de dentro de um dialog não.

O Elora ainda não tem dialogs de página (só `useConfirm`); o primitivo `Dialog` está no kit, sincronizado com o Frostie/Quartzo, pronto pra uso.

## Camadas (z-index)

Escala única em `index.css` (`@utility`), do fundo pro topo. Overlay e content do mesmo componente compartilham o token.

| Token | z | Quem usa |
|---|---|---|
| `z-shell` | 60 | `MobileTopBar`, `MobileDrawer` |
| `z-sheet` | 70 | `Sheet` (overlay + content) |
| `z-dialog` | 80 | `Dialog` (overlay + content) |
| `z-alert` | 90 | `AlertDialog` / `useConfirm` |
| `z-popover` | 100 | `Popover`, `Select`, `Combobox`, `Tooltip` — portalados, precisam abrir de dentro de qualquer overlay acima |

**Regras.**
- **Dialog sempre cobre Sheet, nunca o contrário.** Fluxo "abrir X a partir de um form em sheet" = Dialog (o sheet fica por baixo com o estado preservado). Não abra `<Sheet>` de dentro de `<DialogContent>`: reestruture (dialog aninhado, ou fecha um e abre o outro).
- `useConfirm` cobre tudo: pode ser disparado de dentro de um sheet ou de um dialog.
- Nunca use z-index numérico ≥ 40 (`z-50`, `z-[70]`) em página ou componente de domínio — só os tokens. Para stacking **local** (header sticky de tabela, badge sobre card) `z-0`…`z-30` continuam livres.
- Nunca sobrescreva o z-index do `Overlay`/`Content` de um primitivo via `className`: o `tailwind-merge` troca o token pelo valor solto e o overlay cai atrás do sheet (bug real: `PopoverContent className="z-50"` abrindo atrás de um `Sheet`).
- Camada nova = `@utility z-<nome>` em `index.css` **mantendo a ordem** + linha na tabela acima. Não invente valor intermediário.
- `components/chat/` (chat flutuante, lightbox, `MobileChatSheet`) usa `z-40`/`z-50` próprios, abaixo de shell/sheet/dialog — legado, não copiar esse padrão.

### Enforcement (lint)

`eslint.config.js` bloqueia em `src/pages/**`: `SheetHeader`/`SheetTitle`/`SheetDescription`; `SheetContent` sem `hideCloseButton` ou com `overflow-y-auto`; arquivo com `SheetToolbar` mas sem `SheetContainer`; `DialogContent` com `vh`/`vw`/`p-0`/`overflow-hidden`; `<Sheet>` dentro de `<DialogContent>`; `h-[…vh]`/`max-h-[…vh]` em className; z-index numérico ≥ 40. Em todo o `src/`: `window.confirm`/`alert`/`prompt`. Falso positivo → `eslint-disable-next-line no-restricted-syntax` com o motivo.

## Ordenação dinâmica (cliente + servidor)

Helpers que mantêm os dois lados sincronizados sem duplicar lógica.

**Backend** ([`apps/core/src/shared/sorting/buildSort.ts`](../apps/core/src/shared/sorting/buildSort.ts)):
```ts
export const fooSortSpec = createSortSpec(
  { name: foo.name, createdAt: foo.createdAt },
  { field: 'createdAt', direction: 'desc' }
)
findFooQuerySchema = z.object({...}).merge(sortQuerySchema(fooSortSpec))
const orderBy = resolveSort({ sortBy, sortDir }, fooSortSpec)
```

**Frontend** ([`apps/frontend/src/lib/sorting.ts`](../apps/frontend/src/lib/sorting.ts)):
```tsx
const { state, toggleSort } = useSortState<FooSortField>()
// passa state.sortBy/sortDir no query, e:
<SortableHeader field="name" currentField={state.sortBy} currentDir={state.sortDir} onSort={toggleSort}>
  Nome
</SortableHeader>
```

Whitelist no backend impede SQL injection no nome da coluna. Default sort vive na spec (servidor), frontend não duplica.

## Scrollbar global

Definido em `index.css`. Estado normal: 4px, thumb com 30% de `muted-foreground`. Hover: largura sobe pra 10px e thumb fica 60% opaco. Cor derivada via `color-mix` — segue tema automático.

## Anti-patterns

- **Não usar `vh`/`calc(100vh - Npx)`** em altura de elementos internos. A cascata flex já resolve. Mobile com barra de browser corta `vh`; flex não.
- **Não inventar tokens de cor.** Se a categoria não cabe nas 8 semânticas, repensar antes de adicionar token novo. Exceções existentes hoje: `chat-*` (paleta de domínio chat) e `journey-*` / `lead-*` (paleta de funil — ver [Paleta de funil](#paleta-de-funil-journey-e-lead)). Antes de adicionar uma 3ª paleta exclusiva, conferir se o caso é mesmo "domínio com identidade visual própria" ou se cabe nas semânticas universais com motivo claro.
- **Não usar `bg-destructive`** em código novo — preferir `bg-error` (mesmo valor, semântica alinhada).
- **Não usar `window.confirm`/`window.alert`.** Usar `useConfirm` (ver [Confirmação e alerta](#confirmação-e-alerta-useconfirm)) pra confirmação e `toast` (`sonner`) pra alerta informativo. O lint bloqueia em todo o `src/`.
- **Não usar z-index numérico ≥ 40** (`z-50`, `z-[70]`) fora dos primitivos de overlay — usar os tokens `z-shell|sheet|dialog|alert|popover` (ver [Camadas (z-index)](#camadas-z-index)). Nunca sobrescrever o z-index de `Overlay`/`Content` via `className`.
- **Não abrir `<Sheet>` de dentro de um `<Dialog>`.** Dialog sempre tem prioridade sobre Sheet; o contrário é o fluxo normal.
- **Não criar título de página redundante** (item do menu já indica) nem descrição "didática" sob o título.
- **Não recriar header ad-hoc em página de detalhe** (back button + título + ações num `<div>` único). Usar `<PageToolbar>` como qualquer outra página — ver [Padrão de página de detalhe](#padrão-de-página-de-detalhe). O header inline empilha buttons sobre título em mobile; a toolbar faz auto-medição e mantém só ícones.
- **Não usar `SheetHeader`/`SheetTitle`/`SheetDescription` visíveis em forms.** Sheet de form/cadastro usa `<SheetToolbar srTitle="…">` (title sr-only) — descartar a descrição. `MobileDrawer` é a única exceção (precisa de `SheetTitle` sr-only direto, sem toolbar).
- **Não usar `SheetToolbar` sem `SheetContainer`.** A toolbar fica sticky via cascata flex do container — sem ele, sobe junto com o scroll em forms maiores que a viewport. Mesma regra: `SheetContent` com `SheetContainer` dentro NÃO deve ter `overflow-y-auto` no className (causa double scroll com o `SheetBody`).
- **Não criar generic handlers.** Cada controller backend é explícito (regra geral do projeto, ver CLAUDE.md §3).
- **Não declarar `maxHeight`/`maxWidth` com pixels mágicos** em layouts de tabela. Usar `flex-initial min-h-0` (= height vs maxHeight) que ajusta sozinho.
- **Não montar campo de form com `<Label>` + primitivo cru** (`Input`, `Select`, `Combobox`, `<textarea>`, `<select>`). Todo campo com rótulo passa pelo kit `components/form/` — ver [Campos de formulário](#campos-de-formulário--componentsform). É a causa clássica de dois campos lado a lado com label em altura diferente. O lint bloqueia em `pages/**`; filtro de toolbar e input compacto de tabela justificam em `eslint-disable-next-line`.
- **Não esquecer o `<th aria-label="Ações" />`** em coluna de ações sem texto. Acessibilidade.
- **Não duplicar componente em vez de promover.** Se 2+ páginas precisam do mesmo bloco visual, promove pra `components/` (com sub-pasta de domínio se fizer sentido — ex: `components/contact/`) em vez de copiar.

## Grid de tempo (agenda)

Padrão pra qualquer grid 2D com eixo temporal vertical (agenda principal, vagas de sala, etc). Mora em [CalendarGrid](../apps/frontend/src/pages/appointments/CalendarGrid.tsx); registro arquitetural em [arquitetura.md §18](./arquitetura.md).

**Regra dura — colunas como block container com altura explícita.** Cada coluna recebe `style={{ height: COLUMN_FULL_HEIGHT_PX }}` (header + body em pixels), **não** `flex-col`. Motivo: header `sticky top-0` em flex item com `min-height: auto` + `align-stretch` desgruda após scroll equivalente à viewport (o containing block do sticky resolve pra altura do parent flex, não pra altura real do conteúdo). Block container com altura medida resolve definitivamente.

```tsx
<div className="relative min-w-45 flex-1 border-r" style={{ height: COLUMN_FULL_HEIGHT_PX }}>
  <button className="sticky top-0 z-10 ..." style={{ height: HEADER_HEIGHT_PX }}>...</button>
  <div className="relative" style={{ height: BODY_HEIGHT_PX }}>
    {/* janelas disponíveis (bg-success/10), linhas de hora, cards absolutos */}
  </div>
</div>
```

**Cards absolutos.** Posicionados por `top = (minutos desde GRID_START_HOUR) * PIXELS_PER_MINUTE` dentro do body. Duração vira `height`. Cards podem extrapolar bounds quando o appointment começa antes do grid visível (clipa por overflow do scroll container).

## Paleta de funil (`journey-*` e `lead-*`)

Stages de journey (`lead`, `evaluation`, `sale`, `treatment`, `result`) e substages de lead (`new`, `template`, `contact`, `scheduled`, `no_show`, `rescheduled`, `quoted`) usam paleta **exclusiva**, não os tokens semânticos universais. Tokens em [index.css](../apps/frontend/src/index.css) (prefixos `--journey-*` e `--lead-*`); maps de classes em [journeyLabels.ts](../apps/frontend/src/pages/journeys/journeyLabels.ts) (`STAGE_BADGE_CLASS`, `STAGE_PIN_CLASS`, `STAGE_LINE_CLASS`) e [leadSubstageLabels.ts](../apps/frontend/src/pages/leads/leadSubstageLabels.ts) (`LEAD_SUBSTAGE_BADGE_CLASS`, `LEAD_SUBSTAGE_COLUMN_ACCENT`).

**Por que não reusar `info`/`primary`/etc.** Reutilização achatava todos os estados no mesmo peso visual — `lead=info`, `evaluation=primary`, `scheduled=primary` ficavam visualmente indistintos quanto à importância operacional. A paleta de funil aplica uma hierarquia explícita via chroma:

| Categoria | Estados | Calibração | Intenção |
|---|---|---|---|
| **Relevante** | `journey.lead`, `lead.new`, `lead.contact`, `lead.scheduled` | L 0.55–0.62 + chroma alto (~0.18–0.22) | Puxam o olho. Estados onde mora a operação diária. |
| **Alerta** | `journey.sale`, `lead.rescheduled` | L 0.68–0.70 + chroma alto (~0.18–0.20) em hue laranja (45–55°) | Atenção comercial / ação requerida sem ser "erro". |
| **Soft com identidade** | `journey.evaluation` (salmão, hue 25°), `journey.treatment` (verde água, hue 185°), `lead.template` (cinza neutro) | L alta (0.70–0.78) + chroma médio-baixo (0.03–0.13) | Têm cor reconhecível mas recuam visualmente vs os relevantes. Estados intermediários sem ação imediata. |
| **Conclusão** | `journey.result`, `lead.quoted` | L 0.60–0.62 + chroma médio (~0.14–0.16) em verde (~145°) | Fechamento / sucesso. |
| **Aviso menor** | `lead.no_show` | L 0.75 + chroma médio (~0.13) em amarelo (~80°) | Severidade menor que alerta laranja. |

**Mesmos valores em light e dark.** Tokens definidos só em `:root` (sem override em `.dark`). Calibração com L 0.55–0.75 + chroma moderado garante legibilidade nos dois temas; o pattern de badge `bg-X/15 text-X` aplica alpha sobre o fundo do tema, e os foregrounds são pré-calibrados pra contraste AA quando o token vira fundo sólido (pinos da strip).

**Pattern de badge.** Padrão consistente `bg-X/15 text-X` para os relevantes/alerta/conclusão (texto sólido na cor do token, fundo tinted com alpha). "Soft com identidade" usa `bg-X/20–30 text-X-foreground` porque a cor com L 0.70+ não tem contraste suficiente como cor de texto sobre card branco — o pareamento com `-foreground` (texto escuro) mantém legibilidade enquanto preserva a identidade da cor no fundo.

**Pra adicionar um novo estado.** Decidir a categoria (relevante / alerta / soft / conclusão / aviso), adicionar o token em `:root` no [index.css](../apps/frontend/src/index.css) + a entrada em `@theme inline` + entrada nos maps em `journeyLabels.ts` ou `leadSubstageLabels.ts`. Se for um estado "secundário" no fluxo, default pra soft com identidade; promova pra relevante só quando virar um lugar onde o operador olha primeiro.

## Kanban de leads — composição custom

Caso justificadamente fora do catálogo `PageContainer + Table` (visão paralela por substage). Mora em [LeadsBoardPage](../apps/frontend/src/pages/leads/LeadsBoardPage.tsx), [LeadColumn](../apps/frontend/src/pages/leads/LeadColumn.tsx) e [LeadCard](../apps/frontend/src/pages/leads/LeadCard.tsx).

**Anatomia.**
- `PageContainer > PageToolbar` no topo (busca + filtros idade/origem + ação "Novo lead"); barra de sumário com contagens por substage logo abaixo.
- Trilho horizontal de colunas (`overflow-x-auto`) que renderiza apenas substages com `total > 0` — colunas vazias somem (sumário no toolbar mantém visibilidade).
- Cada `LeadColumn`: `bg-surface` (camada 2 da hierarquia de profundidade), header com label + count, faixa `border-t-[3px]` na cor do substage.
- `LeadCard`: **não-clicável**. Avatar (`ContactAvatar`) + nome + telefone + ícone de source + preview da última mensagem (via `derivePreview` de [lib/messagePreview.tsx](../apps/frontend/src/lib/messagePreview.tsx)) + ações `Detalhe` e `Chat` no rodapé. Sem popover ⋮ — "marcar como perdido" mora apenas no `LeadDetailSheet`.

**Regra "sem resposta" (`lastMessageDirection='inbound'`).** Cards onde a última mensagem da conversa veio do cliente:
1. **Sobem ao topo da coluna** — backend (`LeadsQuery.findCards`) prefixa o `ORDER BY` com `(last_message_direction='inbound') DESC NULLS LAST`. Vale independentemente do `sortBy` escolhido (board ou flat list).
2. **Recebem destaque visual** — borda esquerda `border-l-3 border-l-warning` e preview da mensagem em `font-medium text-foreground` (em vez do muted-foreground padrão).

Detalhe domínio em [chat-domain.md §5.1](./chat-domain.md).

**Sem DnD entre colunas.** Substage é **derivado por cascata idempotente** no backend (`recomputeLeadSubstage` em `@elora/db`). Drag pra mover lead manualmente é falso poder — a próxima inbound/outbound/appointment/quote recalcula. Override admin existe via `PUT /leads/:id/substage` (`LeadDetailSheet`), mas é debug, não fluxo de trabalho.

## Quando o padrão não couber

Se o pattern catalogado aqui não cobre o caso (tela em fullscreen, dashboard com layout único, janela flutuante), criar a composição em `components/layout/` (se for reutilizável) ou direto na pasta da surface em `pages/<x>/` (se é one-off). Justificar em comentário por que o `PageContainer` padrão não foi suficiente. Tudo que servir a 2+ surfaces vira componente reutilizável em `components/` (sub-pasta de domínio se fizer sentido — ex: `components/chat/`, futuro `components/contact/`).
