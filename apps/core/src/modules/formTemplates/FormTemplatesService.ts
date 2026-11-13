import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { FormTemplatesQuery } from './FormTemplatesQuery.js';
import { formTemplatesSortSpec } from './FormTemplatesTypes.js';
import type {
  CreateFormQuestionInput,
  CreateFormTemplateInput,
  FindFormTemplatesQuery,
  FormQuestion,
  FormTemplate,
  UpdateFormQuestionInput,
  UpdateFormTemplateInput,
} from './FormTemplatesTypes.js';

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export const FormTemplatesService = {
  findTemplates: async (
    tenantId: string,
    query: FindFormTemplatesQuery
  ): Promise<PaginatedResult<FormTemplate>> => {
    return withTenant(db, tenantId, async (tx) => {
      const active = query.status === 'all' ? undefined : query.status === 'active';
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        formTemplatesSortSpec
      );
      const { items, total } = await FormTemplatesQuery.findTemplatesPaginated(
        tx,
        { q: query.q, active, requiredForEvaluation: query.requiredForEvaluation },
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

  findTemplateById: async (tenantId: string, id: string): Promise<FormTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      const template = await FormTemplatesQuery.findTemplateById(tx, id);
      if (!template) throw new AppError('Template não encontrado', 404);
      return template;
    });
  },

  createTemplate: async (
    tenantId: string,
    input: CreateFormTemplateInput
  ): Promise<FormTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      try {
        return await FormTemplatesQuery.createTemplate(tx, tenantId, input);
      } catch (err) {
        // unique (tenant_id, name).
        if (isPgError(err) && err.code === '23505') {
          throw new AppError('Já existe um template com este nome', 409);
        }
        throw err;
      }
    });
  },

  updateTemplate: async (
    tenantId: string,
    id: string,
    input: UpdateFormTemplateInput
  ): Promise<FormTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await FormTemplatesQuery.findTemplateById(tx, id);
      if (!current) throw new AppError('Template não encontrado', 404);

      try {
        const updated = await FormTemplatesQuery.updateTemplate(tx, id, input);
        if (!updated) throw new AppError('Template não encontrado', 404);
        return updated;
      } catch (err) {
        if (isPgError(err) && err.code === '23505') {
          throw new AppError('Já existe um template com este nome', 409);
        }
        throw err;
      }
    });
  },

  deactivateTemplate: async (tenantId: string, id: string): Promise<FormTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await FormTemplatesQuery.findTemplateById(tx, id);
      if (!current) throw new AppError('Template não encontrado', 404);
      if (!current.active) throw new AppError('Template já está desativado', 409);

      const updated = await FormTemplatesQuery.setTemplateActive(tx, id, false);
      if (!updated) throw new AppError('Template não encontrado', 404);
      return updated;
    });
  },

  activateTemplate: async (tenantId: string, id: string): Promise<FormTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await FormTemplatesQuery.findTemplateById(tx, id);
      if (!current) throw new AppError('Template não encontrado', 404);
      if (current.active) throw new AppError('Template já está ativo', 409);

      const updated = await FormTemplatesQuery.setTemplateActive(tx, id, true);
      if (!updated) throw new AppError('Template não encontrado', 404);
      return updated;
    });
  },

  removeTemplate: async (tenantId: string, id: string): Promise<void> => {
    try {
      const deleted = await withTenant(db, tenantId, async (tx) => {
        return FormTemplatesQuery.deleteTemplate(tx, id);
      });
      if (!deleted) throw new AppError('Template não encontrado', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // client_forms.form_template_id é ON DELETE RESTRICT.
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Template possui fichas preenchidas — desative em vez de excluir',
          409
        );
      }
      throw err;
    }
  },

  // Questions -------------------------------------------------------

  findQuestionsByTemplate: async (
    tenantId: string,
    templateId: string
  ): Promise<FormQuestion[]> => {
    return withTenant(db, tenantId, async (tx) => {
      const template = await FormTemplatesQuery.findTemplateById(tx, templateId);
      if (!template) throw new AppError('Template não encontrado', 404);
      return FormTemplatesQuery.findQuestionsByTemplate(tx, templateId);
    });
  },

  createQuestion: async (
    tenantId: string,
    templateId: string,
    input: CreateFormQuestionInput
  ): Promise<FormQuestion> => {
    return withTenant(db, tenantId, async (tx) => {
      const template = await FormTemplatesQuery.findTemplateById(tx, templateId);
      if (!template) throw new AppError('Template não encontrado', 404);
      return FormTemplatesQuery.createQuestion(tx, tenantId, templateId, input);
    });
  },

  updateQuestion: async (
    tenantId: string,
    templateId: string,
    questionId: string,
    input: UpdateFormQuestionInput
  ): Promise<FormQuestion> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await FormTemplatesQuery.findQuestionById(tx, questionId);
      if (!current) throw new AppError('Pergunta não encontrada', 404);
      if (current.formTemplateId !== templateId) {
        throw new AppError('Pergunta não pertence a este template', 404);
      }

      // Mudança de questionType invalida options se o novo tipo não usa.
      // Por simplicidade, exigimos que o caller envie options compatíveis.
      const updated = await FormTemplatesQuery.updateQuestion(tx, questionId, input);
      if (!updated) throw new AppError('Pergunta não encontrada', 404);
      return updated;
    });
  },

  removeQuestion: async (
    tenantId: string,
    templateId: string,
    questionId: string
  ): Promise<void> => {
    await withTenant(db, tenantId, async (tx) => {
      const current = await FormTemplatesQuery.findQuestionById(tx, questionId);
      if (!current) throw new AppError('Pergunta não encontrada', 404);
      if (current.formTemplateId !== templateId) {
        throw new AppError('Pergunta não pertence a este template', 404);
      }
      // form_answers tem cascade delete via FK — apagar pergunta apaga
      // respostas associadas. Auditoria preservada via journey_events
      // (form_completed) caso tenha sido marcado.
      const deleted = await FormTemplatesQuery.deleteQuestion(tx, questionId);
      if (!deleted) throw new AppError('Pergunta não encontrada', 404);
    });
  },
};
