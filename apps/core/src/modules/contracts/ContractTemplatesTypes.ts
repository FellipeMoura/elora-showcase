import { contractTemplates, type InferSelectModel } from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type ContractTemplate = InferSelectModel<typeof contractTemplates>;

// Template enriquecido com os procedimentos vinculados (denormalizado pelas
// queries quando `kind='consent_term'`). Outros kinds não têm o campo —
// evita N+1 na subtabela de Settings.
export interface ContractTemplateWithProcedures extends ContractTemplate {
  procedures?: { id: string; name: string }[];
}

export const contractTemplatesSortSpec = createSortSpec(
  {
    name: contractTemplates.name,
    kind: contractTemplates.kind,
    createdAt: contractTemplates.createdAt,
    updatedAt: contractTemplates.updatedAt,
  },
  { field: 'name', direction: 'asc' },
);

const contractKindEnum = z.enum([
  'consent_term',
  'service_contract',
  'image_release',
  'other',
]);

export const contractTemplateResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    kind: contractKindEnum,
    zapsignTemplateId: z.string(),
    // Lista de variáveis do template (ex: ['clientName', 'procedure']).
    // Front usa pra renderizar o form de envio com o conjunto certo de campos.
    variables: z.array(z.string()),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    // Presente só em templates `consent_term` — procedimentos vinculados (Fase 7).
    // Outros kinds omitem o campo. Front renderiza a subtabela em Settings.
    procedures: z
      .array(z.object({ id: z.string().uuid(), name: z.string() }))
      .optional(),
  })
  .openapi('ContractTemplate');

export const createContractTemplateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'Termo de consentimento — depilação a laser' }),
    kind: contractKindEnum.default('consent_term'),
    zapsignTemplateId: z
      .string()
      .trim()
      .min(1, 'ID do template na ZapSign obrigatório')
      .max(64)
      .openapi({
        example: 'a1b2c3d4-e5f6-...',
        description:
          'UUID do template cadastrado no painel ZapSign (Modelos > copiar ID).',
      }),
    variables: z
      .array(z.string().trim().min(1).max(64))
      .default([])
      .openapi({
        example: ['clientName', 'procedure', 'sessionCount'],
        description:
          'Lista de chaves de variáveis que o template ZapSign espera. Usado ' +
          'pelo front pra renderizar o form de envio. Source of truth são as ' +
          'variáveis marcadas no template lá — este array é snapshot pro UX.',
      }),
  })
  .openapi('CreateContractTemplateInput');

export type CreateContractTemplateInput = z.infer<typeof createContractTemplateSchema>;

export const updateContractTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    kind: contractKindEnum.optional(),
    zapsignTemplateId: z.string().trim().min(1).max(64).optional(),
    variables: z.array(z.string().trim().min(1).max(64)).optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateContractTemplateInput');

export type UpdateContractTemplateInput = z.infer<typeof updateContractTemplateSchema>;

export const findContractTemplatesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    q: z.string().trim().min(1).optional(),
    kind: contractKindEnum.optional(),
    active: z.coerce.boolean().optional(),
  })
  .merge(sortQuerySchema(contractTemplatesSortSpec))
  .openapi('FindContractTemplatesQuery');

export type FindContractTemplatesQuery = z.infer<typeof findContractTemplatesQuerySchema>;

export const contractTemplateIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

// =====================================================================
// Endpoints auxiliares pra cadastro de template — usados pelo ZapSign
// inspector no `ContractTemplateSheet` do frontend.
// =====================================================================

export const zapsignTemplateIdParamSchema = z.object({
  zapsignTemplateId: z
    .string()
    .trim()
    .min(1, 'ID do template na ZapSign obrigatório')
    .max(64),
});

export const zapsignPanelInfoResponseSchema = z
  .object({
    panelUrl: z
      .string()
      .url()
      .openapi({ example: 'https://app.zapsign.com.br/conta/modelos' }),
    isSandbox: z.boolean(),
    configured: z.boolean().openapi({
      description: 'False quando o backend está sem token ZapSign — UI deve ' +
        'desabilitar autofetch de variáveis mas pode mostrar o link do painel.',
    }),
  })
  .openapi('ZapsignPanelInfo');

export const zapsignTemplateInfoResponseSchema = z
  .object({
    name: z.string().nullable(),
    variables: z.array(z.string()),
  })
  .openapi('ZapsignTemplateInfo');

export const zapsignTemplateSummarySchema = z
  .object({
    externalTemplateId: z.string(),
    name: z.string(),
  })
  .openapi('ZapsignTemplateSummary');

export const zapsignTemplatesListResponseSchema = z
  .array(zapsignTemplateSummarySchema)
  .openapi('ZapsignTemplatesList');

// =====================================================================
// Vínculo template × procedimento (Fase 7) — só pra templates consent_term.
// =====================================================================

export const linkProcedureBodySchema = z
  .object({
    procedureId: z
      .string()
      .uuid('procedureId inválido')
      .openapi({ example: '99999999-8888-7777-6666-555555555555' }),
  })
  .openapi('LinkProcedureInput');

export type LinkProcedureInput = z.infer<typeof linkProcedureBodySchema>;

// Params do DELETE /contract-templates/:id/procedures/:procedureId.
export const templateProcedureParamsSchema = z.object({
  id: z.string().uuid('ID inválido'),
  procedureId: z.string().uuid('procedureId inválido'),
});

export const templateProceduresResponseSchema = z
  .array(z.object({ id: z.string().uuid(), name: z.string() }))
  .openapi('TemplateProceduresList');
