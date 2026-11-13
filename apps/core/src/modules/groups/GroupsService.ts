import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  type PaginatedResult,
  totalPagesOf,
} from '../../shared/types/pagination.js';
import { UsersQuery } from '../users/UsersQuery.js';
import type { PublicUser, User } from '../users/UsersTypes.js';
import { GroupsQuery } from './GroupsQuery.js';
import type {
  CreateGroupInput,
  FindGroupsQuery,
  Group,
  UpdateGroupInput,
} from './GroupsTypes.js';

function toPublicUser(user: User): PublicUser {
  const { passwordHash: _, ...rest } = user;
  return rest;
}

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

// CRUD opera no catálogo GLOBAL — sem withTenant. Membership (list/add/remove
// member) é tenant-scoped (user_groups tem RLS), então usa withTenant.
export const GroupsService = {
  find: async (query: FindGroupsQuery): Promise<PaginatedResult<Group>> => {
    const active = query.status === 'all' ? undefined : query.status === 'active';
    const { items, total } = await GroupsQuery.findPaginated(
      db,
      { q: query.q, active, roleCode: query.roleCode },
      { page: query.page, pageSize: query.pageSize }
    );
    return {
      items,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: totalPagesOf(total, query.pageSize),
    };
  },

  findById: async (id: string): Promise<Group> => {
    const group = await GroupsQuery.findById(db, id);
    if (!group) throw new AppError('Grupo não encontrado', 404);
    return group;
  },

  create: async (input: CreateGroupInput): Promise<Group> => {
    const existing = await GroupsQuery.findByName(db, input.name);
    if (existing) throw new AppError('Já existe um grupo com este nome', 409);
    try {
      return await GroupsQuery.create(db, input);
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        // unique violation — roleCode duplicado (1:1 com role_code).
        throw new AppError('Já existe um grupo com este role_code', 409);
      }
      throw err;
    }
  },

  update: async (id: string, input: UpdateGroupInput): Promise<Group> => {
    const current = await GroupsQuery.findById(db, id);
    if (!current) throw new AppError('Grupo não encontrado', 404);

    if (input.name && input.name !== current.name) {
      const existing = await GroupsQuery.findByName(db, input.name, id);
      if (existing) throw new AppError('Já existe um grupo com este nome', 409);
    }

    try {
      const updated = await GroupsQuery.update(db, id, input);
      if (!updated) throw new AppError('Grupo não encontrado', 404);
      return updated;
    } catch (err) {
      if (isPgError(err) && err.code === '23505') {
        throw new AppError('Conflito de unicidade (name ou role_code)', 409);
      }
      throw err;
    }
  },

  remove: async (id: string): Promise<void> => {
    try {
      const deleted = await GroupsQuery.delete(db, id);
      if (!deleted) throw new AppError('Grupo não encontrado', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Grupo possui registros vinculados e não pode ser removido',
          409
        );
      }
      throw err;
    }
  },

  deactivate: async (id: string): Promise<Group> => {
    const current = await GroupsQuery.findById(db, id);
    if (!current) throw new AppError('Grupo não encontrado', 404);
    if (!current.active) throw new AppError('Grupo já está desativado', 409);
    const updated = await GroupsQuery.setActive(db, id, false);
    if (!updated) throw new AppError('Grupo não encontrado', 404);
    return updated;
  },

  activate: async (id: string): Promise<Group> => {
    const current = await GroupsQuery.findById(db, id);
    if (!current) throw new AppError('Grupo não encontrado', 404);
    if (current.active) throw new AppError('Grupo já está ativo', 409);
    const updated = await GroupsQuery.setActive(db, id, true);
    if (!updated) throw new AppError('Grupo não encontrado', 404);
    return updated;
  },

  // ---- Membership (tenant-scoped) ----

  listMembers: async (tenantId: string, groupId: string): Promise<PublicUser[]> => {
    const group = await GroupsQuery.findById(db, groupId);
    if (!group) throw new AppError('Grupo não encontrado', 404);
    return withTenant(db, tenantId, async (tx) => {
      const members = await GroupsQuery.listMembers(tx, groupId);
      return members.map(toPublicUser);
    });
  },

  addMember: async (
    tenantId: string,
    groupId: string,
    userId: string
  ): Promise<void> => {
    const group = await GroupsQuery.findById(db, groupId);
    if (!group) throw new AppError('Grupo não encontrado', 404);
    return withTenant(db, tenantId, async (tx) => {
      const user = await UsersQuery.findById(tx, userId);
      // RLS já garante mesmo tenant — findById retorna undefined se for outro.
      if (!user) throw new AppError('Usuário não encontrado', 404);
      const already = await GroupsQuery.isMember(tx, groupId, userId);
      if (already) throw new AppError('Usuário já é membro deste grupo', 409);
      await GroupsQuery.addMember(tx, tenantId, groupId, userId);
    });
  },

  removeMember: async (
    tenantId: string,
    groupId: string,
    userId: string
  ): Promise<void> => {
    return withTenant(db, tenantId, async (tx) => {
      const removed = await GroupsQuery.removeMember(tx, groupId, userId);
      if (!removed) throw new AppError('Membro não encontrado neste grupo', 404);
    });
  },
};
