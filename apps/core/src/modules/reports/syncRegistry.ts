import { notInArray, reports, sql } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { logger } from '../../shared/observability/logger.js';
import { listRegistrySlugs, reportRegistry } from './registry.js';

// Roda uma vez no boot do `apps/core`. Faz upsert do registry pra tabela
// `reports`: relatórios novos viram linha; existentes têm name/desc/category
// atualizados; relatórios removidos do código viram `active=false`.
//
// Decisão: falha NÃO derruba o server — log de erro + Sentry capture
// continuam o boot. Relatórios ficam indisponíveis (listagem retorna vazio
// porque join com active=true não bate em nada) mas o resto do app sobe.
export async function syncReportsRegistry(): Promise<void> {
  const slugs = listRegistrySlugs();

  try {
    await db.transaction(async (tx) => {
      for (const slug of slugs) {
        const def = reportRegistry[slug];
        await tx
          .insert(reports)
          .values({
            slug,
            name: def.name,
            description: def.description,
            category: def.category,
            active: true,
          })
          .onConflictDoUpdate({
            target: reports.slug,
            set: {
              name: def.name,
              description: def.description,
              category: def.category,
              active: true,
            },
          });
      }

      // Marca como inativos os que sumiram do código. Não deleta — preserva
      // refs em report_tenants/report_groups (super-admin enxerga e decide).
      if (slugs.length > 0) {
        await tx
          .update(reports)
          .set({ active: false })
          .where(notInArray(reports.slug, slugs as unknown as string[]));
      } else {
        // Registry vazio: marca tudo inativo (não deleta).
        await tx.update(reports).set({ active: false }).where(sql`true`);
      }
    });

    logger.info({ count: slugs.length }, 'reports.registry.synced');
  } catch (err) {
    logger.error({ err }, 'reports.registry.sync_failed');
    // Engole o erro: server continua, relatórios indisponíveis.
  }
}
