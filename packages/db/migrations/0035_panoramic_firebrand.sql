ALTER TYPE "public"."procedure_session_status" ADD VALUE 'signed' BEFORE 'done';--> statement-breakpoint
CREATE TABLE "procedure_session_attendance_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"attendance_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proc_session_attend_sessions_session_unique" UNIQUE("session_id")
);
--> statement-breakpoint
ALTER TABLE "procedure_session_attendance_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "procedure_session_attendances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"attendance_date" date NOT NULL,
	"signature_object_key" varchar(1024) NOT NULL,
	"photo_object_key" varchar(1024) NOT NULL,
	"signed_at" timestamp DEFAULT now() NOT NULL,
	"signed_from_ip" varchar(64),
	"signed_user_agent" text,
	"cpf_confirmed" boolean DEFAULT false NOT NULL,
	"birth_date_confirmed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "procedure_session_attendances" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "procedure_session_signing_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"token" varchar(128) NOT NULL,
	"attendance_date" date NOT NULL,
	"session_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"consumed_at" timestamp,
	"verify_attempts" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "proc_session_signing_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "procedure_session_signing_tokens" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "procedure_session_attendance_sessions" ADD CONSTRAINT "procedure_session_attendance_sessions_attendance_id_procedure_session_attendances_id_fk" FOREIGN KEY ("attendance_id") REFERENCES "public"."procedure_session_attendances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_session_attendance_sessions" ADD CONSTRAINT "procedure_session_attendance_sessions_session_id_procedure_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."procedure_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_session_attendances" ADD CONSTRAINT "procedure_session_attendances_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_session_signing_tokens" ADD CONSTRAINT "procedure_session_signing_tokens_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_session_signing_tokens" ADD CONSTRAINT "procedure_session_signing_tokens_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "proc_session_attend_sessions_tenant_id_idx" ON "procedure_session_attendance_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "proc_session_attend_sessions_attendance_idx" ON "procedure_session_attendance_sessions" USING btree ("attendance_id");--> statement-breakpoint
CREATE INDEX "proc_session_attend_tenant_id_idx" ON "procedure_session_attendances" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "proc_session_attend_client_date_idx" ON "procedure_session_attendances" USING btree ("tenant_id","client_id","attendance_date");--> statement-breakpoint
CREATE INDEX "proc_session_signing_tokens_tenant_id_idx" ON "procedure_session_signing_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "proc_session_signing_tokens_client_date_idx" ON "procedure_session_signing_tokens" USING btree ("tenant_id","client_id","attendance_date");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "procedure_session_attendance_sessions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "procedure_session_attendances" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "procedure_session_signing_tokens" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);