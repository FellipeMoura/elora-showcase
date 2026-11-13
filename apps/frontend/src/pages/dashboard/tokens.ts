// Paleta e helpers visuais compartilhados pelos charts do dashboard. Mantém
// consistência de cor entre blocos (a mesma série usa a mesma cor em todos
// os gráficos). Ver mapeamento em docs/dashboard-domain.md ("Tokens de cor
// por série").
//
// IMPORTANTE: os tokens do design system são OKLCH (não HSL) e a CSS var
// guarda a COR COMPLETA (`oklch(...)`), não componentes de canal. Por isso
// usamos `var(--token)` direto como string de cor — NÃO `hsl(var(--token))`
// (o exemplo do implementation.md está desatualizado pra este repo). SVG
// fill/stop-color resolvem CSS vars nativamente nos browsers-alvo.

// Cores das séries. `var(--token)` resolve pro valor OKLCH do tema atual
// (light/dark) em tempo de render — charts acompanham o ThemeProvider sem
// recomputar.
//
// Nota de desvio: o domain.md mapeia "Avaliações → accent", mas neste design
// system `--accent` é um cinza neutro (usado como hover bg), invisível como
// série de chart. Usamos `--journey-evaluation` (salmão, a cor de identidade
// real de avaliação no funil) no lugar. Reavaliar no PR 5 (funil).
export const dashboardSeriesColors = {
  leads: 'var(--primary)',
  salesCount: 'var(--success)',
  salesAmount: 'var(--info)',
  evaluations: 'var(--journey-evaluation)',
  lost: 'var(--destructive)',
  pending: 'var(--warning)',
} as const

export type DashboardSeriesKey = keyof typeof dashboardSeriesColors

// Definição de gradiente linear pro Nivo (`defs` + `fill`). Vai do tom cheio
// (60% de opacidade no topo) ao transparente na base — efeito de área suave
// usado no Evolution Chart e nos sub-charts de linha.
export interface NivoLinearGradientDef {
  id: string
  type: 'linearGradient'
  colors: Array<{ offset: number; color: string; opacity: number }>
}

export function gradientDef(id: string, color: string): NivoLinearGradientDef {
  return {
    id,
    type: 'linearGradient',
    colors: [
      { offset: 0, color, opacity: 0.6 },
      { offset: 100, color, opacity: 0 },
    ],
  }
}

// Superfície "glass" compartilhada por todos os cards/painéis do dashboard
// (KPI cards, charts, listas). Centralizada pra consistência — tokens adaptam
// a light/dark sozinhos. Exceção ao <Card> shadcn, documentada no domain.md.
export const glassSurface =
  'rounded-xl border border-border/40 bg-card/60 backdrop-blur-xl shadow-[0_4px_24px_-8px_rgba(0,0,0,0.08)]'

// Hover sutil pros KPI cards (lift + sombra mais profunda). Respeita
// prefers-reduced-motion. Usado só nos cards pequenos — painéis grandes
// (charts full-width) não levitam.
export const glassHover =
  'transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_30px_-8px_rgba(0,0,0,0.16)] motion-reduce:transition-none motion-reduce:hover:translate-y-0'

// Theme compartilhado pros charts Nivo. Defaults do Nivo são `#ddd` pras
// linhas de grade e `#777` pros ticks de eixo — calibrados pra tema claro,
// ficam com contraste invertido no dark (grade berrante, ticks apagados).
// Aqui derivamos tudo de tokens semânticos via `color-mix` pra adaptar:
//   - grid.line: foreground com 8% — quase invisível em light, sutil em dark
//   - axis ticks text: foreground com 70% — leitura clara nos dois temas
//   - legend text: idem ticks
// CSS vars resolvem em tempo de render (via SVG), igual ao resto dos
// charts — não precisa observar tema.
export const nivoTheme = {
  background: 'transparent',
  text: { fontSize: 11, fill: 'color-mix(in oklab, var(--foreground) 70%, transparent)' },
  axis: {
    domain: { line: { stroke: 'transparent', strokeWidth: 0 } },
    ticks: {
      line: { stroke: 'transparent', strokeWidth: 0 },
      text: { fontSize: 11, fill: 'color-mix(in oklab, var(--foreground) 70%, transparent)' },
    },
    legend: {
      text: { fontSize: 11, fill: 'color-mix(in oklab, var(--foreground) 70%, transparent)' },
    },
  },
  grid: {
    line: {
      stroke: 'color-mix(in oklab, var(--foreground) 8%, transparent)',
      strokeWidth: 1,
    },
  },
  legends: {
    text: { fontSize: 11, fill: 'color-mix(in oklab, var(--foreground) 70%, transparent)' },
  },
} as const
