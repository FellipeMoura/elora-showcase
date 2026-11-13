ALTER TABLE "client_forms" DROP CONSTRAINT "client_forms_client_template_unique";--> statement-breakpoint
ALTER TABLE "client_forms" ADD COLUMN "evaluation_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "client_forms" ADD CONSTRAINT "client_forms_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "client_forms_evaluation_id_idx" ON "client_forms" USING btree ("evaluation_id");--> statement-breakpoint
ALTER TABLE "client_forms" ADD CONSTRAINT "client_forms_evaluation_template_unique" UNIQUE("evaluation_id","form_template_id");