import {
  and,
  asc,
  eq,
  reportGroups,
  reportTenants,
  reports,
  type Db,
  type Tx,
  userGroups,
} from '@elora/db';
import type { Report } from './ReportsTypes.js';

// Tabelas globais (reports, report_tenants, report_groups). Aceitam db
// ou tx. Único método tenant-scoped é `listVisibleForUser` — usa
// user_groups (RLS por tenant), então exige `Tx` aberto via withTenant.
type DbOrTx = Db | Tx;

export const ReportsQuery = {
  findBySlug: async (
    tx: DbOrTx,
    slug: string
  ): Promise<Report | undefined> => {
    const [row] = await tx
      .select()
      .from(reports)
      .where(eq(reports.slug, slug))
      .limit(1);
    return row;
  },

  // Catálogo completo — admin/super-admin. Inclui inativos.
  listAll: async (tx: DbOrTx): Promise<Report[]> => {
    return tx
      .select()
      .from(reports)
      .orderBy(asc(reports.category), asc(reports.name));
  },

  // Lista de relatórios visíveis ao user dentro do tenant. Cruza:
  //   - reports (active=true)
  //   - report_tenants(tenant)        → tenant tem direito ao relatório
  //   - report_groups via user_groups → algum grupo do user vê
  // user_groups tem RLS — exige `Tx` aberto via withTenant.
  listVisibleForUser: async (
    tx: Tx,
    tenantId: string,
    userId: string
  ): Promise<Report[]> => {
    return tx
      .selectDistinct({
        id: reports.id,
        slug: reports.slug,
        name: reports.name,
        description: reports.description,
        category: reports.category,
        active: reports.active,
        createdAt: reports.createdAt,
        updatedAt: reports.updatedAt,
      })
      .from(reports)
      .innerJoin(reportTenants, eq(reportTenants.reportId, reports.id))
      .innerJoin(reportGroups, eq(reportGroups.reportId, reports.id))
      .innerJoin(userGroups, eq(userGroups.groupId, reportGroups.groupId))
      .where(
        and(
          eq(reports.active, true),
          eq(reportTenants.tenantId, tenantId),
          eq(userGroups.userId, userId)
        )
      )
      .orderBy(asc(reports.category), asc(reports.name));
  },

  // Checa se o user enxerga o relatório (mesma matriz do listVisibleForUser).
  // Usado no run pra autorizar execução sem rebuscar a lista inteira.
  isVisibleForUser: async (
    tx: Tx,
    slug: string,
    tenantId: string,
    userId: string
  ): Promise<boolean> => {
    const [row] = await tx
      .select({ id: reports.id })
      .from(reports)
      .innerJoin(reportTenants, eq(reportTenants.reportId, reports.id))
      .innerJoin(reportGroups, eq(reportGroups.reportId, reports.id))
      .innerJoin(userGroups, eq(userGroups.groupId, reportGroups.groupId))
      .where(
        and(
          eq(reports.slug, slug),
          eq(reports.active, true),
          eq(reportTenants.tenantId, tenantId),
          eq(userGroups.userId, userId)
        )
      )
      .limit(1);
    return Boolean(row);
  },
};
