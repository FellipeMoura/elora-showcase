import type { InferSelectModel, reports } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type Report = InferSelectModel<typeof reports>;

export const reportResponseSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    category: z.string(),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Report');

export const reportSlugParamSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1, 'slug obrigatório')
    .max(128)
    .openapi({ example: 'leads.summary' }),
});

export type ReportSlugParam = z.infer<typeof reportSlugParamSchema>;

// Body do POST /reports/:slug/run — params do relatório. Validado pelo
// `paramsSchema` específico no service (não dá pra registrar um schema
// dinâmico por slug no Zod estático). Aqui é só passthrough.
export const runReportBodySchema = z
  .record(z.unknown())
  .openapi('RunReportParams', {
    description:
      'Parâmetros específicos do relatório. Shape varia por slug — ver ' +
      'GET /reports/{slug} pra schema esperado.',
  });

export type RunReportBody = z.infer<typeof runReportBodySchema>;

// Resposta do POST /reports/:slug/run — shape genérico. data varia por
// relatório; renderer dedicado no frontend conhece o shape de cada slug.
export const runReportResponseSchema = z
  .object({
    meta: z.object({
      generatedAt: z.string().datetime(),
      tenantId: z.string().uuid(),
      userId: z.string().uuid(),
      slug: z.string(),
    }),
    data: z.unknown(),
  })
  .openapi('RunReportResponse');
