-- Função utilitária pro webhook do ZapSign (apps/core, módulo contracts).
--
-- Contexto: ZapSign chama o webhook num endpoint público fixo
-- (api.elora.app.br/webhooks/zapsign) — não tem subdomínio de tenant nem
-- channelId pra identificar quem é. O único correlato confiável é o
-- `token` do documento (gravado em `contracts.zapsign_document_id` com
-- UNIQUE partial index, criado em 0026). Pra abrir `withTenant()`
-- precisamos descobrir o tenant_id a partir desse token. Mas a tabela
-- `contracts` tem RLS+FORCE, e o role `elora_app` é NOBYPASSRLS — SELECT
-- direto sem `app.current_tenant` setado retorna vazio.
--
-- Solução idiomática Postgres: função SECURITY DEFINER. Roda com privilégios
-- do owner (elora superuser), bypassa RLS só pra essa query específica, e a
-- gente exige EXECUTE explícito pro role elora_app. Mesmo padrão usado em
-- 0005_resolve_channel_tenant.sql pro webhook do WhatsApp.
--
-- Esse arquivo é hand-written (não veio de pnpm db:generate) porque drizzle-kit
-- não modela funções PL/pgSQL. Snapshot 0028 não é criado — journal aceita
-- migrations puramente SQL (mesmo padrão de 0005 e 0027).

CREATE OR REPLACE FUNCTION resolve_contract_tenant(p_zapsign_document_id varchar)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM contracts
  WHERE zapsign_document_id = p_zapsign_document_id;
  RETURN v_tenant_id;
END;
$$;

-- Lockdown: tira EXECUTE de PUBLIC (boa prática pra SECURITY DEFINER) e dá só
-- pro role da aplicação. elora_app é criado em infra/postgres-init.sql.
REVOKE EXECUTE ON FUNCTION resolve_contract_tenant(varchar) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_contract_tenant(varchar) TO elora_app;
