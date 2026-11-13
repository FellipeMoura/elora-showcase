import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const migrationsDir = path.resolve(__dirname, 'migrations');

const pool = new pg.Pool({
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT),
  user: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
});

async function ensureTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS __migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getApplied(): Promise<Set<string>> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM __migrations ORDER BY applied_at'
  );
  return new Set(rows.map((r) => r.id));
}

async function listFiles(): Promise<string[]> {
  const files = await readdir(migrationsDir);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

async function apply(): Promise<void> {
  await ensureTable();
  const applied = await getApplied();
  const files = await listFiles();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;

    const content = await readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(content);
      await client.query('INSERT INTO __migrations (id) VALUES ($1)', [file]);
      await client.query('COMMIT');
      console.log(`Aplicada: ${file}`);
      count++;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  if (count === 0) console.log('Banco já está atualizado.');
}

async function status(): Promise<void> {
  await ensureTable();
  const applied = await getApplied();
  const files = await listFiles();
  const pending = files.filter((f) => !applied.has(f));

  console.log(`Aplicadas: ${applied.size}`);
  console.log(`Pendentes: ${pending.length}`);
  if (pending.length > 0) {
    console.log('Pendentes:');
    pending.forEach((f) => console.log(`  - ${f}`));
  }
}

const command = process.argv[2];

async function main(): Promise<void> {
  switch (command) {
    case 'apply':
      await apply();
      break;
    case 'status':
      await status();
      break;
    default:
      console.error(`Comando desconhecido: ${command}`);
      console.error('Use: apply | status');
      process.exit(1);
  }
}

main()
  .catch((err) => {
    console.error('Erro ao executar migration:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
