import { eq, procedures as proceduresTable, withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { getSignatureProvider } from '../../shared/providers/signature/index.js';
import type {
  ProviderTemplateInfo,
  ProviderTemplateSummary,
} from '../../shared/providers/signature/index.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import {
  ConsentTemplateProceduresQuery,
  type TemplateProcedure,
} from './ConsentTemplateProceduresQuery.js';
import { ContractTemplatesQuery } from './ContractTemplatesQuery.js';
import {
  contractTemplatesSortSpec,
  type ContractTemplate,
  type ContractTemplateWithProcedures,
  type CreateContractTemplateInput,
  type FindContractTemplatesQuery,
  type UpdateContractTemplateInput,
} from './ContractTemplatesTypes.js';

export interface ZapsignPanelInfo {
  panelUrl: string;
  isSandbox: boolean;
  configured: boolean;
}

interface PgError extends Error {
  code?: string;
}

function isPgError(err: unknown): err is PgError {
  return err instanceof Error && typeof (err as PgError).code === 'string';
}

export const ContractTemplatesService = {
  find: async (
    tenantId: string,
    query: FindContractTemplatesQuery,
  ): Promise<PaginatedResult<ContractTemplateWithProcedures>> => {
    return withTenant(db, tenantId, async (tx) => {
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        contractTemplatesSortSpec,
      );
      const { items, total } = await ContractTemplatesQuery.findPaginated(
        tx,
        { q: query.q, kind: query.kind, active: query.active },
        { page: query.page, pageSize: query.pageSize },
        orderBy,
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
    id: string,
  ): Promise<ContractTemplateWithProcedures> => {
    return withTenant(db, tenantId, async (tx) => {
      const template = await ContractTemplatesQuery.findById(tx, id);
      if (!template) throw new AppError('Template de contrato não encontrado', 404);
      return template;
    });
  },

  create: async (
    tenantId: string,
    input: CreateContractTemplateInput,
  ): Promise<ContractTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      try {
        return await ContractTemplatesQuery.create(tx, tenantId, {
          name: input.name,
          kind: input.kind,
          zapsignTemplateId: input.zapsignTemplateId,
          variables: input.variables,
        });
      } catch (err) {
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe um template com este nome neste tenant',
            409,
          );
        }
        throw err;
      }
    });
  },

  update: async (
    tenantId: string,
    id: string,
    patch: UpdateContractTemplateInput,
  ): Promise<ContractTemplate> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await ContractTemplatesQuery.findById(tx, id);
      if (!current) throw new AppError('Template de contrato não encontrado', 404);
      try {
        const updated = await ContractTemplatesQuery.update(tx, id, patch);
        if (!updated) throw new AppError('Template de contrato não encontrado', 404);
        return updated;
      } catch (err) {
        if (isPgError(err) && err.code === '23505') {
          throw new AppError(
            'Já existe um template com este nome neste tenant',
            409,
          );
        }
        throw err;
      }
    });
  },

  // =====================================================================
  // Auxiliares ZapSign — usados pelo cadastro do apontamento no front pra
  // (1) linkar pro painel ZapSign e (2) preencher automaticamente as
  // variáveis em vez de o admin digitar uma por uma.
  // =====================================================================

  getZapsignPanelInfo: (): ZapsignPanelInfo => {
    const provider = getSignatureProvider();
    return {
      panelUrl: provider.panelUrl,
      isSandbox: provider.isSandbox,
      configured: provider.isConfigured,
    };
  },

  inspectZapsignTemplate: async (
    externalTemplateId: string,
  ): Promise<ProviderTemplateInfo> => {
    const provider = getSignatureProvider();
    return provider.getTemplate(externalTemplateId);
  },

  listZapsignTemplates: async (): Promise<ProviderTemplateSummary[]> => {
    const provider = getSignatureProvider();
    return provider.listTemplates();
  },

  // =====================================================================
  // Vínculo template × procedimento (Fase 7). Só templates consent_term.
  // Os três devolvem a lista atualizada de procedimentos pra UI reusar.
  // =====================================================================

  listProcedures: async (
    tenantId: string,
    templateId: string,
  ): Promise<TemplateProcedure[]> => {
    return withTenant(db, tenantId, async (tx) => {
      const template = await ContractTemplatesQuery.findById(tx, templateId);
      if (!template) throw new AppError('Template de contrato não encontrado', 404);
      return ConsentTemplateProceduresQuery.list(tx, templateId);
    });
  },

  linkProcedure: async (
    tenantId: string,
    templateId: string,
    procedureId: string,
  ): Promise<TemplateProcedure[]> => {
    return withTenant(db, tenantId, async (tx) => {
      const template = await ContractTemplatesQuery.findById(tx, templateId);
      if (!template) throw new AppError('Template de contrato não encontrado', 404);
      if (template.kind !== 'consent_term') {
        throw new AppError(
          'Só templates de termo de consentimento podem ser vinculados a procedimentos',
          409,
        );
      }

      // Procedimento precisa existir no tenant (RLS já filtra no SELECT).
      const [proc] = await tx
        .select({ id: proceduresTable.id })
        .from(proceduresTable)
        .where(eq(proceduresTable.id, procedureId))
        .limit(1);
      if (!proc) throw new AppError('Procedimento não encontrado', 404);

      // Idempotente via onConflictDoNothing — re-vincular não é erro.
      await ConsentTemplateProceduresQuery.link(tx, tenantId, templateId, procedureId);
      return ConsentTemplateProceduresQuery.list(tx, templateId);
    });
  },

  unlinkProcedure: async (
    tenantId: string,
    templateId: string,
    procedureId: string,
  ): Promise<TemplateProcedure[]> => {
    return withTenant(db, tenantId, async (tx) => {
      const template = await ContractTemplatesQuery.findById(tx, templateId);
      if (!template) throw new AppError('Template de contrato não encontrado', 404);
      // Remover vínculo inexistente é no-op (idempotente) — não 404 no par.
      await ConsentTemplateProceduresQuery.unlink(tx, templateId, procedureId);
      return ConsentTemplateProceduresQuery.list(tx, templateId);
    });
  },

  remove: async (tenantId: string, id: string): Promise<void> => {
    try {
      const deleted = await withTenant(db, tenantId, async (tx) => {
        return ContractTemplatesQuery.delete(tx, id);
      });
      if (!deleted) throw new AppError('Template de contrato não encontrado', 404);
    } catch (err) {
      if (err instanceof AppError) throw err;
      // 23503 = FK violation. Disparado se há `contracts` referenciando esse
      // template (FK restrict). Mensagem orienta o admin a desativar.
      if (isPgError(err) && err.code === '23503') {
        throw new AppError(
          'Template possui contratos vinculados e não pode ser removido — desative em vez de excluir',
          409,
        );
      }
      throw err;
    }
  },
};
