CREATE TYPE "public"."agent_trigger_type" AS ENUM('idle', 'out_of_hours', 'manual_resume');--> statement-breakpoint
ALTER TYPE "public"."role_code" ADD VALUE 'agent';--> statement-breakpoint
CREATE TABLE "agent_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"trigger_type" "agent_trigger_type" NOT NULL,
	"trigger_metadata" jsonb,
	"input_message_id" uuid,
	"prompt_version" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_tokens" integer DEFAULT 0 NOT NULL,
	"cost_cents" numeric(10, 4) DEFAULT '0' NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"tool_calls" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"output_message_ids" uuid[],
	"classification_tag_ids" uuid[],
	"handoff_reason" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_turns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_tag_assignments" (
	"conversation_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assigned_by_agent_turn_id" uuid,
	"assigned_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_tag_assignments_conversation_id_tag_id_pk" PRIMARY KEY("conversation_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "conversation_tag_assignments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversation_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(64) NOT NULL,
	"color" varchar(16) NOT NULL,
	"agent_instruction" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_tags_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "conversation_tags" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "agent_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "agent_idle_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "agent_persona" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "business_hours" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_system_agent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_turns" ADD CONSTRAINT "agent_turns_input_message_id_messages_id_fk" FOREIGN KEY ("input_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tag_assignments" ADD CONSTRAINT "conversation_tag_assignments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tag_assignments" ADD CONSTRAINT "conversation_tag_assignments_tag_id_conversation_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."conversation_tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tag_assignments" ADD CONSTRAINT "conversation_tag_assignments_assigned_by_agent_turn_id_agent_turns_id_fk" FOREIGN KEY ("assigned_by_agent_turn_id") REFERENCES "public"."agent_turns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_turns_tenant_created_idx" ON "agent_turns" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_turns_conv_created_idx" ON "agent_turns" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "conv_tag_asgn_tenant_id_idx" ON "conversation_tag_assignments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "conv_tag_asgn_tag_idx" ON "conversation_tag_assignments" USING btree ("tag_id");--> statement-breakpoint
CREATE INDEX "conversation_tags_tenant_id_idx" ON "conversation_tags" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agent_turns" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversation_tag_assignments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversation_tags" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);