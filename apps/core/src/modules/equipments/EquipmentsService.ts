import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { EquipmentsQuery } from './EquipmentsQuery.js';
import { equipmentsSortSpec } from './EquipmentsTypes.js';
import type {
  CreateEquipmentInput,
  Equipment,
  FindEquipmentsQuery,
  UpdateEquipmentInput,
} from './EquipmentsTypes.js';

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export const EquipmentsService = {
  find: async (
    tenantId: string,
    query: FindEquipmentsQuery
  ): Promise<PaginatedResult<Equipment>> => {
    return withTenant(db, tenantId, async (tx) => {
      const active = query.status === 'all' ? undefined : query.status === 'active';
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        equipmentsSortSpec
      );
      const { items, total } = await EquipmentsQuery.findPaginated(
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

  findById: async (tenantId: string, id: string): Promise<Equipment> => {
    return withTenant(db, tenantId, async (tx) => {
      const row = await EquipmentsQuery.findById(tx, id);
      if (!row) throw new AppError('Equipamento não encontrado', 404);
      return row;
    });
  },

  create: async (
    tenantId: string,
    input: CreateEquipmentInput
  ): Promise<Equipment> => {
    return withTenant(db, tenantId, async (tx) => {
      try {
        return await EquipmentsQuery.create(tx, tenantId, input);
      } catch (err) {
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe um equipamento com este nome neste tenant',
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
    input: UpdateEquipmentInput
  ): Promise<Equipment> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await EquipmentsQuery.findById(tx, id);
      if (!current) throw new AppError('Equipamento não encontrado', 404);

      try {
        const updated = await EquipmentsQuery.update(tx, id, input);
        if (!updated) throw new AppError('Equipamento não encontrado', 404);
        return updated;
      } catch (err) {
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe um equipamento com este nome neste tenant',
            409
          );
        }
        throw err;
      }
    });
  },

  deactivate: async (tenantId: string, id: string): Promise<Equipment> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await EquipmentsQuery.findById(tx, id);
      if (!current) throw new AppError('Equipamento não encontrado', 404);
      if (!current.active) throw new AppError('Equipamento já está desativado', 409);

      const updated = await EquipmentsQuery.setActive(tx, id, false);
      if (!updated) throw new AppError('Equipamento não encontrado', 404);
      return updated;
    });
  },

  activate: async (tenantId: string, id: string): Promise<Equipment> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await EquipmentsQuery.findById(tx, id);
      if (!current) throw new AppError('Equipamento não encontrado', 404);
      if (current.active) throw new AppError('Equipamento já está ativo', 409);

      const updated = await EquipmentsQuery.setActive(tx, id, true);
      if (!updated) throw new AppError('Equipamento não encontrado', 404);
      return updated;
    });
  },

  remove: async (tenantId: string, id: string): Promise<void> => {
    try {
      const deleted = await withTenant(db, tenantId, async (tx) => {
        return EquipmentsQuery.delete(tx, id);
      });
      if (!deleted) throw new AppError('Equipamento não encontrado', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // FK em appointments.equipment_id é ON DELETE SET NULL, então delete não
      // deveria estourar 23503. Mantido por segurança em mudanças futuras.
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Equipamento vinculado a registros — desative em vez de excluir',
          409
        );
      }
      throw err;
    }
  },
};
