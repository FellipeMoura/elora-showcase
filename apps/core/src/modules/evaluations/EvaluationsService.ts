import { recomputeLeadSubstage, withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  recordJourneyEvent,
  touchJourneyActivity,
} from '../../shared/journeys/eventLogger.js';
import { applyStageTransition } from '../../shared/journeys/stageTransition.js';
import { JourneysQuery } from '../journeys/JourneysQuery.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import {
  EvaluationsQuery,
  type EvaluationListItemRow,
} from './EvaluationsQuery.js';
import { evaluationsSortSpec } from './EvaluationsTypes.js';
import type {
  CreateEvaluationInput,
  Evaluation,
  FindEvaluationsQuery,
  UpdateEvaluationInput,
} from './EvaluationsTypes.js';

// Row enriquecido com o appointment associado (latest não-cancelado). Mesma
// "mentira benigna" de tipos do QuotesService: Date nas colunas, Express
// serializa pra ISO no res.json. Wire types (zod) refletem o ISO final.
export type EvaluationListEnriched = EvaluationListItemRow & {
  appointmentId: string | null;
  appointmentStatus:
    | 'scheduled'
    | 'confirmed'
    | 'attended'
    | 'no_show'
    | 'cancelled'
    | null;
  appointmentScheduledAt: Date | null;
};

export const EvaluationsService = {
  find: async (
    tenantId: string,
    query: FindEvaluationsQuery
  ): Promise<PaginatedResult<EvaluationListEnriched>> => {
    return withTenant(db, tenantId, async (tx) => {
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        evaluationsSortSpec
      );
      const { items, total } = await EvaluationsQuery.findPaginated(
        tx,
        {
          journeyId: query.journeyId,
          clientId: query.clientId,
          status: query.status,
          kind: query.kind,
          q: query.q,
        },
        { page: query.page, pageSize: query.pageSize },
        orderBy
      );

      // Mescla appointment associado (latest não-cancelado) por evaluation
      // — espelha o EvaluationsSection do ClientDetail. Query separada pra
      // evitar gymnastics com LATERAL no Drizzle.
      const evalIds = items.map((i) => i.id);
      const appointments =
        await EvaluationsQuery.findLatestActiveAppointmentsByEvaluationIds(
          tx,
          evalIds
        );
      const apptByEvalId = new Map(
        appointments.map((a) => [a.evaluationId, a])
      );

      const enriched: EvaluationListEnriched[] = items.map((row) => {
        const appt = apptByEvalId.get(row.id);
        return {
          ...row,
          appointmentId: appt?.appointmentId ?? null,
          appointmentStatus: appt?.status ?? null,
          appointmentScheduledAt: appt?.scheduledAt ?? null,
        };
      });

      return {
        items: enriched,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: totalPagesOf(total, query.pageSize),
      };
    });
  },

  // Criação standalone — sem appointment associado. Quando o flow começa
  // pelo agendamento, AppointmentsService.create já cria a evaluation
  // inline e este endpoint não é chamado.
  create: async (
    tenantId: string,
    input: CreateEvaluationInput,
    actorUserId: string | null
  ): Promise<Evaluation> => {
    return withTenant(db, tenantId, async (tx) => {
      const journey = await JourneysQuery.findById(tx, input.journeyId);
      if (!journey) throw new AppError('Jornada não encontrada', 404);
      if (journey.status !== 'active') {
        throw new AppError('Jornada não está ativa', 409);
      }

      const created = await EvaluationsQuery.create(tx, tenantId, {
        journeyId: journey.id,
        clientId: journey.clientId,
        kind: input.kind,
        generalNotes: input.generalNotes ?? null,
      });

      await recordJourneyEvent(tx, {
        tenantId,
        journeyId: journey.id,
        eventType: 'evaluation_created',
        payload: {
          evaluationId: created.id,
          kind: created.kind,
        },
        actorUserId,
      });

      // Criação standalone de evaluation dispara lead → evaluation mesmo com
      // status='pending' (chat-domain.md §16.1). Caminho via appointment
      // (POST /appointments kind=evaluation) segue diferente: lá a transição
      // só dispara em appointment.attended.
      if (journey.stage === 'lead') {
        await applyStageTransition(tx, journey.id, {
          to: 'evaluation',
          reason: 'evaluation_created',
          actorUserId,
        });
      } else {
        await touchJourneyActivity(tx, journey.id);
        await recomputeLeadSubstage(tx, journey.id, {
          reason: 'evaluation_created',
          actorUserId,
        });
      }

      return created;
    });
  },

  findById: async (tenantId: string, id: string): Promise<Evaluation> => {
    return withTenant(db, tenantId, async (tx) => {
      const row = await EvaluationsQuery.findById(tx, id);
      if (!row) throw new AppError('Avaliação não encontrada', 404);
      return row;
    });
  },

  update: async (
    tenantId: string,
    id: string,
    input: UpdateEvaluationInput
  ): Promise<Evaluation> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await EvaluationsQuery.findById(tx, id);
      if (!current) throw new AppError('Avaliação não encontrada', 404);

      // Edição clínica permitida em qualquer status — fluxo pós-finalização
      // é livre (mesmo padrão do treatments/procedure_sessions).
      const updated = await EvaluationsQuery.update(tx, id, input);
      if (!updated) throw new AppError('Avaliação não encontrada', 404);

      await touchJourneyActivity(tx, current.journeyId);
      return updated;
    });
  },

  cancel: async (tenantId: string, id: string): Promise<Evaluation> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await EvaluationsQuery.findById(tx, id);
      if (!current) throw new AppError('Avaliação não encontrada', 404);
      if (current.status === 'cancelled') {
        throw new AppError('Avaliação já está cancelada', 409);
      }
      if (current.status === 'performed') {
        throw new AppError(
          'Avaliação já realizada — não pode ser cancelada',
          409
        );
      }

      const updated = await EvaluationsQuery.setStatus(tx, id, 'cancelled');
      if (!updated) throw new AppError('Avaliação não encontrada', 404);
      await touchJourneyActivity(tx, current.journeyId);
      return updated;
    });
  },
};
