import { createDb } from '@elora/db';
import { env } from '../../env.js';

const handle = createDb({
  host: env.database.host,
  port: env.database.port,
  user: env.database.user,
  password: env.database.password,
  database: env.database.database,
});

export const db = handle.db;
export const pool = handle.pool;
