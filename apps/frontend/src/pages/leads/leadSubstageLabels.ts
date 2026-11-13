import type { LeadSubstage } from '@/api/leads'

// Labels PT-BR pra apresentação. Backend trabalha com os valores em inglês
// (regra de nomenclatura do CLAUDE.md). UI traduz aqui pra ler.

export const LEAD_SUBSTAGE_LABELS: Record<LeadSubstage, string> = {
  new: 'Novos',
  // Variable name (`template`) preservado por compatibilidade — o estado
  // representa "outbound enviado, sem inbound posterior", aplicável a
  // canais Baileys (texto livre) tanto quanto Cloud (template literal).
  template: 'Aguardando resposta',
  contact: 'Em contato',
  scheduled: 'Avaliação agendada',
  no_show: 'Não compareceram',
  rescheduled: 'Reagendados',
  quoted: 'Com orçamento',
}

// Versão singular pra inline status (badge em card, drawer header).
export const LEAD_SUBSTAGE_LABELS_SHORT: Record<LeadSubstage, string> = {
  new: 'Novo',
  template: 'Aguardando',
  contact: 'Em contato',
  scheduled: 'Agendado',
  no_show: 'No-show',
  rescheduled: 'Reagendado',
  quoted: 'Orçamento',
}

// Classes Tailwind por substage — paleta exclusiva (tokens `--lead-*`
// definidos em index.css). Hierarquia visual:
//   - RELEVANTES (chroma alto, puxam o olho): `new` (azul vivo), `contact`
//     (ciano destaque), `scheduled` (violeta destaque). São os estados de
//     ação diária no kanban — onde o operador precisa olhar primeiro.
//   - SUBDUED (chroma baixo, recuam): `template` (cinza neutro) — estado
//     "aguardando" sem ação requerida do operador.
//   - ALERTA (hue laranja/amber): `rescheduled` (laranja, requer
//     reagendamento ativo), `no_show` (amarelo, severidade menor).
//   - CONCLUSÃO: `quoted` (verde, próximo do fechamento).
// Padrão consistente `bg-X/15 text-X`: o destaque vem do chroma do token,
// não de variação de pattern.
export const LEAD_SUBSTAGE_BADGE_CLASS: Record<LeadSubstage, string> = {
  new: 'bg-lead-new/15 text-lead-new',
  template: 'bg-lead-template/15 text-lead-template',
  contact: 'bg-lead-contact/15 text-lead-contact',
  scheduled: 'bg-lead-scheduled/15 text-lead-scheduled',
  no_show: 'bg-lead-no-show/15 text-lead-no-show',
  rescheduled: 'bg-lead-rescheduled/15 text-lead-rescheduled',
  quoted: 'bg-lead-quoted/15 text-lead-quoted',
}

// Cor da borda superior do header de coluna no kanban. Reflete a paleta
// exclusiva de cada substage mas sem alpha (linha sólida fina).
export const LEAD_SUBSTAGE_COLUMN_ACCENT: Record<LeadSubstage, string> = {
  new: 'border-t-lead-new',
  template: 'border-t-lead-template',
  contact: 'border-t-lead-contact',
  scheduled: 'border-t-lead-scheduled',
  no_show: 'border-t-lead-no-show',
  rescheduled: 'border-t-lead-rescheduled',
  quoted: 'border-t-lead-quoted',
}
