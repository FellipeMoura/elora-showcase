CREATE TYPE "public"."role_code" AS ENUM('admin', 'manager', 'professional', 'reception', 'viewer');--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"role_code" "role_code" NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "menu_groups" (
	"menu_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "menu_groups_menu_id_group_id_pk" PRIMARY KEY("menu_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "menu_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "menu_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "menus" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"label" varchar(255) NOT NULL,
	"icon" varchar(64),
	"path" varchar(512),
	"position" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "menus" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "menus" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "user_groups" (
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_groups_user_id_group_id_pk" PRIMARY KEY("user_id","group_id")
);
--> statement-breakpoint
ALTER TABLE "user_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_groups" ADD CONSTRAINT "menu_groups_menu_id_menus_id_fk" FOREIGN KEY ("menu_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menu_groups" ADD CONSTRAINT "menu_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "menus" ADD CONSTRAINT "menus_parent_id_menus_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."menus"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_groups" ADD CONSTRAINT "user_groups_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "groups_tenant_id_idx" ON "groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "groups_role_code_idx" ON "groups" USING btree ("role_code");--> statement-breakpoint
CREATE INDEX "menu_groups_tenant_id_idx" ON "menu_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "menus_tenant_id_idx" ON "menus" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "menus_parent_id_idx" ON "menus" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "user_groups_tenant_id_idx" ON "user_groups" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "groups" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "menu_groups" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "menus" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "user_groups" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);