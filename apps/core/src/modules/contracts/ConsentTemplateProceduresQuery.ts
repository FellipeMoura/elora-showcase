import {
  and,
  consentTemplateProcedures,
  contractTemplates,
  eq,
  inArray,
  procedures,
  type Tx,
} from '@elora/db';

// Procedimento vinculado a um template de termo (shape pra subtabela em Settings).
export interface TemplateProcedure {
  id: string;
  name: string;
}

// Versão em lote: carrega o templateId junto pra agrupar sem N+1 na listagem.
export interface TemplateProcedureLink extends TemplateProcedure {
  templateId: string;
}

// Template de termo que cobre ao menos 1 procedimento da venda (bulk).
// `variables` vem junto pra resolver os valores server-side sem reload.
export interface ConsentTemplateForProcedures {
  id: string;
  name: string;
  variables: string[];
}

export const ConsentTemplateProceduresQuery = {
  // Procedimentos vinculados a um template, ordenados por nome (UI estável).
  list: async (tx: Tx, templateId: string): Promise<TemplateProcedure[]> => {
    return tx
      .select({ id: procedures.id, name: procedures.name })
      .from(consentTemplateProcedures)
      .innerJoin(
        procedures,
        eq(procedures.id, consentTemplateProcedures.procedureId),
      )
      .where(eq(consentTemplateProcedures.templateId, templateId))
      .orderBy(procedures.name);
  },

  // Lote pra denormalizar a listagem de templates (findPaginated) sem N+1 —
  // 1 query cobre a página inteira em vez de 1 por template.
  listByTemplateIds: async (
    tx: Tx,
    templateIds: string[],
  ): Promise<TemplateProcedureLink[]> => {
    if (templateIds.length === 0) return [];
    return tx
      .select({
        templateId: consentTemplateProcedures.templateId,
        id: procedures.id,
        name: procedures.name,
      })
      .from(consentTemplateProcedures)
      .innerJoin(
        procedures,
        eq(procedures.id, consentTemplateProcedures.procedureId),
      )
      .where(inArray(consentTemplateProcedures.templateId, templateIds))
      .orderBy(procedures.name);
  },

  // Insere o vínculo. `tenantId` denormalizado (sem FK — pattern de sale_items).
  // `onConflictDoNothing`: re-vincular o mesmo par (PK composta) vira no-op em vez
  // de 23505 — idempotente no nível SQL, sem abortar a tx (catch de unique dentro
  // de transação Postgres invalidaria as queries seguintes).
  link: async (
    tx: Tx,
    tenantId: string,
    templateId: string,
    procedureId: string,
  ): Promise<void> => {
    await tx
      .insert(consentTemplateProcedures)
      .values({ tenantId, templateId, procedureId })
      .onConflictDoNothing();
  },

  unlink: async (
    tx: Tx,
    templateId: string,
    procedureId: string,
  ): Promise<boolean> => {
    const rows = await tx
      .delete(consentTemplateProcedures)
      .where(
        and(
          eq(consentTemplateProcedures.templateId, templateId),
          eq(consentTemplateProcedures.procedureId, procedureId),
        ),
      )
      .returning({ templateId: consentTemplateProcedures.templateId });
    return rows.length > 0;
  },

  // Templates ativos kind='consent_term' que cobrem ao menos 1 dos procedimentos
  // da venda. DISTINCT dá o dedup natural da regra 3: se 2 procedimentos usam o
  // mesmo template, ele sai 1x. Alimenta o bulk generateConsentTermsForSale.
  listTemplatesForProcedures: async (
    tx: Tx,
    procedureIds: string[],
  ): Promise<ConsentTemplateForProcedures[]> => {
    if (procedureIds.length === 0) return [];
    return tx
      .selectDistinct({
        id: contractTemplates.id,
        name: contractTemplates.name,
        variables: contractTemplates.variables,
      })
      .from(consentTemplateProcedures)
      .innerJoin(
        contractTemplates,
        eq(contractTemplates.id, consentTemplateProcedures.templateId),
      )
      .where(
        and(
          inArray(consentTemplateProcedures.procedureId, procedureIds),
          eq(contractTemplates.kind, 'consent_term'),
          eq(contractTemplates.active, true),
        ),
      );
  },
};
