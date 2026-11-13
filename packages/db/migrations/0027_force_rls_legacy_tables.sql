-- Fixup: adiciona FORCE ROW LEVEL SECURITY em tabelas criadas nas migrations
-- 0024 e 0025 onde a regra do projeto (CLAUDE.md §4) foi violada — o drizzle-kit
-- emite só `ENABLE ROW LEVEL SECURITY`, e o `FORCE` precisa ser adicionado
-- à mão. Sem FORCE, o owner da tabela bypassa as policies — relevante caso
-- alguém rode query ad-hoc via role `elora` (superuser/owner) em vez de
-- `elora_app` (NOBYPASSRLS). Em runtime normal não há vazamento porque o
-- backend conecta como `elora_app`, mas a camada extra é o padrão do projeto.
--
-- Idempotente: ALTER TABLE ... FORCE não falha se já estiver aplicado.

ALTER TABLE "equipments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;
