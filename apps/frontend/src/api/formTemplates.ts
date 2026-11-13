import { coreApi } from '@/api/client'

// Espelha apps/core/src/modules/formTemplates/FormTemplatesTypes.ts.
// Forms = anamneses customizáveis por tenant. Tenant define template (com N
// perguntas tipadas), cliente preenche uma ficha por template.

export type QuestionType =
  | 'text'
  | 'yes_no'
  | 'multiple_choice'
  | 'scale'
  | 'number'
  | 'date'

export const QUESTION_TYPES: readonly QuestionType[] = [
  'text',
  'yes_no',
  'multiple_choice',
  'scale',
  'number',
  'date',
] as const

export interface FormTemplate {
  id: string
  tenantId: string
  name: string
  description: string | null
  requiredForEvaluation: boolean
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface FormQuestion {
  id: string
  tenantId: string
  formTemplateId: string
  prompt: string
  questionType: QuestionType
  // Backend aceita string[] (caso simples) ou Record<string, unknown>. Frontend
  // V1 só monta/consome string[]; objetos livres ficam como passthrough.
  options: string[] | Record<string, unknown> | null
  section: string | null
  position: number
  required: boolean
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateFormTemplateInput {
  name: string
  description?: string | null
  requiredForEvaluation?: boolean
}

export interface UpdateFormTemplateInput {
  name?: string
  description?: string | null
  requiredForEvaluation?: boolean
}

export interface FindFormTemplatesQuery {
  page?: number
  pageSize?: number
  q?: string
  status?: 'active' | 'inactive' | 'all'
  requiredForEvaluation?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export interface PaginatedFormTemplates {
  items: FormTemplate[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface CreateFormQuestionInput {
  prompt: string
  questionType: QuestionType
  options?: string[] | Record<string, unknown> | null
  section?: string | null
  position?: number
  required?: boolean
}

export interface UpdateFormQuestionInput {
  prompt?: string
  questionType?: QuestionType
  options?: string[] | Record<string, unknown> | null
  section?: string | null
  position?: number
  required?: boolean
}

// =====================================================================
// Templates
// =====================================================================

export async function fetchFormTemplates(
  query: FindFormTemplatesQuery = {},
): Promise<PaginatedFormTemplates> {
  const res = await coreApi.get<PaginatedFormTemplates>('/form-templates', {
    params: query,
  })
  return res.data
}

export async function fetchFormTemplateById(id: string): Promise<FormTemplate> {
  const res = await coreApi.get<FormTemplate>(`/form-templates/${id}`)
  return res.data
}

export async function createFormTemplate(
  input: CreateFormTemplateInput,
): Promise<FormTemplate> {
  const res = await coreApi.post<FormTemplate>('/form-templates', input)
  return res.data
}

export async function updateFormTemplate(
  id: string,
  input: UpdateFormTemplateInput,
): Promise<FormTemplate> {
  const res = await coreApi.patch<FormTemplate>(`/form-templates/${id}`, input)
  return res.data
}

export async function deactivateFormTemplate(id: string): Promise<FormTemplate> {
  const res = await coreApi.post<FormTemplate>(`/form-templates/${id}/deactivate`)
  return res.data
}

export async function activateFormTemplate(id: string): Promise<FormTemplate> {
  const res = await coreApi.post<FormTemplate>(`/form-templates/${id}/activate`)
  return res.data
}

export async function deleteFormTemplate(id: string): Promise<void> {
  await coreApi.delete(`/form-templates/${id}`)
}

// =====================================================================
// Questions (sub-recurso)
// =====================================================================

export async function fetchFormQuestions(
  templateId: string,
): Promise<{ items: FormQuestion[] }> {
  const res = await coreApi.get<{ items: FormQuestion[] }>(
    `/form-templates/${templateId}/questions`,
  )
  return res.data
}

export async function createFormQuestion(
  templateId: string,
  input: CreateFormQuestionInput,
): Promise<FormQuestion> {
  const res = await coreApi.post<FormQuestion>(
    `/form-templates/${templateId}/questions`,
    input,
  )
  return res.data
}

export async function updateFormQuestion(
  templateId: string,
  questionId: string,
  input: UpdateFormQuestionInput,
): Promise<FormQuestion> {
  const res = await coreApi.patch<FormQuestion>(
    `/form-templates/${templateId}/questions/${questionId}`,
    input,
  )
  return res.data
}

export async function deleteFormQuestion(
  templateId: string,
  questionId: string,
): Promise<void> {
  await coreApi.delete(`/form-templates/${templateId}/questions/${questionId}`)
}

// =====================================================================
// Labels pra UI
// =====================================================================

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  text: 'Texto livre',
  yes_no: 'Sim / Não',
  multiple_choice: 'Múltipla escolha',
  scale: 'Escala',
  number: 'Numérico',
  date: 'Data',
}

export function questionNeedsOptions(t: QuestionType): boolean {
  return t === 'multiple_choice' || t === 'scale'
}

// Normaliza options pra string[] na UI. Objetos livres (key→label) caem em [].
export function optionsAsStringArray(
  options: FormQuestion['options'],
): string[] {
  if (!options) return []
  if (Array.isArray(options)) return options
  return Object.values(options).filter(
    (v): v is string => typeof v === 'string',
  )
}
