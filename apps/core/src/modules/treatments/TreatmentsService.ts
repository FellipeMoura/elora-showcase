import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  markTreatmentManuallyClosed,
  reopenTreatment,
} from '../../shared/journeys/treatmentLifecycle.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import type { ProcedureSession } from '../procedureSessions/ProcedureSessionsTypes.js';
import { TreatmentsQuery } from './TreatmentsQuery.js';
import { treatmentsSortSpec } from './TreatmentsTypes.js';
import type {
  CloseManuallyInput,
  FindTreatmentsQuery,
  Treatment,
  TreatmentListItem,
  UpdateTreatmentInput,
} from './TreatmentsTypes.js';

export const TreatmentsService = {
  find: async (
    tenantId: string,
    query: FindTreatmentsQuery
  ): Promise<PaginatedResult<TreatmentListItem>> => {
    return withTenant(db, tenantId, async (tx) => {
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        treatmentsSortSpec
      );
      const { items, total } = await TreatmentsQuery.findPaginated(
        tx,
        {
          journeyId: query.journeyId,
          clientId: query.clientId,
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

  findById: async (
    tenantId: string,
    id: string
  ): Promise<{ treatment: Treatment; sessions: ProcedureSession[] }> => {
    return withTenant(db, tenantId, async (tx) => {
      const treatment = await TreatmentsQuery.findById(tx, id);
      if (!treatment) throw new AppError('Tratamento não encontrado', 404);
      const sessions = await TreatmentsQuery.findSessionsByTreatment(tx, id);
      return { treatment, sessions };
    });
  },

  update: async (
    tenantId: string,
    id: string,
    input: UpdateTreatmentInput
  ): Promise<Treatment> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await TreatmentsQuery.findById(tx, id);
      if (!current) throw new AppError('Tratamento não encontrado', 404);

      // Edição de campos descritivos é permitida em qualquer status — fluxo
      // pós-finalização é liberado (chat-domain.md §4.7).
      const updated = await TreatmentsQuery.update(tx, id, input);
      if (!updated) throw new AppError('Tratamento não encontrado', 404);
      return updated;
    });
  },

  closeManually: async (
    tenantId: string,
    id: string,
    input: CloseManuallyInput,
    actorUserId: string | null
  ): Promise<Treatment> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await TreatmentsQuery.findById(tx, id);
      if (!current) throw new AppError('Tratamento não encontrado', 404);

      await markTreatmentManuallyClosed(tx, id, actorUserId, input.reason ?? undefined);

      const fresh = await TreatmentsQuery.findById(tx, id);
      if (!fresh) throw new AppError('Tratamento não encontrado', 404);
      return fresh;
    });
  },

  reopen: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<Treatment> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await TreatmentsQuery.findById(tx, id);
      if (!current) throw new AppError('Tratamento não encontrado', 404);

      await reopenTreatment(tx, id, actorUserId);

      const fresh = await TreatmentsQuery.findById(tx, id);
      if (!fresh) throw new AppError('Tratamento não encontrado', 404);
      return fresh;
    });
  },
};
