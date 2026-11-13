import {
  and,
  asc,
  clientForms,
  desc,
  eq,
  formAnswers,
  formQuestions,
  inArray,
  sql,
  type Tx,
} from '@elora/db';
import type {
  AnswerInput,
  ClientForm,
  FormAnswer,
} from './ClientFormsTypes.js';

interface CreateInput {
  evaluationId: string;
  clientId: string;
  formTemplateId: string;
}

export const ClientFormsQuery = {
  // client_forms ------------------------------------------------------

  findByClient: async (tx: Tx, clientId: string): Promise<ClientForm[]> => {
    return tx
      .select()
      .from(clientForms)
      .where(eq(clientForms.clientId, clientId))
      .orderBy(desc(clientForms.updatedAt));
  },

  findByEvaluation: async (
    tx: Tx,
    evaluationId: string
  ): Promise<ClientForm[]> => {
    return tx
      .select()
      .from(clientForms)
      .where(eq(clientForms.evaluationId, evaluationId))
      .orderBy(desc(clientForms.updatedAt));
  },

  findById: async (tx: Tx, id: string): Promise<ClientForm | undefined> => {
    const [row] = await tx
      .select()
      .from(clientForms)
      .where(eq(clientForms.id, id))
      .limit(1);
    return row;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<ClientForm> => {
    const [row] = await tx
      .insert(clientForms)
      .values({
        tenantId,
        evaluationId: input.evaluationId,
        clientId: input.clientId,
        formTemplateId: input.formTemplateId,
        status: 'draft',
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir client_form');
    return row;
  },

  setStatus: async (
    tx: Tx,
    id: string,
    status: 'draft' | 'completed' | 'archived',
    extras?: { filledAt?: Date | null; completedByUserId?: string | null }
  ): Promise<ClientForm | undefined> => {
    const set: Record<string, unknown> = { status };
    if (extras?.filledAt !== undefined) set.filledAt = extras.filledAt;
    if (extras?.completedByUserId !== undefined)
      set.completedByUserId = extras.completedByUserId;

    const [row] = await tx
      .update(clientForms)
      .set(set)
      .where(eq(clientForms.id, id))
      .returning();
    return row;
  },

  // form_answers ------------------------------------------------------

  findAnswersByForm: async (
    tx: Tx,
    clientFormId: string
  ): Promise<FormAnswer[]> => {
    return tx
      .select()
      .from(formAnswers)
      .where(eq(formAnswers.clientFormId, clientFormId))
      .orderBy(asc(formAnswers.createdAt));
  },

  // Upsert em lote — usa ON CONFLICT (clientFormId, questionId) DO UPDATE.
  upsertAnswers: async (
    tx: Tx,
    tenantId: string,
    clientFormId: string,
    answers: AnswerInput[]
  ): Promise<FormAnswer[]> => {
    if (answers.length === 0) return [];

    // Build rows pro insert. Drizzle decimal aceita string — convertemos
    // answerNumber pra string (decimal(18,4)).
    const now = new Date();
    const rows = answers.map((a) => ({
      tenantId,
      clientFormId,
      questionId: a.questionId,
      answerText: a.answerText ?? null,
      answerOption: a.answerOption ?? null,
      answerBoolean: a.answerBoolean ?? null,
      answerNumber:
        a.answerNumber !== undefined && a.answerNumber !== null
          ? a.answerNumber.toString()
          : null,
      answerDate: a.answerDate ?? null,
      answerData: a.answerData ?? null,
      professionalObservation: a.professionalObservation ?? null,
      answeredAt: now,
    }));

    const result = await tx
      .insert(formAnswers)
      .values(rows)
      .onConflictDoUpdate({
        target: [formAnswers.clientFormId, formAnswers.questionId],
        set: {
          answerText: sql`excluded.answer_text`,
          answerOption: sql`excluded.answer_option`,
          answerBoolean: sql`excluded.answer_boolean`,
          answerNumber: sql`excluded.answer_number`,
          answerDate: sql`excluded.answer_date`,
          answerData: sql`excluded.answer_data`,
          professionalObservation: sql`excluded.professional_observation`,
          answeredAt: sql`excluded.answered_at`,
        },
      })
      .returning();
    return result;
  },

  // Resolve required questions de um template e indica quais já têm
  // resposta não-vazia no client_form. Usado pelo /complete pra validar.
  findUnansweredRequired: async (
    tx: Tx,
    formTemplateId: string,
    clientFormId: string
  ): Promise<string[]> => {
    // Pega IDs das required+active questions do template.
    const required = await tx
      .select({ id: formQuestions.id })
      .from(formQuestions)
      .where(
        and(
          eq(formQuestions.formTemplateId, formTemplateId),
          eq(formQuestions.required, true),
          eq(formQuestions.active, true)
        )
      );
    if (required.length === 0) return [];

    const requiredIds = required.map((r) => r.id);

    // Pega answers existentes no client_form que cubram as required.
    const answered = await tx
      .select({ questionId: formAnswers.questionId })
      .from(formAnswers)
      .where(
        and(
          eq(formAnswers.clientFormId, clientFormId),
          inArray(formAnswers.questionId, requiredIds),
          // "Não vazio" = pelo menos um campo de resposta preenchido. Observação
          // sozinha NÃO conta como resposta pra fins de required.
          sql`(
            ${formAnswers.answerText} IS NOT NULL OR
            ${formAnswers.answerOption} IS NOT NULL OR
            ${formAnswers.answerBoolean} IS NOT NULL OR
            ${formAnswers.answerNumber} IS NOT NULL OR
            ${formAnswers.answerDate} IS NOT NULL OR
            ${formAnswers.answerData} IS NOT NULL
          )`
        )
      );
    const answeredIds = new Set(answered.map((a) => a.questionId));
    return requiredIds.filter((id) => !answeredIds.has(id));
  },
};
