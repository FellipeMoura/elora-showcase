import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  archiveClientForm,
  completeClientForm,
  createClientForm,
  fetchClientFormById,
  fetchClientFormsByClient,
  fetchClientFormsByEvaluation,
  reopenClientForm,
  upsertClientFormAnswers,
  type ClientForm,
  type CreateClientFormInput,
  type FormAnswer,
  type UpsertAnswersInput,
} from '@/api/clientForms'
import { useMe } from '@/hooks/useMe'

export const CLIENT_FORMS_QUERY_KEY = ['client-forms'] as const

export function clientFormsListKey(clientId: string) {
  return [...CLIENT_FORMS_QUERY_KEY, 'by-client', clientId] as const
}

export function clientFormsByEvaluationKey(evaluationId: string) {
  return [...CLIENT_FORMS_QUERY_KEY, 'by-evaluation', evaluationId] as const
}

export function clientFormDetailKey(id: string) {
  return [...CLIENT_FORMS_QUERY_KEY, 'detail', id] as const
}

export function useClientForms(clientId: string | undefined) {
  const { data: me } = useMe()
  return useQuery<{ items: ClientForm[] }, Error>({
    queryKey: clientFormsListKey(clientId ?? ''),
    queryFn: () => fetchClientFormsByClient(clientId as string),
    enabled: !!me?.user && !!clientId,
    staleTime: 30 * 1000,
  })
}

export function useEvaluationForms(evaluationId: string | undefined) {
  const { data: me } = useMe()
  return useQuery<{ items: ClientForm[] }, Error>({
    queryKey: clientFormsByEvaluationKey(evaluationId ?? ''),
    queryFn: () => fetchClientFormsByEvaluation(evaluationId as string),
    enabled: !!me?.user && !!evaluationId,
    staleTime: 30 * 1000,
  })
}

export function useClientForm(id: string | undefined) {
  const { data: me } = useMe()
  return useQuery<{ form: ClientForm; answers: FormAnswer[] }, Error>({
    queryKey: clientFormDetailKey(id ?? ''),
    queryFn: () => fetchClientFormById(id as string),
    enabled: !!me?.user && !!id,
    staleTime: 30 * 1000,
  })
}

// Invalida tudo dessa árvore — fichas mudam estado em várias telas e o
// custo de invalidação é baixo. Sempre invalida por client + evaluation
// quando souber, pra ambas as listagens recarregarem.
function invalidateAll(
  qc: ReturnType<typeof useQueryClient>,
  opts: { clientId?: string; evaluationId?: string; formId?: string } = {},
): void {
  if (opts.clientId) {
    qc.invalidateQueries({ queryKey: clientFormsListKey(opts.clientId) })
  }
  if (opts.evaluationId) {
    qc.invalidateQueries({
      queryKey: clientFormsByEvaluationKey(opts.evaluationId),
    })
  }
  if (!opts.clientId && !opts.evaluationId) {
    qc.invalidateQueries({ queryKey: CLIENT_FORMS_QUERY_KEY })
  }
  if (opts.formId) {
    qc.invalidateQueries({ queryKey: clientFormDetailKey(opts.formId) })
  }
}

export interface CreateClientFormArgs {
  evaluationId: string
  // clientId opcional — só pra invalidar a listagem agregada do cliente.
  // Backend deriva o cliente da própria evaluation.
  clientId?: string
  input: CreateClientFormInput
}

export function useCreateClientForm() {
  const qc = useQueryClient()
  return useMutation<ClientForm, Error, CreateClientFormArgs>({
    mutationFn: ({ evaluationId, input }) =>
      createClientForm(evaluationId, input),
    onSuccess: (form, { evaluationId, clientId }) =>
      invalidateAll(qc, {
        evaluationId,
        clientId: clientId ?? form.clientId,
        formId: form.id,
      }),
  })
}

export interface UpsertAnswersArgs {
  id: string
  evaluationId: string
  clientId?: string
  input: UpsertAnswersInput
}

export function useUpsertClientFormAnswers() {
  const qc = useQueryClient()
  return useMutation<{ items: FormAnswer[] }, Error, UpsertAnswersArgs>({
    mutationFn: ({ id, input }) => upsertClientFormAnswers(id, input),
    onSuccess: (_, { id, evaluationId, clientId }) =>
      invalidateAll(qc, { evaluationId, clientId, formId: id }),
  })
}

export interface ClientFormActionArgs {
  id: string
  evaluationId: string
  clientId?: string
}

export function useCompleteClientForm() {
  const qc = useQueryClient()
  return useMutation<ClientForm, Error, ClientFormActionArgs>({
    mutationFn: ({ id }) => completeClientForm(id),
    onSuccess: (form, { evaluationId, clientId }) =>
      invalidateAll(qc, {
        evaluationId,
        clientId: clientId ?? form.clientId,
        formId: form.id,
      }),
  })
}

export function useArchiveClientForm() {
  const qc = useQueryClient()
  return useMutation<ClientForm, Error, ClientFormActionArgs>({
    mutationFn: ({ id }) => archiveClientForm(id),
    onSuccess: (form, { evaluationId, clientId }) =>
      invalidateAll(qc, {
        evaluationId,
        clientId: clientId ?? form.clientId,
        formId: form.id,
      }),
  })
}

export function useReopenClientForm() {
  const qc = useQueryClient()
  return useMutation<ClientForm, Error, ClientFormActionArgs>({
    mutationFn: ({ id }) => reopenClientForm(id),
    onSuccess: (form, { evaluationId, clientId }) =>
      invalidateAll(qc, {
        evaluationId,
        clientId: clientId ?? form.clientId,
        formId: form.id,
      }),
  })
}
