-- Setup de roles do Postgres pro Elora.
--
-- A imagem oficial do Postgres cria o role definido em POSTGRES_USER (=`elora`)
-- como SUPERUSER. Superusers sempre bypassam RLS, mesmo com FORCE ROW LEVEL
-- SECURITY. Isso anula toda a isolação por tenant.
--
-- Solução: criar role separado `elora_app` (no-superuser, no-bypassrls) para
-- a aplicação (core, chat). O role `elora` segue como admin — usado por
-- migrations (`pnpm db:migrate`) e seed (`pnpm db:seed`).
--
-- Este arquivo roda automaticamente quando o container Postgres é criado pela
-- primeira vez (mecanismo /docker-entrypoint-initdb.d/ da imagem oficial).
-- Se o volume já existir, não roda — aplicar manualmente neste caso:
--   docker exec -i elora_postgres psql -U elora -d elora_dev < infra/postgres-init.sql

-- Role da aplicação. Idempotente — não falha se já existir.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elora_app') THEN
    CREATE ROLE elora_app WITH LOGIN PASSWORD 'elora_app'
      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;

-- Permissões no schema atual (cobre tabelas/sequências criadas até agora).
GRANT USAGE ON SCHEMA public TO elora_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO elora_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO elora_app;

-- Permissões padrão pra objetos criados FUTURAMENTE pelo `elora` (migrations).
-- Sem isso, toda nova tabela exigiria GRANT manual. Com isso, drizzle-kit cria
-- e elora_app já tem acesso.
ALTER DEFAULT PRIVILEGES FOR ROLE elora IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO elora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE elora IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO elora_app;

-- Database dedicado pro Evolution API (ver arquitetura.md §7.8). Evolution
-- gerencia seu próprio schema via Prisma — isolar em DB separado evita
-- conflito com nossas migrations e mantém o backup do elora_dev enxuto.
-- `\gexec` é psql meta-command: o SELECT retorna a string `CREATE DATABASE...`
-- só se o DB não existir, e o gexec executa essa string. Idempotente entre
-- re-execuções (CREATE DATABASE não é transacional).
SELECT 'CREATE DATABASE evolution'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'evolution')\gexec
