import {
  formQuestions,
  formTemplates,
  type InferSelectModel,
} from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type FormTemplate = InferSelectModel<typeof formTemplates>;
export type FormQuestion = InferSelectModel<typeof formQuestions>;

export const formTemplatesSortSpec = createSortSpec(
  {
    name: formTemplates.name,
    createdAt: formTemplates.createdAt,
    updatedAt: formTemplates.updatedAt,
  },
  { field: 'name', direction: 'asc' }
);

// Enum alinhado ao formQuestionTypeEnum no schema (chat-domain.md §4.3).
export const questionTypeValues = [
  'text',
  'yes_no',
  'multiple_choice',
  'scale',
  'number',
  'date',
] as const;

// =====================================================================
// Templates
// =====================================================================

export const formTemplateResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    description: z.string().nullable(),
    requiredForEvaluation: z.boolean(),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('FormTemplate');

export const createFormTemplateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'Avaliação Laser' }),
    description: z.string().trim().max(5000).nullable().optional(),
    requiredForEvaluation: z.boolean().default(false),
  })
  .openapi('CreateFormTemplateInput');

export type CreateFormTemplateInput = z.infer<typeof createFormTemplateSchema>;

export const updateFormTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    description: z.string().trim().max(5000).nullable().optional(),
    requiredForEvaluation: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateFormTemplateInput');

export type UpdateFormTemplateInput = z.infer<typeof updateFormTemplateSchema>;

export const findFormTemplatesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    q: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
    requiredForEvaluation: z.coerce.boolean().optional(),
  })
  .merge(sortQuerySchema(formTemplatesSortSpec))
  .openapi('FindFormTemplatesQuery');

export type FindFormTemplatesQuery = z.infer<
  typeof findFormTemplatesQuerySchema
>;

export const formTemplateIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export type FormTemplateIdParam = z.infer<typeof formTemplateIdParamSchema>;

// =====================================================================
// Questions (sub-recurso de template)
// =====================================================================

// `options` só faz sentido em multiple_choice e scale. Refine valida isso.
// Aceita array de strings (caso simples: ['I','II','III']) ou objeto livre
// pra estruturas mais ricas (chave→label).
const optionsSchema = z
  .union([z.array(z.string().trim().min(1).max(255)).min(1), z.record(z.unknown())])
  .nullable()
  .optional();

export const formQuestionResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    formTemplateId: z.string().uuid(),
    prompt: z.string(),
    questionType: z.enum(questionTypeValues),
    options: z.unknown().nullable(),
    section: z.string().nullable(),
    position: z.number().int(),
    required: z.boolean(),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('FormQuestion');

export const createFormQuestionSchema = z
  .object({
    prompt: z
      .string()
      .trim()
      .min(1, 'Enunciado obrigatório')
      .max(5000)
      .openapi({ example: 'Qual seu fototipo?' }),
    questionType: z.enum(questionTypeValues),
    options: optionsSchema,
    section: z.string().trim().max(128).nullable().optional(),
    position: z.number().int().min(0).default(0),
    required: z.boolean().default(false),
  })
  .refine(
    (data) => {
      const needsOptions =
        data.questionType === 'multiple_choice' || data.questionType === 'scale';
      const hasOptions =
        data.options !== undefined &&
        data.options !== null &&
        (Array.isArray(data.options)
          ? data.options.length > 0
          : Object.keys(data.options).length > 0);
      if (needsOptions && !hasOptions) return false;
      return true;
    },
    {
      message: 'multiple_choice/scale exigem options',
      path: ['options'],
    }
  )
  .openapi('CreateFormQuestionInput');

export type CreateFormQuestionInput = z.infer<typeof createFormQuestionSchema>;

export const updateFormQuestionSchema = z
  .object({
    prompt: z.string().trim().min(1).max(5000).optional(),
    questionType: z.enum(questionTypeValues).optional(),
    options: optionsSchema,
    section: z.string().trim().max(128).nullable().optional(),
    position: z.number().int().min(0).optional(),
    required: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateFormQuestionInput');

export type UpdateFormQuestionInput = z.infer<typeof updateFormQuestionSchema>;

export const formQuestionIdParamSchema = z.object({
  id: z.string().uuid('ID do template inválido'),
  questionId: z.string().uuid('ID da pergunta inválido'),
});

export type FormQuestionIdParam = z.infer<typeof formQuestionIdParamSchema>;
