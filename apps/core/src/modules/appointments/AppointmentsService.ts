import {
  eq,
  procedureSessions,
  recomputeLeadSubstage,
  withTenant,
} from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  recordJourneyEvent,
  touchJourneyActivity,
} from '../../shared/journeys/eventLogger.js';
import { applyStageTransition } from '../../shared/journeys/stageTransition.js';
import {
  checkAndAutoCompleteTreatment,
  ensureTreatmentForJourney,
  linkSessionToTreatment,
  markSessionSigned,
} from '../../shared/journeys/treatmentLifecycle.js';
import { validateAppointmentSlot } from '../../shared/scheduling/validateSlot.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { assertProfessionalCapability } from '../../shared/users/assertProfessionalCapability.js';
import { EvaluationsQuery } from '../evaluations/EvaluationsQuery.js';
import { JourneysQuery } from '../journeys/JourneysQuery.js';
import { AppointmentsQuery } from './AppointmentsQuery.js';
import { appointmentsSortSpec } from './AppointmentsTypes.js';
import type {
  Appointment,
  CreateAppointmentInput,
  FindAppointmentsQuery,
  UpdateAppointmentInput,
} from './AppointmentsTypes.js';

const NON_TERMINAL_STATUSES = ['scheduled', 'confirmed'] as const;

