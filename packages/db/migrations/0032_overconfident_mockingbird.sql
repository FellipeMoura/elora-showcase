CREATE TABLE "consent_template_procedures" (
	"tenant_id" uuid NOT NULL,
	"template_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "consent_template_procedures_template_id_procedure_id_pk" PRIMARY KEY("template_id","procedure_id")
);
--> statement-breakpoint
ALTER TABLE "consent_template_procedures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "consent_template_procedures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contracts" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "consent_template_procedures" ADD CONSTRAINT "consent_template_procedures_template_id_contract_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."contract_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_template_procedures" ADD CONSTRAINT "consent_template_procedures_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_template_procs_procedure_idx" ON "consent_template_procedures" USING btree ("procedure_id");--> statement-breakpoint
CREATE INDEX "consent_template_procs_tenant_idx" ON "consent_template_procedures" USING btree ("tenant_id");--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_sale_id_idx" ON "contracts" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_sale_service_active_unique" ON "contracts" USING btree ("sale_id") WHERE kind = 'service_contract' AND status <> 'cancelled' AND sale_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "contracts_sale_consent_template_active_unique" ON "contracts" USING btree ("sale_id","template_id") WHERE kind = 'consent_term' AND status <> 'cancelled' AND sale_id IS NOT NULL;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "consent_template_procedures" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);