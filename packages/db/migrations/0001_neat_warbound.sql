CREATE TYPE "public"."example_option" AS ENUM('option1', 'option2', 'option3');--> statement-breakpoint
CREATE TABLE "example" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"e_varchar" varchar(255) NOT NULL,
	"e_text" text,
	"e_integer" integer DEFAULT 0 NOT NULL,
	"e_decimal" numeric(10, 2),
	"e_boolean" boolean DEFAULT false NOT NULL,
	"e_date" date,
	"e_jsonb" jsonb,
	"e_enum" "example_option",
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "example" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "example" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "example" ADD CONSTRAINT "example_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "example_tenant_id_idx" ON "example" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "example" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);