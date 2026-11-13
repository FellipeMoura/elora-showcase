import { coreApi } from '@/api/client'

// Espelha apps/core/src/modules/clientForms/ClientFormsTypes.ts.
// Ficha = instância de template preenchida pra um cliente. 1 ficha por
// (cliente, template) — atualizar respostas via upsert.

export type ClientFormStatus = 'draft' | 'completed' | 'archived'

export interface ClientForm {
  id: string
  tenantId: string
  evaluationId: string
  clientId: string
  formTemplateId: string
  status: ClientFormStatus
  filledAt: string | null
  completedByUserId: string | null
  createdAt: string
  updatedAt: string
}

export interface FormAnswer {
  id: string
  tenantId: string
  clientFormId: string
  questionId: string
  answerText: string | null
  answerOption: string | null
  answerBoolean: boolean | null
  // decimal volta como string do backend.
  answerNumber: string | null
  answerDate: string | null
  answerData: Record<string, unknown> | null
  professionalObservation: string | null
  answeredAt: string
  createdAt: string
  updatedAt: string
}

export interface CreateClientFormInput {
  formTemplateId: string
}

// Backend: upsert por (clientFormId, questionId). Pelo menos um campo de
// resposta OU professionalObservation precisa estar presente.
export interface AnswerInput {
  questionId: string
  answerText?: string | null
  answerOption?: string | null
  answerBoolean?: boolean | null
  answerNumber?: number | null
  // YYYY-MM-DD
  answerDate?: string | null
  answerData?: Record<string, unknown> | null
  professionalObservation?: string | null
}

export interface UpsertAnswersInput {
  answers: AnswerInput[]
}

// =====================================================================
// API calls
// =====================================================================

export async function fetchClientFormsByClient(
  clientId: string,
): Promise<{ items: ClientForm[] }> {
  const res = await coreApi.get<{ items: ClientForm[] }>(
    `/clients/${clientId}/forms`,
  )
  return res.data
}

export async function fetchClientFormsByEvaluation(
  evaluationId: string,
): Promise<{ items: ClientForm[] }> {
  const res = await coreApi.get<{ items: ClientForm[] }>(
    `/evaluations/${evaluationId}/forms`,
  )
  return res.data
}

export async function createClientForm(
  evaluationId: string,
  input: CreateClientFormInput,
): Promise<ClientForm> {
  const res = await coreApi.post<ClientForm>(
    `/evaluations/${evaluationId}/forms`,
    input,
  )
  return res.data
}

export async function fetchClientFormById(
  id: string,
): Promise<{ form: ClientForm; answers: FormAnswer[] }> {
  const res = await coreApi.get<{ form: ClientForm; answers: FormAnswer[] }>(
    `/client-forms/${id}`,
  )
  return res.data
}

export async function upsertClientFormAnswers(
  id: string,
  input: UpsertAnswersInput,
): Promise<{ items: FormAnswer[] }> {
  const res = await coreApi.post<{ items: FormAnswer[] }>(
    `/client-forms/${id}/answers`,
    input,
  )
  return res.data
}

export async function completeClientForm(id: string): Promise<ClientForm> {
  const res = await coreApi.post<ClientForm>(`/client-forms/${id}/complete`)
  return res.data
}

export async function archiveClientForm(id: string): Promise<ClientForm> {
  const res = await coreApi.post<ClientForm>(`/client-forms/${id}/archive`)
  return res.data
}

export async function reopenClientForm(id: string): Promise<ClientForm> {
  const res = await coreApi.post<ClientForm>(`/client-forms/${id}/reopen`)
  return res.data
}

// =====================================================================
// Labels
// =====================================================================

export const CLIENT_FORM_STATUS_LABELS: Record<ClientFormStatus, string> = {
  draft: 'Rascunho',
  completed: 'Finalizada',
  archived: 'Arquivada',
}

export const CLIENT_FORM_STATUS_BADGE_CLASS: Record<ClientFormStatus, string> =
  {
    draft: 'bg-muted text-muted-foreground',
    completed: 'bg-success/15 text-success',
    archived: 'bg-warning/15 text-warning',
  }
