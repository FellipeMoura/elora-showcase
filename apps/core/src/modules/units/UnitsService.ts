import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { UnitsQuery } from './UnitsQuery.js';
import { unitsSortSpec } from './UnitsTypes.js';
import type {
  CreateUnitInput,
  FindUnitsQuery,
  Unit,
  UpdateUnitInput,
} from './UnitsTypes.js';

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export const UnitsService = {
  find: async (
    tenantId: string,
    query: FindUnitsQuery
  ): Promise<PaginatedResult<Unit>> => {
    return withTenant(db, tenantId, async (tx) => {
      const active = query.status === 'all' ? undefined : query.status === 'active';
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        unitsSortSpec
      );
      const { items, total } = await UnitsQuery.findPaginated(
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

  findById: async (tenantId: string, id: string): Promise<Unit> => {
    return withTenant(db, tenantId, async (tx) => {
      const row = await UnitsQuery.findById(tx, id);
      if (!row) throw new AppError('Sala não encontrada', 404);
      return row;
    });
  },

  create: async (
    tenantId: string,
    input: CreateUnitInput
  ): Promise<Unit> => {
    return withTenant(db, tenantId, async (tx) => {
      try {
        return await UnitsQuery.create(tx, tenantId, input);
      } catch (err) {
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe uma sala com este nome neste tenant',
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
    input: UpdateUnitInput
  ): Promise<Unit> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await UnitsQuery.findById(tx, id);
      if (!current) throw new AppError('Sala não encontrada', 404);

      try {
        const updated = await UnitsQuery.update(tx, id, input);
        if (!updated) throw new AppError('Sala não encontrada', 404);
        return updated;
      } catch (err) {
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe uma sala com este nome neste tenant',
            409
          );
        }
        throw err;
      }
    });
  },

  deactivate: async (tenantId: string, id: string): Promise<Unit> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await UnitsQuery.findById(tx, id);
      if (!current) throw new AppError('Sala não encontrada', 404);
      if (!current.active) throw new AppError('Sala já está desativada', 409);

      const updated = await UnitsQuery.setActive(tx, id, false);
      if (!updated) throw new AppError('Sala não encontrada', 404);
      return updated;
    });
  },

  activate: async (tenantId: string, id: string): Promise<Unit> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await UnitsQuery.findById(tx, id);
      if (!current) throw new AppError('Sala não encontrada', 404);
      if (current.active) throw new AppError('Sala já está ativa', 409);

      const updated = await UnitsQuery.setActive(tx, id, true);
      if (!updated) throw new AppError('Sala não encontrada', 404);
      return updated;
    });
  },

  remove: async (tenantId: string, id: string): Promise<void> => {
    try {
      const deleted = await withTenant(db, tenantId, async (tx) => {
        return UnitsQuery.delete(tx, id);
      });
      if (!deleted) throw new AppError('Sala não encontrada', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // 23503 = foreign_key_violation. appointments.unit_id é ON DELETE RESTRICT.
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Sala vinculada a agendamentos — desative em vez de excluir',
          409
        );
      }
      throw err;
    }
  },
};
