import { and, eq, lte, quotes, tenants, withTenant } from '@elora/db';
import { db } from '../../database/db.js';
import { logger } from '../../observability/logger.js';
import { QuotesService } from '../../../modules/quotes/QuotesService.js';
import type { ScheduledJobDef } from '../registry.js';

// =====================================================================
// expireQuotes — job diário que marca como `expired` os orçamentos em
// status `sent` cujo `valid_until` já passou.
//
// Por que assim:
//   - Sem isso, `valid_until` é puramente decorativo: o status fica `sent`
//     pra sempre e o substage da journey continua em `quoted`, mantendo
//     o lead "vivo" no kanban mesmo depois do prazo. A regra do produto
//     (chat-domain.md §5.6) prevê auto-lost quando todas as quotes da
//     journey ficam fechadas — e expired conta como fechado.
//   - `QuotesService.expire` já tem toda a lógica (auto-lost da journey,
//     recompute do substage, event). Reaproveitamos — o job só descobre
//     os IDs candidatos e chama o service.
//
// Cron: 03:00 BRT diariamente. Horário escolhido pra:
//   - Não conflitar com pico de uso (clínicas operam dia/noite até ~21h).
//   - Backup pg_dump (também 3-4am em prod, ver docs/producao-setup).
//     Pequena sobreposição com início; a carga deste job é minúscula.
//
// `tenants` não tem RLS — varredura cross-tenant aqui é OK. O service
// abre `withTenant` por chamada.
// =====================================================================

const EXPIRE_QUOTES_CRON = '0 3 * * *'; // 03:00 todo dia (TZ America/Sao_Paulo)

async function run(): Promise<void> {
  const now = new Date();

  // `tenants` é a única tabela de domínio sem RLS — varremos por tenant
  // e, dentro de cada um, abrimos `withTenant` pra olhar suas quotes.
  const allTenants = await db.select({ id: tenants.id }).from(tenants);

  let totalCandidates = 0;
  let totalExpired = 0;
  let totalFailed = 0;

  for (const t of allTenants) {
    // Lê dentro de withTenant pra respeitar RLS. Service abre seu próprio
    // withTenant por chamada — paga 2× transação por quote, mas com volumes
    // realistas (poucas dezenas de quotes vencidas/dia/tenant) é irrelevante.
    const candidates = await withTenant(db, t.id, (tx) =>
      tx
        .select({ id: quotes.id })
        .from(quotes)
        .where(
          and(
            eq(quotes.status, 'sent'),
            lte(quotes.validUntil, now),
          ),
        ),
    );

    if (candidates.length === 0) continue;
    totalCandidates += candidates.length;

    for (const c of candidates) {
      try {
        await QuotesService.expire(t.id, c.id);
        totalExpired++;
      } catch (err) {
        // Não derruba o lote — quote pode ter mudado de status entre o
        // SELECT e o expire (race com staff fechando venda manual). Log
        // warn e segue.
        totalFailed++;
        logger.warn(
          {
            tenantId: t.id,
            quoteId: c.id,
            err: err instanceof Error ? err.message : err,
          },
          '[expireQuotes] falha ao expirar quote — pulando',
        );
      }
    }
  }

  logger.info(
    {
      tenantsScanned: allTenants.length,
      totalCandidates,
      totalExpired,
      totalFailed,
    },
    '[expireQuotes] varredura concluída',
  );
}

export const expireQuotesJob: ScheduledJobDef = {
  name: 'expire-quotes',
  cron: EXPIRE_QUOTES_CRON,
  description:
    'Marca como expired quotes em status=sent cujo validUntil já passou. Dispara auto-lost da journey quando aplicável.',
  run,
};
