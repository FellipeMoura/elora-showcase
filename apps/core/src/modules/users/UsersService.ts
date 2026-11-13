import { hashPassword } from '@elora/auth';
import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { GroupsQuery } from '../groups/GroupsQuery.js';
import { UsersQuery } from './UsersQuery.js';
import type {
  CreateUserInput,
  FindUsersQuery,
  PublicUser,
  UpdateUserInput,
  User,
  UserWithGroups,
} from './UsersTypes.js';

function toPublic(user: User): PublicUser {
  const { passwordHash: _, ...rest } = user;
  return rest;
}

function withGroups(user: User, groupIds: string[]): UserWithGroups {
  return { ...toPublic(user), groupIds };
}

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export const UsersService = {
  find: async (
    tenantId: string,
    query: FindUsersQuery
  ): Promise<PaginatedResult<UserWithGroups>> => {
    return withTenant(db, tenantId, async (tx) => {
      const active = query.status === 'all' ? undefined : query.status === 'active';
      const { items, total } = await UsersQuery.findPaginated(
        tx,
        { q: query.q, active },
        { page: query.page, pageSize: query.pageSize }
      );
      // Popular groupIds em uma query — evita N+1 ao listar.
      const memberships = await UsersQuery.listMembershipsForUsers(
        tx,
        items.map((u) => u.id)
      );
      const groupsByUser = new Map<string, string[]>();
      for (const m of memberships) {
        const arr = groupsByUser.get(m.userId) ?? [];
        arr.push(m.groupId);
        groupsByUser.set(m.userId, arr);
      }
      return {
        items: items.map((u) => withGroups(u, groupsByUser.get(u.id) ?? [])),
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: totalPagesOf(total, query.pageSize),
      };
    });
  },

  create: async (tenantId: string, input: CreateUserInput): Promise<UserWithGroups> => {
    return withTenant(db, tenantId, async (tx) => {
      const existing = await UsersQuery.findByUsername(tx, input.username);
      if (existing) throw new AppError('Username já cadastrado neste tenant', 409);

      const passwordHash = await hashPassword(input.password);
      const user = await UsersQuery.create(tx, tenantId, {
        username: input.username,
        email: input.email ?? null,
        name: input.name,
        passwordHash,
        canEvaluate: input.canEvaluate,
        canApplyProcedures: input.canApplyProcedures,
      });
      return withGroups(user, []);
    });
  },

  update: async (
    tenantId: string,
    id: string,
    input: UpdateUserInput
  ): Promise<UserWithGroups> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await UsersQuery.findById(tx, id);
      if (!current) throw new AppError('Usuário não encontrado', 404);

      if (input.username && input.username !== current.username) {
        const existing = await UsersQuery.findByUsername(tx, input.username);
        if (existing) throw new AppError('Username já cadastrado neste tenant', 409);
      }

      const patch: {
        username?: string;
        email?: string | null;
        name?: string;
        passwordHash?: string;
        canEvaluate?: boolean;
        canApplyProcedures?: boolean;
      } = {};
      if (input.username !== undefined) patch.username = input.username;
      if (input.email !== undefined) patch.email = input.email;
      if (input.name !== undefined) patch.name = input.name;
      if (input.password !== undefined) {
        patch.passwordHash = await hashPassword(input.password);
      }
      if (input.canEvaluate !== undefined) patch.canEvaluate = input.canEvaluate;
      if (input.canApplyProcedures !== undefined) {
        patch.canApplyProcedures = input.canApplyProcedures;
      }

      const updated = await UsersQuery.update(tx, id, patch);
      if (!updated) throw new AppError('Usuário não encontrado', 404);
      const groupIds = await UsersQuery.listUserGroupIds(tx, id);
      return withGroups(updated, groupIds);
    });
  },

  // Desativação fica como operação dedicada (não via update) porque é ponto
  // natural pra futuras rotinas: invalidar sessões, notificar, cancelar
  // agendamentos futuros, registrar auditoria, etc.
  deactivate: async (tenantId: string, id: string): Promise<UserWithGroups> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await UsersQuery.findById(tx, id);
      if (!current) throw new AppError('Usuário não encontrado', 404);
      if (!current.active) throw new AppError('Usuário já está desativado', 409);

      const updated = await UsersQuery.setActive(tx, id, false);
      if (!updated) throw new AppError('Usuário não encontrado', 404);

      // TODO: rotinas adicionais (invalidar sessões, cancelar agendamentos,
      // notificar admin, auditar) entram aqui conforme forem implementadas.

      const groupIds = await UsersQuery.listUserGroupIds(tx, id);
      return withGroups(updated, groupIds);
    });
  },

  activate: async (tenantId: string, id: string): Promise<UserWithGroups> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await UsersQuery.findById(tx, id);
      if (!current) throw new AppError('Usuário não encontrado', 404);
      if (current.active) throw new AppError('Usuário já está ativo', 409);

      const updated = await UsersQuery.setActive(tx, id, true);
      if (!updated) throw new AppError('Usuário não encontrado', 404);

      // TODO: rotinas adicionais (revalidar permissões, notificar, auditar)
      // entram aqui conforme forem implementadas.

      const groupIds = await UsersQuery.listUserGroupIds(tx, id);
      return withGroups(updated, groupIds);
    });
  },

  // Substitui a lista de grupos do user (set idempotente). Valida que
  // todos os grupos passados existem no catálogo global (groups é tabela
  // sem RLS — query direto no db).
  setGroups: async (
    tenantId: string,
    userId: string,
    groupIds: string[]
  ): Promise<UserWithGroups> => {
    const uniqueIds = [...new Set(groupIds)];

    return withTenant(db, tenantId, async (tx) => {
      const current = await UsersQuery.findById(tx, userId);
      if (!current) throw new AppError('Usuário não encontrado', 404);

      // Valida existência no catálogo global. GroupsQuery aceita DbOrTx; aqui
      // passamos a transação tenant-scoped — sem problema (groups não tem RLS).
      for (const gid of uniqueIds) {
        const g = await GroupsQuery.findById(tx, gid);
        if (!g) throw new AppError(`Grupo inexistente: ${gid}`, 400);
      }

      await UsersQuery.setUserGroups(tx, tenantId, userId, uniqueIds);
      return withGroups(current, uniqueIds);
    });
  },

  remove: async (tenantId: string, id: string): Promise<void> => {
    try {
      const deleted = await withTenant(db, tenantId, async (tx) => {
        return UsersQuery.delete(tx, id);
      });
      if (!deleted) throw new AppError('Usuário não encontrado', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // 23503 = foreign_key_violation no Postgres. Disparado quando outra
      // tabela referencia esse user via FK sem ON DELETE CASCADE.
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Usuário possui registros vinculados e não pode ser removido',
          409
        );
      }
      throw err;
    }
  },
};
