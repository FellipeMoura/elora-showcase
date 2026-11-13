import {
  clientForms,
  formAnswers,
  type InferSelectModel,
} from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type ClientForm = InferSelectModel<typeof clientForms>;
export type FormAnswer = InferSelectModel<typeof formAnswers>;

export const clientFormStatusValues = ['draft', 'completed', 'archived'] as const;

// =====================================================================
// Ficha preenchida (client_form)
// =====================================================================

export const clientFormResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    evaluationId: z.string().uuid(),
    clientId: z.string().uuid(),
    formTemplateId: z.string().uuid(),
    status: z.enum(clientFormStatusValues),
    filledAt: z.string().datetime().nullable(),
    completedByUserId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ClientForm');

export const createClientFormSchema = z
  .object({
    formTemplateId: z.string().uuid('formTemplateId inválido'),
  })
  .openapi('CreateClientFormInput');

export type CreateClientFormInput = z.infer<typeof createClientFormSchema>;

export const clientIdParamSchema = z.object({
  clientId: z.string().uuid('clientId inválido'),
});

export type ClientIdParam = z.infer<typeof clientIdParamSchema>;

export const evaluationIdParamSchema = z.object({
  evaluationId: z.string().uuid('evaluationId inválido'),
});

export type EvaluationIdParam = z.infer<typeof evaluationIdParamSchema>;

export const clientFormIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export type ClientFormIdParam = z.infer<typeof clientFormIdParamSchema>;

// =====================================================================
// Respostas (form_answers) — upsert em lote
// =====================================================================

export const formAnswerResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    clientFormId: z.string().uuid(),
    questionId: z.string().uuid(),
    answerText: z.string().nullable(),
    answerOption: z.string().nullable(),
    answerBoolean: z.boolean().nullable(),
    answerNumber: z.string().nullable(),
    answerDate: z.string().nullable(),
    answerData: z.record(z.unknown()).nullable(),
    professionalObservation: z.string().nullable(),
    answeredAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('FormAnswer');

// Upsert por (clientFormId, questionId). Cada answer aceita só os campos
// relevantes ao tipo da pergunta — a validação por tipo fica leve aqui
// (cliente é responsável); guard rail forte fica no /complete que valida
// presença de resposta em required questions.
export const answerInputSchema = z
  .object({
    questionId: z.string().uuid(),
    answerText: z.string().trim().max(10000).nullable().optional(),
    answerOption: z.string().trim().max(255).nullable().optional(),
    answerBoolean: z.boolean().nullable().optional(),
    answerNumber: z
      .number()
      .finite()
      .nullable()
      .optional(),
    answerDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar em YYYY-MM-DD')
      .nullable()
      .optional(),
    answerData: z.record(z.unknown()).nullable().optional(),
    professionalObservation: z.string().trim().max(10000).nullable().optional(),
  })
  .refine(
    (data) => {
      // Pelo menos um campo de resposta OU observação (permite anotar sem
      // resposta marcada — pra observações qualitativas).
      const hasValue =
        data.answerText !== undefined ||
        data.answerOption !== undefined ||
        data.answerBoolean !== undefined ||
        data.answerNumber !== undefined ||
        data.answerDate !== undefined ||
        data.answerData !== undefined ||
        data.professionalObservation !== undefined;
      return hasValue;
    },
    { message: 'Pelo menos um campo de resposta ou observação é obrigatório' }
  );

export const upsertAnswersSchema = z
  .object({
    answers: z.array(answerInputSchema).min(1, 'Envie ao menos uma resposta'),
  })
  .openapi('UpsertAnswersInput');

export type UpsertAnswersInput = z.infer<typeof upsertAnswersSchema>;
export type AnswerInput = z.infer<typeof answerInputSchema>;
