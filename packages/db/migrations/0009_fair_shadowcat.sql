-- Catálogo de menus passa a ser global. `menus` perde `tenant_id` + RLS,
-- e a junção menu↔tenant vai pra nova `menu_tenants` (global, sem RLS).

DROP POLICY "tenant_isolation" ON "menus" CASCADE;--> statement-breakpoint
ALTER TABLE "menus" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "menus" DROP CONSTRAINT "menus_tenant_id_tenants_id_fk";--> statement-breakpoint
DROP INDEX "menus_tenant_id_idx";--> statement-breakpoint
ALTER TABLE "menus" DROP COLUMN "tenant_id";--> statement-breakpoint
CREATE TABLE "menu_tenants" (
	"menu_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "menu_tenants_menu_id_tenant_id_pk" PRIMARY KEY("menu_id","tenant_id")
);
--> statement-breakpoint
ALTER TABLE "menu_tenants" ADD CONSTRAINT "menu_tenants_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_tenants" ADD CONSTRAINT "menu_tenants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "menu_tenants_tenant_id_idx" ON "menu_tenants" USING btree ("tenant_id");