function isNonTerminal(
  status: string
): status is (typeof NON_TERMINAL_STATUSES)[number] {
  return (NON_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export const AppointmentsService = {
  find: async (
    tenantId: string,
    query: FindAppointmentsQuery
  ): Promise<PaginatedResult<Appointment>> => {
    return withTenant(db, tenantId, async (tx) => {
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        appointmentsSortSpec
      );
      const { items, total } = await AppointmentsQuery.findPaginated(
        tx,
        {
          kind: query.kind,
          journeyId: query.journeyId,
          clientId: query.clientId,
          professionalId: query.professionalId,
          unitId: query.unitId,
          equipmentId: query.equipmentId,
          status: query.status,
          dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
          dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
        },
        { page: query.page, pageSize: query.pageSize },
        orderBy
      );
      return {
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: totalPagesOf(total, query.pageSize),
      };
    });
  },

  findById: async (tenantId: string, id: string): Promise<Appointment> => {
    return withTenant(db, tenantId, async (tx) => {
      const row = await AppointmentsQuery.findById(tx, id);
      if (!row) throw new AppError('Agendamento não encontrado', 404);
      return row;
    });
  },

  create: async (
    tenantId: string,
    input: CreateAppointmentInput,
    actorUserId: string | null
  ): Promise<Appointment> => {
    return withTenant(db, tenantId, async (tx) => {
      const journey = await JourneysQuery.findById(tx, input.journeyId);
      if (!journey) throw new AppError('Jornada não encontrada', 404);
      if (journey.status !== 'active') {
        throw new AppError('Jornada não está ativa', 409);
      }

      const scheduledAt = new Date(input.scheduledAt);

      // Gate de disponibilidade: se professionalId, valida janela + conflito
      // + exceções (chat-domain.md §17). Sem professionalId, sem validação.
      if (input.professionalId) {
        await assertProfessionalCapability(tx, input.professionalId, input.kind);
        await validateAppointmentSlot(tx, {
          userId: input.professionalId,
          scheduledAt,
          durationMinutes: input.durationMinutes,
        });
      }

      if (input.kind === 'evaluation') {
        // Cria evaluation inline (status=pending) + appointment ligando.
        const evaluation = await EvaluationsQuery.create(tx, tenantId, {
          journeyId: journey.id,
          clientId: journey.clientId,
          kind: input.evaluation.kind,
        });

        const created = await AppointmentsQuery.create(tx, tenantId, {
          kind: 'evaluation',
          journeyId: journey.id,
          clientId: journey.clientId,
          evaluationId: evaluation.id,
          professionalId: input.professionalId,
          unitId: input.unitId,
          scheduledAt,
          durationMinutes: input.durationMinutes,
          notes: input.notes,
        });

        await recordJourneyEvent(tx, {
          tenantId,
          journeyId: journey.id,
          eventType: 'evaluation_scheduled',
          payload: {
            appointmentId: created.id,
            evaluationId: evaluation.id,
            scheduledAt: created.scheduledAt.toISOString(),
          },
          actorUserId,
        });
        await touchJourneyActivity(tx, journey.id);
        await recomputeLeadSubstage(tx, journey.id, {
          reason: 'evaluation_scheduled',
          actorUserId,
        });

        return created;
      }

      // kind === 'procedure': valida session existe, pertence ao cliente,
      // está pending e não tem outro appointment ativo.
      const [session] = await tx
        .select()
        .from(procedureSessions)
        .where(eq(procedureSessions.id, input.procedureSessionId))
        .limit(1);
      if (!session) throw new AppError('Sessão não encontrada', 404);
      if (session.clientId !== journey.clientId) {
        throw new AppError(
          'Sessão pertence a outro cliente — não vincula',
          409
        );
      }
      if (session.status !== 'pending') {
        throw new AppError(
          `Sessão em status=${session.status} — só pending pode ser agendada`,
          409
        );
      }
      const conflict = await AppointmentsQuery.findActiveAppointmentForSession(
        tx,
        input.procedureSessionId
      );
      if (conflict) {
        throw new AppError(
          'Sessão já está agendada em outro horário — cancele primeiro',
          409
        );
      }

      const created = await AppointmentsQuery.create(tx, tenantId, {
        kind: 'procedure',
        journeyId: journey.id,
        clientId: journey.clientId,
        procedureSessionId: input.procedureSessionId,
        professionalId: input.professionalId,
        unitId: input.unitId,
        equipmentId: input.equipmentId,
        scheduledAt,
        durationMinutes: input.durationMinutes,
        notes: input.notes,
      });

      // Sem journey_event próprio (vocab §16.5 não inclui appointment scheduled
      // pra procedures). Só conta como atividade de staff.
      await touchJourneyActivity(tx, journey.id);
      return created;
    });
  },

  update: async (
    tenantId: string,
    id: string,
    input: UpdateAppointmentInput,
    actorUserId: string | null
  ): Promise<Appointment> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await AppointmentsQuery.findById(tx, id);
      if (!current) throw new AppError('Agendamento não encontrado', 404);
      if (!isNonTerminal(current.status)) {
        throw new AppError(
          `Agendamento em status=${current.status} — não permite edição`,
          409
        );
      }
      // equipmentId só faz sentido em kind=procedure.
      if (input.equipmentId !== undefined && current.kind === 'evaluation') {
        throw new AppError(
          'equipmentId só pode ser definido em agendamentos de procedimento',
          409
        );
      }

      // Revalida gate de disponibilidade se algum dos 3 campos relevantes mudou.
      const nextScheduledAt = input.scheduledAt
        ? new Date(input.scheduledAt)
        : current.scheduledAt;
      const nextDurationMinutes =
        input.durationMinutes ?? current.durationMinutes;
      const nextProfessionalId =
        input.professionalId !== undefined
          ? input.professionalId
          : current.professionalId;
      const slotChanged =
        input.scheduledAt !== undefined ||
        input.durationMinutes !== undefined ||
        input.professionalId !== undefined;
      if (slotChanged && nextProfessionalId) {
        // Revalida capacidade só se trocou o profissional — kind do appointment
        // não muda no update, e a flag do profissional atual já foi validada
        // no momento do create. Sem profissional novo = sem nova checagem.
        if (
          input.professionalId !== undefined &&
          input.professionalId !== current.professionalId
        ) {
          await assertProfessionalCapability(tx, nextProfessionalId, current.kind);
        }
        await validateAppointmentSlot(tx, {
          userId: nextProfessionalId,
          scheduledAt: nextScheduledAt,
          durationMinutes: nextDurationMinutes,
          skipAppointmentId: id,
        });
      }

      const updated = await AppointmentsQuery.update(tx, id, {
        professionalId: input.professionalId,
        unitId: input.unitId,
        equipmentId: input.equipmentId,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        durationMinutes: input.durationMinutes,
        notes: input.notes,
      });
      if (!updated) throw new AppError('Agendamento não encontrado', 404);

      await touchJourneyActivity(tx, current.journeyId);
      // Mudou scheduledAt? Pode reposicionar lead entre scheduled / no_show /
      // rescheduled. Recompute idempotente cuida — no-op se stage != lead.
      if (input.scheduledAt !== undefined && current.kind === 'evaluation') {
        await recomputeLeadSubstage(tx, current.journeyId, {
          reason: 'appointment_updated',
          actorUserId,
        });
      }
      void actorUserId;
      return updated;
    });
  },

  confirm: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<Appointment> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await AppointmentsQuery.findById(tx, id);
      if (!current) throw new AppError('Agendamento não encontrado', 404);
      if (current.status !== 'scheduled') {
        throw new AppError(
          `Só agendamentos scheduled podem ser confirmados (atual=${current.status})`,
          409
        );
      }
      const updated = await AppointmentsQuery.setStatus(tx, id, 'confirmed');
      if (!updated) throw new AppError('Agendamento não encontrado', 404);
      await touchJourneyActivity(tx, current.journeyId);
      void actorUserId;
      return updated;
    });
  },

  // Cascata da 1ª presença (chat-domain.md §16.4):
  //   kind=evaluation:
  //     1. appointment.status = attended
  //     2. evaluation.status = performed (performed_at, performed_by)
  //     3. emite evaluation_done
  //     4. se journey.stage=lead → transition lead→evaluation
  //   kind=procedure (override administrativo — fluxo padrão é o módulo
  //     procedureSessionAttendances, que faz o mesmo via link público assinado):
  //     1. appointment.status = attended
  //     2. ensureTreatmentForJourney (cria + linka sessions pendentes + transition sale→treatment se 1ª)
  //     3. linkSessionToTreatment (idempotente — garante o link mesmo se já estava signed)
  //     4. procedure_session.status = signed (NÃO done — done agora exige evolução clínica)
  //   Ordem importa: marcar a session antes de `ensureTreatmentForJourney`
  //   faria com que o auto-link de sessions pendentes pulasse esta session, deixando
  //   `treatment_procedures` vazio. Sem auto-complete de treatment aqui — `signed`
  //   ≠ `done`; treatment só completa quando todas as sessões evoluem (próxima fase).
  attend: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<Appointment> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await AppointmentsQuery.findById(tx, id);
      if (!current) throw new AppError('Agendamento não encontrado', 404);
      if (current.status === 'attended') {
        throw new AppError('Agendamento já está como atendido', 409);
      }
      if (!isNonTerminal(current.status)) {
        throw new AppError(
          `Agendamento em status=${current.status} — não pode ir pra attended`,
          409
        );
      }

      const updated = await AppointmentsQuery.setStatus(tx, id, 'attended');
      if (!updated) throw new AppError('Agendamento não encontrado', 404);

      if (current.kind === 'evaluation') {
        if (!current.evaluationId) {
          throw new AppError(
            'Agendamento de avaliação sem evaluation_id — estado inválido',
            500
          );
        }
        const performed = await EvaluationsQuery.markPerformed(
          tx,
          current.evaluationId,
          actorUserId
        );
        if (!performed) {
          throw new AppError('Avaliação associada não encontrada', 500);
        }
        await recordJourneyEvent(tx, {
          tenantId,
          journeyId: current.journeyId,
          eventType: 'evaluation_done',
          payload: {
            appointmentId: updated.id,
            evaluationId: performed.id,
          },
          actorUserId,
        });

        const journey = await JourneysQuery.findById(tx, current.journeyId);
        if (!journey) throw new AppError('Jornada não encontrada', 500);
        if (journey.stage === 'lead') {
          await applyStageTransition(tx, journey.id, {
            to: 'evaluation',
            reason: 'evaluation_done',
            actorUserId,
          });
        } else {
          await touchJourneyActivity(tx, journey.id);
        }
        return updated;
      }

      // kind === 'procedure'
      if (!current.procedureSessionId) {
        throw new AppError(
          'Agendamento de procedimento sem procedure_session_id — estado inválido',
          500
        );
      }

      const ensure = await ensureTreatmentForJourney(
        tx,
        {
          tenantId,
          journeyId: current.journeyId,
          clientId: current.clientId,
        },
        actorUserId
      );
      await linkSessionToTreatment(
        tx,
        tenantId,
        ensure.treatmentId,
        current.procedureSessionId
      );
      await markSessionSigned(tx, current.procedureSessionId, actorUserId);
      // checkAndAutoCompleteTreatment NÃO roda aqui — `signed` ainda conta
      // como "em andamento". Auto-complete dispara só quando todas as
      // sessões viram `done` (=evolução clínica concluída).
      void checkAndAutoCompleteTreatment;

      return updated;
    });
  },

  noShow: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<Appointment> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await AppointmentsQuery.findById(tx, id);
      if (!current) throw new AppError('Agendamento não encontrado', 404);
      if (!isNonTerminal(current.status)) {
        throw new AppError(
          `Agendamento em status=${current.status} — não pode virar no_show`,
          409
        );
      }
      const updated = await AppointmentsQuery.setStatus(tx, id, 'no_show');
      if (!updated) throw new AppError('Agendamento não encontrado', 404);
      await touchJourneyActivity(tx, current.journeyId);
      // Avaliação que não compareceu vira substage='no_show' (se ainda em lead).
      if (current.kind === 'evaluation') {
        await recomputeLeadSubstage(tx, current.journeyId, {
          reason: 'appointment_no_show',
          actorUserId,
        });
      }
      void actorUserId;
      return updated;
    });
  },

  cancel: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<Appointment> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await AppointmentsQuery.findById(tx, id);
      if (!current) throw new AppError('Agendamento não encontrado', 404);
      if (current.status === 'cancelled') {
        throw new AppError('Agendamento já está cancelado', 409);
      }
      if (current.status === 'attended') {
        throw new AppError('Agendamento já atendido — não pode cancelar', 409);
      }
      const updated = await AppointmentsQuery.setStatus(tx, id, 'cancelled');
      if (!updated) throw new AppError('Agendamento não encontrado', 404);
      await touchJourneyActivity(tx, current.journeyId);
      // Cancelamento pode reverter substage de 'scheduled' pra 'contact' ou
      // 'template' (se nenhum outro appointment futuro restou). Recompute.
      if (current.kind === 'evaluation') {
        await recomputeLeadSubstage(tx, current.journeyId, {
          reason: 'appointment_cancelled',
          actorUserId,
        });
      }
      void actorUserId;
      return updated;
    });
  },
};
