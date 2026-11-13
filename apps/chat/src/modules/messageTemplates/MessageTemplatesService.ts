import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  type PaginatedResult,
  totalPagesOf,
} from '../../shared/types/pagination.js';
import { MessageTemplatesQuery } from './MessageTemplatesQuery.js';
import type {
  CreateTemplateInput,
  FindTemplatesQuery,
  MessageTemplate,
  UpdateTemplateInput,
} from './MessageTemplatesTypes.js';

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export const MessageTemplatesService = {
  find: async (
    tenantId: string,
    query: FindTemplatesQuery
  ): Promise<PaginatedResult<MessageTemplate>> => {
    return withTenant(db, tenantId, async (tx) => {
      const active = query.status === 'all' ? undefined : query.status === 'active';
      const { items, total } = await MessageTemplatesQuery.findPaginated(
        tx,
        { q: query.q, kind: query.kind, stage: query.stage, active },
        { page: query.page, pageSize: query.pageSize }
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

  findById: async (tenantId: string, id: string): Promise<MessageTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      const template = await MessageTemplatesQuery.findById(tx, id);
      if (!template) throw new AppError('Template não encontrado', 404);
      return template;
    });
  },

  create: async (
    tenantId: string,
    input: CreateTemplateInput
  ): Promise<MessageTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      const existing = await MessageTemplatesQuery.findByNameInTenant(tx, input.name);
      if (existing) throw new AppError('Já existe um template com este nome', 409);
      return MessageTemplatesQuery.create(tx, tenantId, input);
    });
  },

  update: async (
    tenantId: string,
    id: string,
    input: UpdateTemplateInput
  ): Promise<MessageTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await MessageTemplatesQuery.findById(tx, id);
      if (!current) throw new AppError('Template não encontrado', 404);

      if (input.name && input.name !== current.name) {
        const existing = await MessageTemplatesQuery.findByNameInTenant(tx, input.name, id);
        if (existing) throw new AppError('Já existe um template com este nome', 409);
      }

      const updated = await MessageTemplatesQuery.update(tx, id, input);
      if (!updated) throw new AppError('Template não encontrado', 404);
      return updated;
    });
  },

  remove: async (tenantId: string, id: string): Promise<void> => {
    try {
      const deleted = await withTenant(db, tenantId, async (tx) => {
        return MessageTemplatesQuery.delete(tx, id);
      });
      if (!deleted) throw new AppError('Template não encontrado', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // FK: whatsapp_templates (cascade) e automations (restrict). Só
      // automations gera conflito aqui.
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Template está em uso por automações e não pode ser removido. Desative em vez de excluir.',
          409
        );
      }
      throw err;
    }
  },

  deactivate: async (tenantId: string, id: string): Promise<MessageTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await MessageTemplatesQuery.findById(tx, id);
      if (!current) throw new AppError('Template não encontrado', 404);
      if (!current.active) throw new AppError('Template já está desativado', 409);
      const updated = await MessageTemplatesQuery.setActive(tx, id, false);
      if (!updated) throw new AppError('Template não encontrado', 404);
      return updated;
    });
  },

  activate: async (tenantId: string, id: string): Promise<MessageTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await MessageTemplatesQuery.findById(tx, id);
      if (!current) throw new AppError('Template não encontrado', 404);
      if (current.active) throw new AppError('Template já está ativo', 409);
      const updated = await MessageTemplatesQuery.setActive(tx, id, true);
      if (!updated) throw new AppError('Template não encontrado', 404);
      return updated;
    });
  },
};
