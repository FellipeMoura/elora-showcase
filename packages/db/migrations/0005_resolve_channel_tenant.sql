-- Função utilitária pro webhook normalizer (apps/chat).
--
-- Contexto: o webhook do WhatsApp chega com `:channelId` na URL — o provider
-- não conhece tenant nem subdomínio. Pra abrir `withTenant()` precisamos
-- descobrir o tenant_id a partir do channel_id. Mas a tabela `whatsapp_channels`
-- tem RLS+FORCE, e o role `elora_app` (usado pelo app) é NOBYPASSRLS — então
-- um SELECT direto sem `app.current_tenant` setado retorna vazio.
--
-- Solução idiomática Postgres: função SECURITY DEFINER. Roda com privilégios
-- do owner (elora superuser), bypassa RLS só pra essa query específica, e a
-- gente exige EXECUTE explícito pro role elora_app.
--
-- Filtramos por `active = true`: canais desativados pelo admin não devem
-- processar inbound, ainda que provider faça retry. Retorna NULL nesse caso —
-- handler decide responder 404 / 410 / 200-drop.
--
-- Esse arquivo é hand-written (não veio de pnpm db:generate) porque drizzle-kit
-- não modela funções PL/pgSQL. Migration purely SQL — não há diff de schema.
-- snapshot 0005 = cópia do 0004 pra manter journal consistente.

CREATE OR REPLACE FUNCTION resolve_channel_tenant(p_channel_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
BEGIN
  SELECT tenant_id INTO v_tenant_id
  FROM whatsapp_channels
  WHERE id = p_channel_id AND active = true;
  RETURN v_tenant_id;
END;
$$;

-- Lockdown: tira EXECUTE de PUBLIC (boa prática pra SECURITY DEFINER) e dá só
-- pro role da aplicação. elora_app é criado em infra/postgres-init.sql.
REVOKE EXECUTE ON FUNCTION resolve_channel_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_channel_tenant(uuid) TO elora_app;
