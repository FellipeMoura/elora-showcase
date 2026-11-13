import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { ClientsQuery } from './ClientsQuery.js';
import { clientsSortSpec } from './ClientsTypes.js';
import type {
  ClientWithChat,
  CreateClientInput,
  FindClientsQuery,
  UpdateClientInput,
} from './ClientsTypes.js';

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export const ClientsService = {
  find: async (
    tenantId: string,
    query: FindClientsQuery
  ): Promise<PaginatedResult<ClientWithChat>> => {
    return withTenant(db, tenantId, async (tx) => {
      const active = query.status === 'all' ? undefined : query.status === 'active';
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        clientsSortSpec
      );
      const { items, total } = await ClientsQuery.findPaginated(
        tx,
        { q: query.q, active, isVip: query.isVip },
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

  // Lookup pelo telefone — feedback em tempo real do form de cadastro.
  // Não 404: caller espera saber se EXISTE, ausência é resposta válida.
  // RLS já garante isolamento; consulta direta no `clients` é segura.
  checkByPhone: async (
    tenantId: string,
    phoneE164: string,
  ): Promise<{
    exists: boolean;
    client: { id: string; name: string; active: boolean } | null;
  }> => {
    return withTenant(db, tenantId, async (tx) => {
      const client = await ClientsQuery.findByPhone(tx, phoneE164);
      if (!client) return { exists: false, client: null };
      return {
        exists: true,
        client: { id: client.id, name: client.name, active: client.active },
      };
    });
  },

  findById: async (tenantId: string, id: string): Promise<ClientWithChat> => {
    return withTenant(db, tenantId, async (tx) => {
      const client = await ClientsQuery.findById(tx, id);
      if (!client) throw new AppError('Cliente não encontrado', 404);
      return client;
    });
  },

  create: async (tenantId: string, input: CreateClientInput): Promise<ClientWithChat> => {
    return withTenant(db, tenantId, async (tx) => {
      try {
        const created = await ClientsQuery.create(tx, tenantId, input);
        // Cliente acabou de nascer: nunca tem contact/conversation. Spread
        // direto sem refetch evita ida extra ao banco.
        return {
          ...created,
          whatsappContactId: null,
          whatsappChannelId: null,
          conversationId: null,
          currentJourneyStage: null,
        };
      } catch (err) {
        // 23505 = unique_violation. Schema tem unique (tenant_id, phone_e164) —
        // dois cadastros com mesmo telefone caem aqui.
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe um cliente com este telefone neste tenant',
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
    input: UpdateClientInput
  ): Promise<ClientWithChat> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ClientsQuery.findById(tx, id);
      if (!current) throw new AppError('Cliente não encontrado', 404);

      try {
        const updated = await ClientsQuery.update(tx, id, input);
        if (!updated) throw new AppError('Cliente não encontrado', 404);
      } catch (err) {
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe um cliente com este telefone neste tenant',
            409
          );
        }
        throw err;
      }
      // Refetch via findById pra surfacear whatsappContactId/conversationId
      // (que o update direto não traz porque retorna só colunas da tabela).
      const enriched = await ClientsQuery.findById(tx, id);
      if (!enriched) throw new AppError('Cliente não encontrado após update', 500);
      return enriched;
    });
  },

  // Desativação fica como operação dedicada (não via update) porque é ponto
  // natural pra futuras rotinas: cancelar agendamentos futuros, registrar
  // auditoria, alertar journeys ativas, etc.
  deactivate: async (tenantId: string, id: string): Promise<ClientWithChat> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ClientsQuery.findById(tx, id);
      if (!current) throw new AppError('Cliente não encontrado', 404);
      if (!current.active) throw new AppError('Cliente já está desativado', 409);

      const updated = await ClientsQuery.setActive(tx, id, false);
      if (!updated) throw new AppError('Cliente não encontrado', 404);

      // TODO: rotinas adicionais (cancelar agendamentos futuros, encerrar
      // journeys ativas, auditar) entram aqui conforme forem implementadas.

      const enriched = await ClientsQuery.findById(tx, id);
      if (!enriched) throw new AppError('Cliente não encontrado após update', 500);
      return enriched;
    });
  },

  activate: async (tenantId: string, id: string): Promise<ClientWithChat> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ClientsQuery.findById(tx, id);
      if (!current) throw new AppError('Cliente não encontrado', 404);
      if (current.active) throw new AppError('Cliente já está ativo', 409);

      const updated = await ClientsQuery.setActive(tx, id, true);
      if (!updated) throw new AppError('Cliente não encontrado', 404);
      const enriched = await ClientsQuery.findById(tx, id);
      if (!enriched) throw new AppError('Cliente não encontrado após update', 500);
      return enriched;
    });
  },

  remove: async (tenantId: string, id: string): Promise<void> => {
    try {
      const deleted = await withTenant(db, tenantId, async (tx) => {
        return ClientsQuery.delete(tx, id);
      });
      if (!deleted) throw new AppError('Cliente não encontrado', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // 23503 = foreign_key_violation no Postgres. Disparado quando outra
      // tabela referencia esse cliente via FK sem ON DELETE CASCADE
      // (journeys, appointments, etc.).
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Cliente possui registros vinculados e não pode ser removido — desative em vez de excluir',
          409
        );
      }
      throw err;
    }
  },
};
