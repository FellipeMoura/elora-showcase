import {
  and,
  contractTemplates,
  eq,
  ilike,
  sql,
  type SQL,
  type Tx,
} from '@elora/db';
import { ConsentTemplateProceduresQuery } from './ConsentTemplateProceduresQuery.js';
import type {
  ContractTemplate,
  ContractTemplateWithProcedures,
} from './ContractTemplatesTypes.js';

interface FindFilters {
  q?: string;
  kind?: 'consent_term' | 'service_contract' | 'image_release' | 'other';
  active?: boolean;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  name: string;
  kind: 'consent_term' | 'service_contract' | 'image_release' | 'other';
  zapsignTemplateId: string;
  variables: string[];
}

interface UpdatePatch {
  name?: string;
  kind?: 'consent_term' | 'service_contract' | 'image_release' | 'other';
  zapsignTemplateId?: string;
  variables?: string[];
  active?: boolean;
}

// Denormaliza `procedures` nos templates consent_term de um conjunto (página
// ou item único). 1 query em lote cobre todos — sem N+1. Outros kinds passam
// inalterados (sem o campo). Mesma tx das queries pra respeitar RLS.
async function attachProcedures(
  tx: Tx,
  templates: ContractTemplate[],
): Promise<ContractTemplateWithProcedures[]> {
  const consentIds = templates
    .filter((t) => t.kind === 'consent_term')
    .map((t) => t.id);
  if (consentIds.length === 0) return templates;

  const links = await ConsentTemplateProceduresQuery.listByTemplateIds(
    tx,
    consentIds,
  );
  const byTemplate = new Map<string, { id: string; name: string }[]>();
  for (const link of links) {
    const arr = byTemplate.get(link.templateId) ?? [];
    arr.push({ id: link.id, name: link.name });
    byTemplate.set(link.templateId, arr);
  }

  return templates.map((t) =>
    t.kind === 'consent_term'
      ? { ...t, procedures: byTemplate.get(t.id) ?? [] }
      : t,
  );
}

export const ContractTemplatesQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL,
  ): Promise<{ items: ContractTemplateWithProcedures[]; total: number }> => {
    const conds: SQL[] = [];
    if (filters.q) {
      conds.push(ilike(contractTemplates.name, `%${filters.q}%`));
    }
    if (filters.kind) {
      conds.push(eq(contractTemplates.kind, filters.kind));
    }
    if (filters.active !== undefined) {
      conds.push(eq(contractTemplates.active, filters.active));
    }
    const where = conds.length > 0 ? and(...conds) : undefined;

    const offset = (pagination.page - 1) * pagination.pageSize;

    // Serializadas — transação Drizzle usa 1 conexão; paralelo quebra o protocolo.
    const items = await tx
      .select()
      .from(contractTemplates)
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(contractTemplates)
      .where(where);

    return {
      items: await attachProcedures(tx, items),
      total: totalRow?.count ?? 0,
    };
  },

  findById: async (
    tx: Tx,
    id: string,
  ): Promise<ContractTemplateWithProcedures | null> => {
    const rows = await tx
      .select()
      .from(contractTemplates)
      .where(eq(contractTemplates.id, id))
      .limit(1);
    const template = rows[0];
    if (!template) return null;
    const [withProcs] = await attachProcedures(tx, [template]);
    return withProcs;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput,
  ): Promise<ContractTemplate> => {
    const [row] = await tx
      .insert(contractTemplates)
      .values({
        tenantId,
        name: input.name,
        kind: input.kind,
        zapsignTemplateId: input.zapsignTemplateId,
        variables: input.variables,
      })
      .returning();
    if (!row) throw new Error('Falha ao criar template de contrato');
    return row;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdatePatch,
  ): Promise<ContractTemplate | null> => {
    const updates: Record<string, unknown> = {};
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.kind !== undefined) updates.kind = patch.kind;
    if (patch.zapsignTemplateId !== undefined)
      updates.zapsignTemplateId = patch.zapsignTemplateId;
    if (patch.variables !== undefined) updates.variables = patch.variables;
    if (patch.active !== undefined) updates.active = patch.active;

    if (Object.keys(updates).length === 0) {
      return ContractTemplatesQuery.findById(tx, id);
    }

    const [row] = await tx
      .update(contractTemplates)
      .set(updates)
      .where(eq(contractTemplates.id, id))
      .returning();
    return row ?? null;
  },

  delete: async (tx: Tx, id: string): Promise<boolean> => {
    const rows = await tx
      .delete(contractTemplates)
      .where(eq(contractTemplates.id, id))
      .returning({ id: contractTemplates.id });
    return rows.length > 0;
  },
};
