-- Grupos viraram globais (1:1 com role_code). menu_groups idem.
-- Migration destrutiva: limpa dados pra evitar conflito com novas unique
-- constraints (vários tenants têm grupos com mesmo name/role_code hoje).
-- Reseed via `pnpm seed` cria os 5 grupos globais + vínculos novamente.
TRUNCATE "menu_groups", "user_groups", "groups" CASCADE;--> statement-breakpoint

-- Drop policies ANTES de drop column — policy depende de tenant_id.
DROP POLICY "tenant_isolation" ON "groups" CASCADE;--> statement-breakpoint
DROP POLICY "tenant_isolation" ON "menu_groups" CASCADE;--> statement-breakpoint

ALTER TABLE "groups" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "menu_groups" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "groups" DROP CONSTRAINT "groups_tenant_id_tenants_id_fk";--> statement-breakpoint

DROP INDEX "groups_tenant_id_idx";--> statement-breakpoint
DROP INDEX "groups_role_code_idx";--> statement-breakpoint
DROP INDEX "menu_groups_tenant_id_idx";--> statement-breakpoint

ALTER TABLE "groups" DROP COLUMN "tenant_id";--> statement-breakpoint
ALTER TABLE "menu_groups" DROP COLUMN "tenant_id";--> statement-breakpoint

ALTER TABLE "groups" ADD CONSTRAINT "groups_name_unique" UNIQUE("name");--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_role_code_unique" UNIQUE("role_code");
