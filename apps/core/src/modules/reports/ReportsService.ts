import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  getReportDefinition,
  isReportSlug,
  reportRegistry,
} from './registry.js';
import { ReportsQuery } from './ReportsQuery.js';
import type { Report } from './ReportsTypes.js';

// Cruza o resultado da query (banco) com o registry (código) — só
// retorna relatórios cujo slug ainda existe em memória. Sem isso, slugs
// órfãos no banco (registry removeu mas linha continua active=false →
// listagem já filtra) ainda apareceriam por linhas que estivessem
// active=true mas o handler tivesse sumido (caso raríssimo, mas defensivo).
function filterToRegistry(items: Report[]): Report[] {
  return items.filter((r) => isReportSlug(r.slug));
}

export const ReportsService = {
  // Lista visível ao user dentro do tenant. Cruza com registry pra
  // garantir que slug ainda existe no código (sanity check defensivo).
  listVisible: async (tenantId: string, userId: string): Promise<Report[]> => {
    const items = await withTenant(db, tenantId, async (tx) => {
      return ReportsQuery.listVisibleForUser(tx, tenantId, userId);
    });
    return filterToRegistry(items);
  },

  // Metadata pra tela de detalhe / form de execução. Valida visibility —
  // user só vê metadata do que tem direito a executar.
  getDetail: async (
    slug: string,
    tenantId: string,
    userId: string
  ): Promise<Report> => {
    const report = await ReportsQuery.findBySlug(db, slug);
    if (!report || !report.active) {
      throw new AppError('Relatório não encontrado', 404);
    }
    if (!isReportSlug(slug)) {
      throw new AppError('Relatório não encontrado', 404);
    }
    const visible = await withTenant(db, tenantId, async (tx) => {
      return ReportsQuery.isVisibleForUser(tx, slug, tenantId, userId);
    });
    if (!visible) throw new AppError('Relatório não encontrado', 404);
    return report;
  },

  // Executa o relatório. Sequência:
  //   1. Verifica que slug existe no registry (handler disponível)
  //   2. Verifica que linha no banco tá active
  //   3. Verifica visibility (tenant + group via user_groups)
  //   4. Valida params via paramsSchema do handler (Zod)
  //   5. Dispatcha pro handler
  run: async (
    slug: string,
    rawParams: unknown,
    tenantId: string,
    userId: string
  ): Promise<{ slug: string; data: unknown }> => {
    if (!isReportSlug(slug)) {
      throw new AppError('Relatório não encontrado', 404);
    }

    const report = await ReportsQuery.findBySlug(db, slug);
    if (!report || !report.active) {
      throw new AppError('Relatório não encontrado', 404);
    }

    const visible = await withTenant(db, tenantId, async (tx) => {
      return ReportsQuery.isVisibleForUser(tx, slug, tenantId, userId);
    });
    if (!visible) throw new AppError('Relatório não encontrado', 404);

    const def = getReportDefinition(slug);
    const parsed = def.paramsSchema.safeParse(rawParams ?? {});
    if (!parsed.success) {
      throw new AppError(
        `Parâmetros inválidos: ${parsed.error.issues
          .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('; ')}`,
        400
      );
    }

    const result = await def.handler(parsed.data, { tenantId, userId });
    return { slug, data: result };
  },

  // Pra debug: catálogo cru do registry (não usado por endpoint user-facing;
  // útil pra teste do syncRegistry).
  listRegistryEntries: () => {
    return Object.entries(reportRegistry).map(([slug, def]) => ({
      slug,
      name: def.name,
      description: def.description,
      category: def.category,
    }));
  },
};
