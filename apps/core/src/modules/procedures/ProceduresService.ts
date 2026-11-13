import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { ProceduresQuery } from './ProceduresQuery.js';
import { proceduresSortSpec } from './ProceduresTypes.js';
import type {
  CreateProcedureInput,
  FindProceduresQuery,
  Procedure,
  UpdateProcedureInput,
} from './ProceduresTypes.js';

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export const ProceduresService = {
  find: async (
    tenantId: string,
    query: FindProceduresQuery
  ): Promise<PaginatedResult<Procedure>> => {
    return withTenant(db, tenantId, async (tx) => {
      const active = query.status === 'all' ? undefined : query.status === 'active';
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        proceduresSortSpec
      );
      const { items, total } = await ProceduresQuery.findPaginated(
        tx,
        { q: query.q, active },
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

  findById: async (tenantId: string, id: string): Promise<Procedure> => {
    return withTenant(db, tenantId, async (tx) => {
      const row = await ProceduresQuery.findById(tx, id);
      if (!row) throw new AppError('Procedimento não encontrado', 404);
      return row;
    });
  },

  create: async (
    tenantId: string,
    input: CreateProcedureInput
  ): Promise<Procedure> => {
    return withTenant(db, tenantId, async (tx) => {
      try {
        return await ProceduresQuery.create(tx, tenantId, input);
      } catch (err) {
        // unique (tenant_id, name).
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe um procedimento com este nome neste tenant',
            409
          );
        }
        throw err;
      }
    });
  },

  update: async (
    tenantId: string,
    id: string,
    input: UpdateProcedureInput
  ): Promise<Procedure> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ProceduresQuery.findById(tx, id);
      if (!current) throw new AppError('Procedimento não encontrado', 404);

      try {
        const updated = await ProceduresQuery.update(tx, id, input);
        if (!updated) throw new AppError('Procedimento não encontrado', 404);
        return updated;
      } catch (err) {
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe um procedimento com este nome neste tenant',
            409
          );
        }
        throw err;
      }
    });
  },

  deactivate: async (tenantId: string, id: string): Promise<Procedure> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ProceduresQuery.findById(tx, id);
      if (!current) throw new AppError('Procedimento não encontrado', 404);
      if (!current.active) throw new AppError('Procedimento já está desativado', 409);

      const updated = await ProceduresQuery.setActive(tx, id, false);
      if (!updated) throw new AppError('Procedimento não encontrado', 404);
      return updated;
    });
  },

  activate: async (tenantId: string, id: string): Promise<Procedure> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ProceduresQuery.findById(tx, id);
      if (!current) throw new AppError('Procedimento não encontrado', 404);
      if (current.active) throw new AppError('Procedimento já está ativo', 409);

      const updated = await ProceduresQuery.setActive(tx, id, true);
      if (!updated) throw new AppError('Procedimento não encontrado', 404);
      return updated;
    });
  },

  remove: async (tenantId: string, id: string): Promise<void> => {
    try {
      const deleted = await withTenant(db, tenantId, async (tx) => {
        return ProceduresQuery.delete(tx, id);
      });
      if (!deleted) throw new AppError('Procedimento não encontrado', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // 23503 = foreign_key_violation. quote_items e procedure_sessions
      // referenciam procedures com ON DELETE RESTRICT.
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Procedimento possui orçamentos/sessões vinculados — desative em vez de excluir',
          409
        );
      }
      throw err;
    }
  },
};
