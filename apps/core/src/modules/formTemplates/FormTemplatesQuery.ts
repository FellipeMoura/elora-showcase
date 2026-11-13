import {
  and,
  asc,
  eq,
  formQuestions,
  formTemplates,
  searchInColumns,
  sql,
  type SQL,
  type Tx,
} from '@elora/db';
import type {
  CreateFormQuestionInput,
  CreateFormTemplateInput,
  FormQuestion,
  FormTemplate,
  UpdateFormQuestionInput,
  UpdateFormTemplateInput,
} from './FormTemplatesTypes.js';

interface FindTemplatesFilters {
  q?: string;
  active?: boolean;
  requiredForEvaluation?: boolean;
}

interface Pagination {
  page: number;
  pageSize: number;
}

export const FormTemplatesQuery = {
  // Templates ---------------------------------------------------------

  findTemplatesPaginated: async (
    tx: Tx,
    filters: FindTemplatesFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: FormTemplate[]; total: number }> => {
    const where = and(
      searchInColumns(filters.q, formTemplates.name),
      filters.active !== undefined ? eq(formTemplates.active, filters.active) : undefined,
      filters.requiredForEvaluation !== undefined
        ? eq(formTemplates.requiredForEvaluation, filters.requiredForEvaluation)
        : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(formTemplates)
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(formTemplates)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findTemplateById: async (
    tx: Tx,
    id: string
  ): Promise<FormTemplate | undefined> => {
    const [row] = await tx
      .select()
      .from(formTemplates)
      .where(eq(formTemplates.id, id))
      .limit(1);
    return row;
  },

  createTemplate: async (
    tx: Tx,
    tenantId: string,
    input: CreateFormTemplateInput
  ): Promise<FormTemplate> => {
    const [row] = await tx
      .insert(formTemplates)
      .values({
        tenantId,
        name: input.name,
        description: input.description ?? null,
        requiredForEvaluation: input.requiredForEvaluation,
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir form_template');
    return row;
  },

  updateTemplate: async (
    tx: Tx,
    id: string,
    patch: UpdateFormTemplateInput
  ): Promise<FormTemplate | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.description !== undefined) set.description = patch.description;
    if (patch.requiredForEvaluation !== undefined)
      set.requiredForEvaluation = patch.requiredForEvaluation;

    const [row] = await tx
      .update(formTemplates)
      .set(set)
      .where(eq(formTemplates.id, id))
      .returning();
    return row;
  },

  setTemplateActive: async (
    tx: Tx,
    id: string,
    active: boolean
  ): Promise<FormTemplate | undefined> => {
    const [row] = await tx
      .update(formTemplates)
      .set({ active })
      .where(eq(formTemplates.id, id))
      .returning();
    return row;
  },

  deleteTemplate: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(formTemplates)
      .where(eq(formTemplates.id, id))
      .returning({ id: formTemplates.id });
    return deleted.length > 0;
  },

  // Questions ---------------------------------------------------------

  findQuestionsByTemplate: async (
    tx: Tx,
    templateId: string
  ): Promise<FormQuestion[]> => {
    return tx
      .select()
      .from(formQuestions)
      .where(eq(formQuestions.formTemplateId, templateId))
      .orderBy(asc(formQuestions.position), asc(formQuestions.createdAt));
  },

  findQuestionById: async (
    tx: Tx,
    questionId: string
  ): Promise<FormQuestion | undefined> => {
    const [row] = await tx
      .select()
      .from(formQuestions)
      .where(eq(formQuestions.id, questionId))
      .limit(1);
    return row;
  },

  createQuestion: async (
    tx: Tx,
    tenantId: string,
    templateId: string,
    input: CreateFormQuestionInput
  ): Promise<FormQuestion> => {
    const [row] = await tx
      .insert(formQuestions)
      .values({
        tenantId,
        formTemplateId: templateId,
        prompt: input.prompt,
        questionType: input.questionType,
        options: input.options ?? null,
        section: input.section ?? null,
        position: input.position,
        required: input.required,
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir form_question');
    return row;
  },

  updateQuestion: async (
    tx: Tx,
    questionId: string,
    patch: UpdateFormQuestionInput
  ): Promise<FormQuestion | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.prompt !== undefined) set.prompt = patch.prompt;
    if (patch.questionType !== undefined) set.questionType = patch.questionType;
    if (patch.options !== undefined) set.options = patch.options;
    if (patch.section !== undefined) set.section = patch.section;
    if (patch.position !== undefined) set.position = patch.position;
    if (patch.required !== undefined) set.required = patch.required;

    const [row] = await tx
      .update(formQuestions)
      .set(set)
      .where(eq(formQuestions.id, questionId))
      .returning();
    return row;
  },

  deleteQuestion: async (tx: Tx, questionId: string): Promise<boolean> => {
    const deleted = await tx
      .delete(formQuestions)
      .where(eq(formQuestions.id, questionId))
      .returning({ id: formQuestions.id });
    return deleted.length > 0;
  },
};
