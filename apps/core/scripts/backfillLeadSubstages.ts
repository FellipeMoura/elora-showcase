import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  and,
  createDb,
  eq,
  journeys,
  recomputeLeadSubstage,
  sql,
  tenants,
  withTenant,
} from '@elora/db';

// =====================================================================
// One-shot: corrige leads que ficaram presos em substage='new' por causa
// do bug onde MessageComposer enviava outbound sem `journeyId`. Após o fix
// (CoreGateway.journeysFindActiveByClient + sendOutbound/postInternalNote
// resolvendo o id no backend), novas mensagens nascem linkadas. Esse
// script faz duas coisas pra reparar o estado atual:
//
//   1. Backfill: UPDATE messages.journey_id = j.id pra mensagens cujo
//      conversation pertence a um cliente com journey ativa, e que ainda
//      estão com journey_id NULL. Restrição "status=active" garante que
//      não atribuímos mensagens recentes a journeys passadas (lost/won).
//   2. Recompute: pra cada journey stage='lead' ativa, roda
//      recomputeLeadSubstage — eleva 'new' → 'template'/'contact' agora
//      que as messages estão visíveis pelo compute.
//
// Como rodar:
//   pnpm tsx apps/core/scripts/backfillLeadSubstages.ts
// =====================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const { db } = createDb({
  host: process.env.DATABASE_HOST!,
  port: Number(process.env.DATABASE_PORT),
  user: process.env.DATABASE_USER!,
  password: process.env.DATABASE_PASSWORD!,
  database: process.env.DATABASE_NAME!,
});

async function main(): Promise<void> {
  const allTenants = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants);

  console.log(`[backfill] ${allTenants.length} tenants a processar`);

  let totalBackfilled = 0;
  let totalRecomputed = 0;

  for (const t of allTenants) {
    console.log(`\n=== ${t.slug} (${t.id}) ===`);

    // Script roda como admin (DATABASE_USER) — superuser bypassa RLS. Por
    // isso filtramos tenant_id explicitamente em todas as queries; sem
    // isso, cada iteração processaria as journeys de TODOS os tenants e o
    // log inflaria (recompute é idempotente, então não corrompe estado,
    // mas conta "no-op" como "mudança").
    await withTenant(db, t.id, async (tx) => {
      const updateResult = await tx.execute(sql`
        UPDATE messages m
        SET journey_id = j.id
        FROM conversations c, journeys j
        WHERE m.conversation_id = c.id
          AND j.client_id = c.client_id
          AND j.status = 'active'
          AND m.journey_id IS NULL
          AND m.tenant_id = ${t.id}
          AND c.tenant_id = ${t.id}
          AND j.tenant_id = ${t.id}
      `);
      const backfilled = updateResult.rowCount ?? 0;
      totalBackfilled += backfilled;
      console.log(`  messages.journey_id backfilled: ${backfilled}`);

      const leads = await tx
        .select({
          id: journeys.id,
          currentSubstage: journeys.leadSubstage,
        })
        .from(journeys)
        .where(
          and(
            eq(journeys.tenantId, t.id),
            eq(journeys.stage, 'lead'),
            eq(journeys.status, 'active')
          )
        );
      console.log(`  ${leads.length} leads ativos pra recomputar`);

      for (const l of leads) {
        const next = await recomputeLeadSubstage(tx, l.id, {
          reason: 'backfill_after_journey_link_fix',
        });
        // `next` é o substage final — vem preenchido mesmo quando o
        // helper foi no-op (já estava correto). Só conta como "alterado"
        // se o valor mudou de fato.
        if (next && next !== l.currentSubstage) {
          totalRecomputed += 1;
          console.log(`    ${l.id}: ${l.currentSubstage ?? 'null'} → ${next}`);
        }
      }
    });
  }

  console.log(
    `\n[backfill] OK — ${totalBackfilled} messages linkadas, ${totalRecomputed} substages atualizados`
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[backfill] FALHOU:', err);
    process.exit(1);
  });
