-- Unificação das agendas (chat-domain.md §4.4 + §4.5 refatorados — 2026-05-20).
-- Drop tabelas separadas + recria como `appointments` polimórfica + `evaluations`.
-- Lifecycle do slot desacoplado do lifecycle do evento clínico (§16.3).

-- ---- 1. DROP tabelas antigas + coluna inversa em procedure_sessions ----
-- CASCADE limpa policies, indexes, FK constraints associados.
DROP TABLE IF EXISTS "procedure_appointments" CASCADE;--> statement-breakpoint
DROP TABLE IF EXISTS "evaluation_appointments" CASCADE;--> statement-breakpoint
-- Removida pelo CASCADE acima também (FK referenciava procedure_appointments),
-- mas declaração explícita garante consistência se essa migration rodar em
-- estado parcial.
ALTER TABLE "procedure_sessions" DROP COLUMN IF EXISTS "procedure_appointment_id";--> statement-breakpoint
DROP INDEX IF EXISTS "proc_sessions_appointment_id_idx";--> statement-breakpoint

-- ---- 2. Recria enum appointment_status (valores mudaram: done→attended) ----
DROP TYPE IF EXISTS "public"."appointment_status";--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'confirmed', 'attended', 'no_show', 'cancelled');--> statement-breakpoint

-- ---- 3. Enums novos ----
CREATE TYPE "public"."appointment_kind" AS ENUM('evaluation', 'procedure');--> statement-breakpoint
CREATE TYPE "public"."evaluation_status" AS ENUM('pending', 'performed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."evaluation_kind" AS ENUM('initial', 'reevaluation', 'return');--> statement-breakpoint

-- ---- 4. Tabela evaluations (entidade clínica, separada do slot) ----
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "evaluation_kind" DEFAULT 'initial' NOT NULL,
	"status" "evaluation_status" DEFAULT 'pending' NOT NULL,
	"performed_at" timestamp,
	"performed_by_user_id" uuid,
	"general_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "evaluations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evaluations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_performed_by_user_id_users_id_fk" FOREIGN KEY ("performed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evaluations_tenant_id_idx" ON "evaluations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "evaluations_journey_id_idx" ON "evaluations" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "evaluations_client_id_idx" ON "evaluations" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "evaluations_status_idx" ON "evaluations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "evaluations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint

-- ---- 5. Tabela appointments (polimórfica) ----
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"kind" "appointment_kind" NOT NULL,
	"evaluation_id" uuid,
	"procedure_session_id" uuid,
	"professional_id" uuid,
	"unit_id" uuid,
	"equipment_id" uuid,
	"scheduled_at" timestamp NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	-- Polimorfismo: kind='evaluation' ↔ evaluation_id NOT NULL E procedure_session_id NULL.
	-- kind='procedure' ↔ procedure_session_id NOT NULL E evaluation_id NULL. Sempre XOR.
	CONSTRAINT "appointments_kind_xor" CHECK (
		(kind = 'evaluation' AND evaluation_id IS NOT NULL AND procedure_session_id IS NULL)
		OR
		(kind = 'procedure' AND procedure_session_id IS NOT NULL AND evaluation_id IS NULL)
	)
);--> statement-breakpoint
ALTER TABLE "appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_procedure_session_id_procedure_sessions_id_fk" FOREIGN KEY ("procedure_session_id") REFERENCES "public"."procedure_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_tenant_id_idx" ON "appointments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "appointments_journey_id_idx" ON "appointments" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "appointments_scheduled_idx" ON "appointments" USING btree ("tenant_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_professional_idx" ON "appointments" USING btree ("professional_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_equipment_idx" ON "appointments" USING btree ("equipment_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_evaluation_idx" ON "appointments" USING btree ("evaluation_id");--> statement-breakpoint
CREATE INDEX "appointments_session_idx" ON "appointments" USING btree ("procedure_session_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "appointments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
