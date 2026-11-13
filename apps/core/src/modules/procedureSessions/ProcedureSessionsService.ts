import { withTenant } from '@elora/db';
import { EVENT_CHANNELS } from '@elora/events-contracts';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { eventBus } from '../../shared/eventBus/eventBus.js';
import {
  checkAndAutoCompleteTreatment,
  markSessionDone,
} from '../../shared/journeys/treatmentLifecycle.js';
import { logger } from '../../shared/observability/logger.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { assertProfessionalCapability } from '../../shared/users/assertProfessionalCapability.js';
import { ProcedureSessionsQuery } from './ProcedureSessionsQuery.js';
import { procedureSessionsSortSpec } from './ProcedureSessionsTypes.js';
import type {
  EvolveProcedureSessionInput,
  FindProcedureSessionsQuery,
  ProcedureSession,
  UpdateProcedureSessionInput,
} from './ProcedureSessionsTypes.js';

export const ProcedureSessionsService = {
  find: async (
    tenantId: string,
    query: FindProcedureSessionsQuery
  ): Promise<PaginatedResult<ProcedureSession>> => {
    return withTenant(db, tenantId, async (tx) => {
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        procedureSessionsSortSpec
      );
      const { items, total } = await ProcedureSessionsQuery.findPaginated(
        tx,
        {
          clientId: query.clientId,
          procedureId: query.procedureId,
          treatmentId: query.treatmentId,
          status: query.status,
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

  findById: async (tenantId: string, id: string): Promise<ProcedureSession> => {
    return withTenant(db, tenantId, async (tx) => {
      const row = await ProcedureSessionsQuery.findById(tx, id);
      if (!row) throw new AppError('Sessão não encontrada', 404);
      return row;
    });
  },

  updateNotes: async (
    tenantId: string,
    id: string,
    input: UpdateProcedureSessionInput
  ): Promise<ProcedureSession> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ProcedureSessionsQuery.findById(tx, id);
      if (!current) throw new AppError('Sessão não encontrada', 404);

      // Edição clínica é permitida em qualquer status (chat-domain.md §4.7
      // "Edição (fotos antes/depois, observações, evolução clínica) permitida
      // em QUALQUER status").
      if (input.evolutionNotes === undefined) return current;

      const updated = await ProcedureSessionsQuery.updateNotes(
        tx,
        id,
        input.evolutionNotes
      );
      if (!updated) throw new AppError('Sessão não encontrada', 404);
      return updated;
    });
  },

  cancel: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<ProcedureSession> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ProcedureSessionsQuery.findById(tx, id);
      if (!current) throw new AppError('Sessão não encontrada', 404);
      if (current.status === 'cancelled') {
        throw new AppError('Sessão já está cancelada', 409);
      }
      if (current.status === 'done') {
        throw new AppError(
          'Sessão já executada — não pode ser cancelada',
          409
        );
      }

      const updated = await ProcedureSessionsQuery.setStatus(tx, id, 'cancelled');
      if (!updated) throw new AppError('Sessão não encontrada', 404);

      // Cancelamento conta como "fora de pending" (chat-domain.md §6:
      // cancelled não bloqueia auto-complete). Re-roda check.
      const treatmentId = await ProcedureSessionsQuery.findTreatmentIdForSession(
        tx,
        id
      );
      if (treatmentId) {
        await checkAndAutoCompleteTreatment(tx, treatmentId, actorUserId);
      }

      return updated;
    });
  },

  // Fluxo principal pós-assinatura: aplicadora encerra a evolução clínica
  // da sessão `signed` (escreve observações e marca `done`). Atômico:
  // nota + status + executedAt/By + cascade de auto-complete do treatment.
  //
  // Gate de capacidade: actor precisa ter `canApplyProcedures` (eixo
  // ortogonal ao role-based PERMISSIONS — admin sem essa flag não passa
  // por aqui e deve usar o override `/done`).
  evolve: async (
    tenantId: string,
    id: string,
    actorUserId: string,
    input: EvolveProcedureSessionInput
  ): Promise<ProcedureSession> => {
    const result = await withTenant(db, tenantId, async (tx) => {
      const current = await ProcedureSessionsQuery.findById(tx, id);
      if (!current) throw new AppError('Sessão não encontrada', 404);
      if (current.status === 'pending') {
        throw new AppError(
          'Cliente ainda não assinou presença nesta sessão',
          409
        );
      }
      if (current.status === 'done') {
        throw new AppError('Sessão já foi evoluída', 409);
      }
      if (current.status === 'cancelled') {
        throw new AppError(
          'Sessão cancelada — não pode ser evoluída',
          409
        );
      }
      // Aqui status === 'signed' (única transição válida pra evolve).

      await assertProfessionalCapability(tx, actorUserId, 'procedure');

      await ProcedureSessionsQuery.updateNotes(tx, id, input.evolutionNotes);
      await markSessionDone(tx, id, actorUserId);

      let treatmentCompleted = false;
      const treatmentId = await ProcedureSessionsQuery.findTreatmentIdForSession(
        tx,
        id
      );
      if (treatmentId) {
        const r = await checkAndAutoCompleteTreatment(
          tx,
          treatmentId,
          actorUserId
        );
        treatmentCompleted = r.completed;
      }

      const fresh = await ProcedureSessionsQuery.findById(tx, id);
      if (!fresh) throw new AppError('Sessão não encontrada', 404);
      return { session: fresh, treatmentCompleted };
    });

    // Evento best-effort fora da tx — outros operadores na agenda
    // invalidam caches e mostram toast.
    await eventBus.publish(EVENT_CHANNELS.procedureSessionEvolved, {
      tenantId,
      sessionId: result.session.id,
      clientId: result.session.clientId,
      evolvedAt: (result.session.executedAt ?? new Date()).toISOString(),
      evolvedByUserId: actorUserId,
      treatmentCompleted: result.treatmentCompleted,
    });

    logger.info(
      {
        tenantId,
        sessionId: result.session.id,
        treatmentCompleted: result.treatmentCompleted,
      },
      'procedureSessions.evolve.recorded'
    );

    return result.session;
  },

  // Override administrativo — usado pra sessões executadas fora do fluxo
  // normal (legacy import, sessão importada sem assinatura, correção
  // manual). Vai direto pra `done` sem exigir status `signed` nem nota.
  // Permissão restrita: gate na rota deve exigir role admin.
  markDoneManual: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<ProcedureSession> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ProcedureSessionsQuery.findById(tx, id);
      if (!current) throw new AppError('Sessão não encontrada', 404);
      if (current.status === 'done') {
        throw new AppError('Sessão já está done', 409);
      }
      if (current.status === 'cancelled') {
        throw new AppError(
          'Sessão cancelada — reabra antes de marcar como done',
          409
        );
      }

      await markSessionDone(tx, id, actorUserId);

      // Verifica treatment associado (pode não existir se a session ainda
      // não foi linkada via 1ª presença).
      const treatmentId = await ProcedureSessionsQuery.findTreatmentIdForSession(
        tx,
        id
      );
      if (treatmentId) {
        await checkAndAutoCompleteTreatment(tx, treatmentId, actorUserId);
      }

      const fresh = await ProcedureSessionsQuery.findById(tx, id);
      if (!fresh) throw new AppError('Sessão não encontrada', 404);
      return fresh;
    });
  },
};
