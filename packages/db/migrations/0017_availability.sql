-- Disponibilidade do profissional (chat-domain.md §17).
-- Regras semanais (professional_schedules) + exceções pontuais (schedule_exceptions).
-- Substitui o padrão eager do CB (slots pré-materializados como rows).

CREATE TYPE "public"."weekday" AS ENUM('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');--> statement-breakpoint
CREATE TYPE "public"."schedule_exception_kind" AS ENUM('vacation', 'sick', 'training', 'holiday', 'other');--> statement-breakpoint

-- ---- professional_schedules ----
CREATE TABLE "professional_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"day_of_week" "weekday" NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"effective_from" date DEFAULT CURRENT_DATE NOT NULL,
	"effective_to" date,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "prof_schedules_time_order" CHECK ("end_time" > "start_time"),
	CONSTRAINT "prof_schedules_effective_order" CHECK (
		"effective_to" IS NULL OR "effective_to" >= "effective_from"
	)
);--> statement-breakpoint
ALTER TABLE "professional_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professional_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "professional_schedules" ADD CONSTRAINT "professional_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prof_schedules_tenant_id_idx" ON "professional_schedules" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "prof_schedules_user_id_idx" ON "professional_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prof_schedules_user_day_idx" ON "professional_schedules" USING btree ("user_id", "day_of_week");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "professional_schedules" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint

-- ---- schedule_exceptions ----
CREATE TABLE "schedule_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"start_at" timestamp NOT NULL,
	"end_at" timestamp NOT NULL,
	"kind" "schedule_exception_kind" DEFAULT 'other' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_exc_range_order" CHECK ("end_at" > "start_at")
);--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schedule_exc_tenant_id_idx" ON "schedule_exceptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "schedule_exc_user_id_idx" ON "schedule_exceptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "schedule_exc_user_range_idx" ON "schedule_exceptions" USING btree ("user_id", "start_at", "end_at");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "schedule_exceptions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
