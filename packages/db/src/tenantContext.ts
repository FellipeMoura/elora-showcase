import { sql } from 'drizzle-orm';
import type { Db, Tx } from './createDb.js';

// Executa fn dentro de uma transação com `app.current_tenant` setado via SET LOCAL.
// As policies RLS usam essa variável de sessão para filtrar dados — sem isso,
// queries não retornam linhas. O uso de `is_local=true` (3º arg) amarra o
// setting à transação: ao commitar, o setting some, sem leak no pool.
export async function withTenant<T>(
  db: Db,
  tenantId: string,
  fn: (tx: Tx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_tenant', ${tenantId}, true)`);
    return fn(tx);
  });
}
