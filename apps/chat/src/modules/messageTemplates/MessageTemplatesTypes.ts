import { type InferSelectModel, journeyStageEnum, messageTemplates } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type MessageTemplate = InferSelectModel<typeof messageTemplates>;

// Stages válidos pra `surface_in_stage` — derivados do enum journey_stage do DB.
// Schema do DB usa text[] (flexível); validação forte vive aqui.
const stageValues = journeyStageEnum.enumValues;
const stageSchema = z.enum(stageValues);

const kindSchema = z.enum(['text', 'media']);

// Limite de 4096 chars espelha o teto do WhatsApp pra mensagem de texto.
// Pra templates Meta, o teto efetivo é menor (1024 no body), mas validamos
// no submit pro Meta quando ativarmos esse fluxo.
const bodySchema = z.string().trim().min(1, 'Conteúdo obrigatório').max(4096);

export const messageTemplateResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    body: z.string(),
    kind: kindSchema,
    surfaceInStage: z.array(z.string()).nullable(),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('MessageTemplate');

export const createTemplateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'Lembrete D-1' }),
    body: bodySchema.openapi({
      example: 'Oi {{nome}}, lembrando da sua sessão amanhã às {{hora}}.',
    }),
    kind: kindSchema.default('text'),
    surfaceInStage: z
      .array(stageSchema)
      .default([])
      .openapi({ example: ['lead', 'evaluation'] }),
  })
  .openapi('CreateMessageTemplateInput');

export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;

export const updateTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    body: bodySchema.optional(),
    kind: kindSchema.optional(),
    surfaceInStage: z.array(stageSchema).optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateMessageTemplateInput');

export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;

export const findTemplatesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(20).openapi({ example: 20 }),
    q: z.string().trim().min(1).optional(),
    kind: kindSchema.optional(),
    stage: stageSchema.optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
  })
  .openapi('FindMessageTemplatesQuery');

export type FindTemplatesQuery = z.infer<typeof findTemplatesQuerySchema>;

export const templateIdParamSchema = z.object({
  id: z.string().uuid('ID inválido').openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});
