import { defineConfig } from 'drizzle-kit';

// Credenciais hardcoded de propósito: drizzle-kit (Studio, generate, push)
// é ferramenta local de dev, não roda em produção. Sincronizar com
// infra/docker-compose.yml se as credenciais do Postgres mudarem.
export default defineConfig({
  schema: './src/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    host: 'localhost',
    port: 5432,
    user: 'elora',
    password: 'elora',
    database: 'elora_dev',
    ssl: false,
  },
});
