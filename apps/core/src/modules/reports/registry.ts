import type { z } from '../../shared/openapi/registry.js';
import {
  leadsSummaryHandler,
  leadsSummaryParamsSchema,
} from './handlers/leadsSummary.js';
import {
  salesSummaryHandler,
  salesSummaryParamsSchema,
} from './handlers/salesSummary.js';

// Catálogo de relatórios em código. Fonte da verdade; banco é projeção
// (ver syncRegistry.ts — roda no boot do core).
//
// Adicionar relatório:
//   1. Criar `handlers/xxx.ts` exportando `xxxParamsSchema` + `xxxHandler`
//   2. Adicionar entry abaixo com slug `<domain>.<snake_case_action>`
//   3. Frontend ganha renderer dedicado em pages/reports/renderers/
//
// Remover relatório: tira do registry. No próximo boot, vira `active=false`
// no banco (preservando refs em report_tenants/groups). Visibility fica
// órfã mas a query de listagem filtra `active=true` — relatório some
// silenciosamente da UI sem quebrar dados.

export interface ReportContext {
  tenantId: string;
  userId: string;
}

// `any` (não `unknown`) nos defaults é proposital: handlers concretos têm
// param types específicos, e em posição contravariante `unknown` quebra a
// satisfação do `satisfies Record<string, ReportDefinition>` abaixo.
// `any` é bivariante e contorna a checagem sem perder a tipagem do site
// concreto (o handler em si segue tipado com TParams real).
export interface ReportDefinition<TParams = any, TResult = any> {
  name: string;
  description: string;
  category: string;
  paramsSchema: z.ZodType<TParams>;
  handler: (params: TParams, ctx: ReportContext) => Promise<TResult>;
}

// Categorias canônicas do produto. Adicionar nova categoria = atualizar
// também `CATEGORY_LABELS` no frontend (pages/reports/categoryLabels.ts).
export const reportRegistry = {
  'leads.summary': {
    name: 'Resumo de leads',
    description:
      'Visão consolidada dos leads entrados no período: conversões, perdas, ' +
      'breakdown diário com comparativos vs média, distribuição por origem e ' +
      'motivos de perda.',
    category: 'comercial',
    paramsSchema: leadsSummaryParamsSchema,
    handler: leadsSummaryHandler,
  },
  'sales.summary': {
    name: 'Resumo de vendas',
    description:
      'KPIs de vendas fechadas no período com comparativo vs período ' +
      'anterior de mesma duração. Inclui top procedimentos, distribuição ' +
      'por método de pagamento e performance por vendedor.',
    category: 'comercial',
    paramsSchema: salesSummaryParamsSchema,
    handler: salesSummaryHandler,
  },
} as const satisfies Record<string, ReportDefinition>;

export type ReportSlug = keyof typeof reportRegistry;

export function isReportSlug(value: string): value is ReportSlug {
  return value in reportRegistry;
}

export function getReportDefinition(slug: ReportSlug): ReportDefinition {
  return reportRegistry[slug];
}

export function listRegistrySlugs(): ReportSlug[] {
  return Object.keys(reportRegistry) as ReportSlug[];
}
