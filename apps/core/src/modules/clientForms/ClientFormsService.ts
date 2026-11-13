import { clients, eq, evaluations, formTemplates, withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  recordJourneyEvent,
  touchJourneyActivity,
} from '../../shared/journeys/eventLogger.js';
import { JourneysQuery } from '../journeys/JourneysQuery.js';
import { ClientFormsQuery } from './ClientFormsQuery.js';
import type {
  ClientForm,
  CreateClientFormInput,
  FormAnswer,
  UpsertAnswersInput,
} from './ClientFormsTypes.js';

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export const ClientFormsService = {
  // Listagem ----------------------------------------------------------

  findByClient: async (
    tenantId: string,
    clientId: string
  ): Promise<ClientForm[]> => {
    return withTenant(db, tenantId, async (tx) => {
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, clientId))
        .limit(1);
      if (!client) throw new AppError('Cliente não encontrado', 404);
      return ClientFormsQuery.findByClient(tx, clientId);
    });
  },

  findByEvaluation: async (
    tenantId: string,
    evaluationId: string
  ): Promise<ClientForm[]> => {
    return withTenant(db, tenantId, async (tx) => {
      const [evaluation] = await tx
        .select({ id: evaluations.id })
        .from(evaluations)
        .where(eq(evaluations.id, evaluationId))
        .limit(1);
      if (!evaluation) throw new AppError('Avaliação não encontrada', 404);
      return ClientFormsQuery.findByEvaluation(tx, evaluationId);
    });
  },

  findById: async (
    tenantId: string,
    id: string
  ): Promise<{ form: ClientForm; answers: FormAnswer[] }> => {
    return withTenant(db, tenantId, async (tx) => {
      const form = await ClientFormsQuery.findById(tx, id);
      if (!form) throw new AppError('Ficha não encontrada', 404);
      const answers = await ClientFormsQuery.findAnswersByForm(tx, id);
      return { form, answers };
    });
  },

  // Criação -----------------------------------------------------------

  create: async (
    tenantId: string,
    evaluationId: string,
    input: CreateClientFormInput
  ): Promise<ClientForm> => {
    return withTenant(db, tenantId, async (tx) => {
      const [evaluation] = await tx
        .select({ id: evaluations.id, clientId: evaluations.clientId })
        .from(evaluations)
        .where(eq(evaluations.id, evaluationId))
        .limit(1);
      if (!evaluation) throw new AppError('Avaliação não encontrada', 404);

      const [template] = await tx
        .select({ id: formTemplates.id, active: formTemplates.active })
        .from(formTemplates)
        .where(eq(formTemplates.id, input.formTemplateId))
        .limit(1);
      if (!template) throw new AppError('Template não encontrado', 404);
      if (!template.active) throw new AppError('Template está desativado', 409);

      try {
        return await ClientFormsQuery.create(tx, tenantId, {
          evaluationId,
          // clientId derivado da evaluation — mantém denormalização válida
          // mesmo se caller passar errado (não passa, mas defesa em prof).
          clientId: evaluation.clientId,
          formTemplateId: input.formTemplateId,
        });
      } catch (err) {
        // unique(evaluation_id, form_template_id) — essa avaliação já tem
        // ficha desse template. Atualizar = PATCH/answers; criar = 409.
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Esta avaliação já possui uma ficha deste template — abra a existente',
            409
          );
        }
        throw err;
      }
    });
  },

  // Upsert de respostas -----------------------------------------------

  upsertAnswers: async (
    tenantId: string,
    id: string,
    input: UpsertAnswersInput
  ): Promise<FormAnswer[]> => {
    return withTenant(db, tenantId, async (tx) => {
      const form = await ClientFormsQuery.findById(tx, id);
      if (!form) throw new AppError('Ficha não encontrada', 404);
      if (form.status === 'archived') {
        throw new AppError(
          'Ficha está arquivada — reabra antes de responder',
          409
        );
      }
      // Permite editar respostas mesmo em fichas completed — fluxo de correção
      // pós-finalização. Status NÃO volta pra draft automaticamente.
      return ClientFormsQuery.upsertAnswers(tx, tenantId, id, input.answers);
    });
  },

  // Transições de status ----------------------------------------------

  complete: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<ClientForm> => {
    return withTenant(db, tenantId, async (tx) => {
      const form = await ClientFormsQuery.findById(tx, id);
      if (!form) throw new AppError('Ficha não encontrada', 404);
      if (form.status === 'completed') {
        throw new AppError('Ficha já está finalizada', 409);
      }
      if (form.status === 'archived') {
        throw new AppError('Ficha está arquivada', 409);
      }

      // Guard rail: todas as required questions do template precisam ter
      // resposta. Se falta alguma, 409 com a lista dos IDs.
      const missing = await ClientFormsQuery.findUnansweredRequired(
        tx,
        form.formTemplateId,
        id
      );
      if (missing.length > 0) {
        throw new AppError(
          'Existem perguntas obrigatórias sem resposta',
          409,
          { missingQuestionIds: missing }
        );
      }

      const updated = await ClientFormsQuery.setStatus(tx, id, 'completed', {
        filledAt: new Date(),
        completedByUserId: actorUserId,
      });
      if (!updated) throw new AppError('Ficha não encontrada', 404);

      // Emite journey_event na journey ativa do cliente (se houver). Quando
      // não houver journey ativa, completar a ficha é só registro do cadastro
      // — não conta como evento de timeline.
      const journey = await JourneysQuery.findActiveByClient(tx, form.clientId);
      if (journey) {
        await recordJourneyEvent(tx, {
          tenantId,
          journeyId: journey.id,
          eventType: 'form_completed',
          payload: {
            clientFormId: updated.id,
            formTemplateId: updated.formTemplateId,
          },
          actorUserId,
        });
        await touchJourneyActivity(tx, journey.id);
      }

      return updated;
    });
  },

  archive: async (tenantId: string, id: string): Promise<ClientForm> => {
    return withTenant(db, tenantId, async (tx) => {
      const form = await ClientFormsQuery.findById(tx, id);
      if (!form) throw new AppError('Ficha não encontrada', 404);
      if (form.status === 'archived') {
        throw new AppError('Ficha já está arquivada', 409);
      }
      const updated = await ClientFormsQuery.setStatus(tx, id, 'archived');
      if (!updated) throw new AppError('Ficha não encontrada', 404);
      return updated;
    });
  },

  reopen: async (tenantId: string, id: string): Promise<ClientForm> => {
    return withTenant(db, tenantId, async (tx) => {
      const form = await ClientFormsQuery.findById(tx, id);
      if (!form) throw new AppError('Ficha não encontrada', 404);
      if (form.status !== 'archived') {
        throw new AppError('Só fichas arquivadas podem ser reabertas', 409);
      }
      // Volta pra draft — admin/avaliadora ajusta e completa de novo se quiser.
      const updated = await ClientFormsQuery.setStatus(tx, id, 'draft', {
        filledAt: null,
        completedByUserId: null,
      });
      if (!updated) throw new AppError('Ficha não encontrada', 404);
      return updated;
    });
  },
};
