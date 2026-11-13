import type {
  JourneySource,
  JourneyStage,
  JourneyStatus,
  LostReason,
} from '@/api/journeys'

// Labels PT-BR pra apresentação. Backend trabalha com os valores em
// inglês (regra de nomenclatura do CLAUDE.md). UI traduz aqui pra ler.

export const STAGE_LABELS: Record<JourneyStage, string> = {
  lead: 'Lead',
  evaluation: 'Avaliação',
  sale: 'Venda',
  treatment: 'Tratamento',
  result: 'Resultado',
}

// Versão compacta pra chips em espaços apertados (ChatSidebarItem,
// listas densas). 'Avaliação'/'Tratamento'/'Resultado' ficam abreviadas
// pra caber sem truncate. 'Lead' e 'Venda' já são curtos o suficiente.
export const STAGE_LABELS_SHORT: Record<JourneyStage, string> = {
  lead: 'Lead',
  evaluation: 'Aval.',
  sale: 'Venda',
  treatment: 'Trat.',
  result: 'Result.',
}

export const STATUS_LABELS: Record<JourneyStatus, string> = {
  active: 'Ativa',
  won: 'Ganha',
  lost: 'Perdida',
}

export const SOURCE_LABELS: Record<JourneySource, string> = {
  whatsapp: 'WhatsApp',
  form: 'Formulário',
  sheets: 'Planilha',
  manual: 'Manual',
  recycling: 'Reciclagem',
  imported: 'Importação',
  other: 'Outro',
}

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  no_show: 'Não compareceu',
  price: 'Preço',
  disqualified: 'Não qualificada',
  timeout: 'Sem retorno',
  quote_rejected: 'Orçamento recusado',
  quote_expired: 'Orçamento expirado',
  other: 'Outro',
}

// Vocabulário canônico de event_type → label PT-BR (chat-domain.md §16.5).
export const EVENT_TYPE_LABELS: Record<string, string> = {
  journey_created: 'Jornada criada',
  stage_transitioned: 'Mudança de estágio',
  marked_won: 'Marcada como ganha',
  marked_lost: 'Marcada como perdida',
  evaluation_created: 'Avaliação criada',
  evaluation_scheduled: 'Avaliação agendada',
  evaluation_done: 'Avaliação realizada',
  form_completed: 'Ficha concluída',
  quote_created: 'Orçamento criado',
  quote_sent: 'Orçamento enviado',
  quote_reverted_to_draft: 'Orçamento voltou para rascunho',
  sale_closed: 'Venda fechada',
  quote_rejected: 'Orçamento recusado',
  treatment_started: 'Tratamento iniciado',
  treatment_completed: 'Tratamento concluído',
  treatment_abandoned: 'Tratamento abandonado',
  treatment_manually_closed: 'Tratamento fechado manualmente',
  recycled_from: 'Reciclada de jornada anterior',
}

export function labelForEventType(eventType: string): string {
  return EVENT_TYPE_LABELS[eventType] ?? eventType
}

// Classes Tailwind por stage — paleta exclusiva (tokens `--journey-*`
// definidos em index.css). Padrão único `bg-X/15 text-X`: a cor do token
// vira tanto o texto quanto o fundo tinted; hierarquia visual emerge do
// chroma/L de cada token, não de variação de pattern. Trocar evaluation/
// treatment pra `text-X-foreground` (preto) quebra no dark — esses tokens
// não têm override em `.dark`, então o foreground preto fica invisível
// sobre o fundo dark. Mantém pattern unificado pra ambos os temas.
export const STAGE_BADGE_CLASS: Record<JourneyStage, string> = {
  lead: 'bg-journey-lead/15 text-journey-lead',
  evaluation: 'bg-journey-evaluation/15 text-journey-evaluation',
  sale: 'bg-journey-sale/15 text-journey-sale',
  treatment: 'bg-journey-treatment/15 text-journey-treatment',
  result: 'bg-journey-result/15 text-journey-result',
}

// Variante sólida pros pinos da strip de jornada (não-tinted) — fundo
// totalmente preenchido com a cor canônica de cada stage, foreground
// derivado do token. Usar com `bg-{stage}` + `text-{stage}-foreground`.
export const STAGE_PIN_CLASS: Record<JourneyStage, string> = {
  lead: 'bg-journey-lead text-journey-lead-foreground',
  evaluation: 'bg-journey-evaluation text-journey-evaluation-foreground',
  sale: 'bg-journey-sale text-journey-sale-foreground',
  treatment: 'bg-journey-treatment text-journey-treatment-foreground',
  result: 'bg-journey-result text-journey-result-foreground',
}

// Variante de cor sólida pra background do conector (linha entre pinos).
// Acompanha a cor do stage que o segmento *deixou* (segmento entre lead e
// evaluation usa cor de lead).
export const STAGE_LINE_CLASS: Record<JourneyStage, string> = {
  lead: 'bg-journey-lead',
  evaluation: 'bg-journey-evaluation',
  sale: 'bg-journey-sale',
  treatment: 'bg-journey-treatment',
  result: 'bg-journey-result',
}

export const STATUS_BADGE_CLASS: Record<JourneyStatus, string> = {
  active: 'bg-info/15 text-info',
  won: 'bg-success/15 text-success',
  lost: 'bg-error/15 text-error',
}

// Mapeia cada eventType pro stage da journey onde ele "vive" — usado pela
// strip horizontal pra distribuir os eventos como dots nos connectors
// (segmento entre dois pinos representa o tempo dentro do stage anterior).
// `null` = evento não é exibido na strip (ruído ou já refletido nos pinos).
export function eventStageOrigin(eventType: string): JourneyStage | null {
  switch (eventType) {
    // lead (stage inicial) — recycled/reopened entram aqui
    case 'recycled_from':
    case 'reopened_from_inbound':
      return 'lead'
    // evaluation
    case 'evaluation_created':
    case 'evaluation_scheduled':
    case 'evaluation_done':
    case 'form_completed':
      return 'evaluation'
    // sale
    case 'quote_created':
    case 'quote_sent':
    case 'quote_reverted_to_draft':
    case 'quote_rejected':
    case 'quote_deleted':
    case 'sale_closed':
      return 'sale'
    // treatment
    case 'treatment_started':
    case 'treatment_completed':
    case 'treatment_abandoned':
    case 'treatment_manually_closed':
      return 'treatment'
    // result — marked_won/lost já estão refletidos no estado do pino result
    // (won = done, lost = lost). Mostrar como dot duplicaria.
    case 'marked_won':
    case 'marked_lost':
      return null
    // ruído / não exibido
    case 'lead_substage_changed':
    case 'journey_created':
    case 'stage_transitioned':
    default:
      return null
  }
}
