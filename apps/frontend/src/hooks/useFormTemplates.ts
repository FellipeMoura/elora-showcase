import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  activateFormTemplate,
  createFormQuestion,
  createFormTemplate,
  deactivateFormTemplate,
  deleteFormQuestion,
  deleteFormTemplate,
  fetchFormQuestions,
  fetchFormTemplateById,
  fetchFormTemplates,
  updateFormQuestion,
  updateFormTemplate,
  type CreateFormQuestionInput,
  type CreateFormTemplateInput,
  type FindFormTemplatesQuery,
  type FormQuestion,
  type FormTemplate,
  type PaginatedFormTemplates,
  type UpdateFormQuestionInput,
  type UpdateFormTemplateInput,
} from '@/api/formTemplates'
import { useMe } from '@/hooks/useMe'

export const FORM_TEMPLATES_QUERY_KEY = ['form-templates'] as const

export function formTemplatesListKey(query: FindFormTemplatesQuery) {
  return [...FORM_TEMPLATES_QUERY_KEY, 'list', query] as const
}

export function formTemplateDetailKey(id: string) {
  return [...FORM_TEMPLATES_QUERY_KEY, 'detail', id] as const
}

export function formTemplateQuestionsKey(templateId: string) {
  return [...FORM_TEMPLATES_QUERY_KEY, 'questions', templateId] as const
}

// =====================================================================
// Templates
// =====================================================================

export function useFormTemplates(query: FindFormTemplatesQuery = {}) {
  const { data: me } = useMe()
  return useQuery<PaginatedFormTemplates, Error>({
    queryKey: formTemplatesListKey(query),
    queryFn: () => fetchFormTemplates(query),
    placeholderData: (prev) => prev,
    enabled: !!me?.user,
    // Templates mudam pouco; staleTime alto evita refetch enquanto admin
    // está digitando perguntas em outra aba.
    staleTime: 5 * 60 * 1000,
  })
}

export function useFormTemplate(id: string | undefined) {
  const { data: me } = useMe()
  return useQuery<FormTemplate, Error>({
    queryKey: formTemplateDetailKey(id ?? ''),
    queryFn: () => fetchFormTemplateById(id as string),
    enabled: !!me?.user && !!id,
    staleTime: 5 * 60 * 1000,
  })
}

function invalidateTemplates(qc: ReturnType<typeof useQueryClient>): void {
  qc.invalidateQueries({ queryKey: FORM_TEMPLATES_QUERY_KEY })
}

export function useCreateFormTemplate() {
  const qc = useQueryClient()
  return useMutation<FormTemplate, Error, CreateFormTemplateInput>({
    mutationFn: (input) => createFormTemplate(input),
    onSuccess: () => invalidateTemplates(qc),
  })
}

export interface UpdateFormTemplateArgs {
  id: string
  input: UpdateFormTemplateInput
}

export function useUpdateFormTemplate() {
  const qc = useQueryClient()
  return useMutation<FormTemplate, Error, UpdateFormTemplateArgs>({
    mutationFn: ({ id, input }) => updateFormTemplate(id, input),
    onSuccess: () => invalidateTemplates(qc),
  })
}

export function useDeactivateFormTemplate() {
  const qc = useQueryClient()
  return useMutation<FormTemplate, Error, string>({
    mutationFn: (id) => deactivateFormTemplate(id),
    onSuccess: () => invalidateTemplates(qc),
  })
}

export function useActivateFormTemplate() {
  const qc = useQueryClient()
  return useMutation<FormTemplate, Error, string>({
    mutationFn: (id) => activateFormTemplate(id),
    onSuccess: () => invalidateTemplates(qc),
  })
}

export function useDeleteFormTemplate() {
  const qc = useQueryClient()
  return useMutation<void, Error, string>({
    mutationFn: (id) => deleteFormTemplate(id),
    onSuccess: () => invalidateTemplates(qc),
  })
}

// =====================================================================
// Questions
// =====================================================================

export function useFormQuestions(templateId: string | undefined) {
  const { data: me } = useMe()
  return useQuery<{ items: FormQuestion[] }, Error>({
    queryKey: formTemplateQuestionsKey(templateId ?? ''),
    queryFn: () => fetchFormQuestions(templateId as string),
    enabled: !!me?.user && !!templateId,
    staleTime: 2 * 60 * 1000,
  })
}

function invalidateQuestions(
  qc: ReturnType<typeof useQueryClient>,
  templateId: string,
): void {
  qc.invalidateQueries({ queryKey: formTemplateQuestionsKey(templateId) })
}

export interface CreateFormQuestionArgs {
  templateId: string
  input: CreateFormQuestionInput
}

export function useCreateFormQuestion() {
  const qc = useQueryClient()
  return useMutation<FormQuestion, Error, CreateFormQuestionArgs>({
    mutationFn: ({ templateId, input }) => createFormQuestion(templateId, input),
    onSuccess: (_q, { templateId }) => invalidateQuestions(qc, templateId),
  })
}

export interface UpdateFormQuestionArgs {
  templateId: string
  questionId: string
  input: UpdateFormQuestionInput
}

export function useUpdateFormQuestion() {
  const qc = useQueryClient()
  return useMutation<FormQuestion, Error, UpdateFormQuestionArgs>({
    mutationFn: ({ templateId, questionId, input }) =>
      updateFormQuestion(templateId, questionId, input),
    onSuccess: (_q, { templateId }) => invalidateQuestions(qc, templateId),
  })
}

export interface DeleteFormQuestionArgs {
  templateId: string
  questionId: string
}

export function useDeleteFormQuestion() {
  const qc = useQueryClient()
  return useMutation<void, Error, DeleteFormQuestionArgs>({
    mutationFn: ({ templateId, questionId }) =>
      deleteFormQuestion(templateId, questionId),
    onSuccess: (_v, { templateId }) => invalidateQuestions(qc, templateId),
  })
}
