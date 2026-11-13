import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createDb, sql } from '@elora/db';

// =====================================================================
// Diagnóstico do estado de RLS no banco. Imprime:
//   1. Role atual + flags (superuser, bypassrls)
//   2. Tabelas com relrowsecurity ON e relforcerowsecurity ON/OFF
//   3. Policies existentes
//   4. Se app.current_tenant está setado quando NÃO usamos withTenant
//
// Sem mutações — só SELECTs.
// =====================================================================

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const admin = createDb({
  host: process.env.DATABASE_HOST!,
  port: Number(process.env.DATABASE_PORT),
  user: process.env.DATABASE_USER!,
  password: process.env.DATABASE_PASSWORD!,
  database: process.env.DATABASE_NAME!,
});

const app = process.env.DATABASE_APP_USER
  ? createDb({
      host: process.env.DATABASE_HOST!,
      port: Number(process.env.DATABASE_PORT),
      user: process.env.DATABASE_APP_USER,
      password: process.env.DATABASE_APP_PASSWORD!,
      database: process.env.DATABASE_NAME!,
    })
  : null;

const db = admin.db;
const pool = admin.pool;

async function main(): Promise<void> {
  console.log('\n=== 1. Role atual (admin) ===');
  const role = await db.execute(sql`
    SELECT current_user AS current_user,
           session_user AS session_user,
           r.rolsuper,
           r.rolbypassrls,
           r.rolcanlogin
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);
  console.table(role.rows);

  console.log('\n=== 2. Tabelas com RLS (rowsecurity / forcerowsecurity) ===');
  const tables = await db.execute(sql`
    SELECT c.relname AS table,
           c.relrowsecurity AS row_security,
           c.relforcerowsecurity AS force_row_security
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
    ORDER BY c.relname
  `);
  console.table(tables.rows);

  console.log('\n=== 3. Policies em pg_policies ===');
  const pols = await db.execute(sql`
    SELECT tablename, policyname, cmd, qual
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  `);
  console.table(pols.rows);

  console.log('\n=== 4. app.current_tenant fora de tx ===');
  const ctx = await db.execute(
    sql`SELECT current_setting('app.current_tenant', true) AS current_tenant`
  );
  console.table(ctx.rows);

  console.log('\n=== 5. Sample: count(*) em journeys SEM withTenant (admin) ===');
  const cnt = await db.execute(sql`SELECT count(*)::int AS total FROM journeys`);
  console.table(cnt.rows);

  if (app) {
    console.log('\n=== 6. App role check ===');
    try {
      const role = await app.db.execute(sql`
        SELECT current_user, r.rolsuper, r.rolbypassrls
        FROM pg_roles r WHERE r.rolname = current_user
      `);
      console.table(role.rows);

      console.log('\n=== 7. App count em journeys SEM tenant context ===');
      const c1 = await app.db.execute(
        sql`SELECT count(*)::int AS total FROM journeys`
      );
      console.table(c1.rows);

      console.log(
        '\n=== 8. App count em journeys POR tenant (withTenant simulado) ===',
      );
      const tenants = await app.db.execute(
        sql`SELECT id::text, slug FROM tenants ORDER BY slug`,
      );
      for (const row of tenants.rows as { id: string; slug: string }[]) {
        const r = await app.db.transaction(async (tx) => {
          await tx.execute(
            sql`SELECT set_config('app.current_tenant', ${row.id}, true)`,
          );
          return tx.execute(sql`SELECT count(*)::int AS total FROM journeys`);
        });
        const total = (r.rows[0] as { total: number }).total;
        console.log(`  ${row.slug} (${row.id}) → ${total}`);
      }
    } finally {
      await app.pool.end();
    }
  } else {
    console.log('\n(DATABASE_APP_USER não definido — pulando checks de app role)');
  }
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
