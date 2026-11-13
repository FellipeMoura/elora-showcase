import pg from 'pg';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import {
  drizzle,
  type NodePgDatabase,
  type NodePgTransaction,
} from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export interface DbConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  poolMin?: number;
  poolMax?: number;
}

type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;
export type Tx = NodePgTransaction<Schema, ExtractTablesWithRelations<Schema>>;

// DbHandle expõe db (Drizzle) + pool (pg) — pool é necessário pra
// graceful shutdown (pool.end()) e introspecção em ferramentas de admin.
export interface DbHandle {
  db: Db;
  pool: pg.Pool;
}

export function createDb(config: DbConfig): DbHandle {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: config.database,
    min: config.poolMin ?? 0,
    max: config.poolMax ?? 10,
  });

  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}
