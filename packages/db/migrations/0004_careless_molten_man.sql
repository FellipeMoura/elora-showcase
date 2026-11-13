CREATE TYPE "public"."appointment_status" AS ENUM('scheduled', 'confirmed', 'done', 'no_show', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."automation_trigger_type" AS ENUM('time_before_evaluation_appointment', 'time_after_evaluation_appointment', 'time_before_procedure_appointment', 'time_after_procedure_appointment', 'time_since_last_session', 'time_since_last_activity', 'journey_stage_changed', 'client_birthday', 'quote_status_changed');--> statement-breakpoint
CREATE TYPE "public"."client_form_status" AS ENUM('draft', 'completed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."form_question_type" AS ENUM('text', 'yes_no', 'multiple_choice', 'scale', 'number', 'date');--> statement-breakpoint
CREATE TYPE "public"."journey_source" AS ENUM('whatsapp', 'form', 'sheets', 'manual', 'recycling', 'imported', 'other');--> statement-breakpoint
CREATE TYPE "public"."journey_stage" AS ENUM('lead', 'evaluation', 'sale', 'treatment', 'result');--> statement-breakpoint
CREATE TYPE "public"."journey_status" AS ENUM('active', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('inbound', 'outbound', 'internal_note');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('text', 'media', 'template', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_template_kind" AS ENUM('text', 'media');--> statement-breakpoint
CREATE TYPE "public"."procedure_session_status" AS ENUM('pending', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."quote_origin" AS ENUM('evaluation', 'referral', 'direct_sale');--> statement-breakpoint
CREATE TYPE "public"."quote_status" AS ENUM('draft', 'sent', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."treatment_status" AS ENUM('active', 'completed', 'abandoned', 'manually_closed');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_message_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."whatsapp_provider_type" AS ENUM('quepasa', 'meta_cloud');--> statement-breakpoint
CREATE TABLE "automations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"trigger_type" "automation_trigger_type" NOT NULL,
	"trigger_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"template_id" uuid,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "automations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "client_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"form_template_id" uuid NOT NULL,
	"status" "client_form_status" DEFAULT 'draft' NOT NULL,
	"filled_at" timestamp,
	"general_observations" text,
	"completed_by_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "client_forms_client_template_unique" UNIQUE("client_id","form_template_id")
);
--> statement-breakpoint
ALTER TABLE "client_forms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "client_forms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"phone_e164" varchar(20) NOT NULL,
	"email" varchar(255),
	"birth_date" date,
	"notes" text,
	"is_vip" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "clients_tenant_phone_unique" UNIQUE("tenant_id","phone_e164")
);
--> statement-breakpoint
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_client_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "evaluation_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"professional_id" uuid,
	"unit_id" uuid,
	"scheduled_at" timestamp NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evaluation_appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "evaluation_appointments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "form_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_form_id" uuid NOT NULL,
	"question_id" uuid NOT NULL,
	"answer_text" text,
	"answer_option" varchar(255),
	"answer_boolean" boolean,
	"answer_number" numeric(18, 4),
	"answer_date" date,
	"answer_data" jsonb,
	"professional_observation" text,
	"answered_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "form_answers_form_question_unique" UNIQUE("client_form_id","question_id")
);
--> statement-breakpoint
ALTER TABLE "form_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_answers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "form_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"form_template_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"question_type" "form_question_type" NOT NULL,
	"options" jsonb,
	"section" varchar(128),
	"position" integer DEFAULT 0 NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "form_questions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_questions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "form_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"required_for_evaluation" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "form_templates_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "form_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journey_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"event_type" varchar(64) NOT NULL,
	"payload" jsonb,
	"actor_user_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journey_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journey_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "journeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"stage" "journey_stage" DEFAULT 'lead' NOT NULL,
	"source" "journey_source" NOT NULL,
	"source_metadata" jsonb,
	"status" "journey_status" DEFAULT 'active' NOT NULL,
	"lost_reason" varchar(64),
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journeys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journeys" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"body" text NOT NULL,
	"kind" "message_template_kind" DEFAULT 'text' NOT NULL,
	"surface_in_stage" text[],
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "msg_templates_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "message_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "message_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"journey_id" uuid,
	"direction" "message_direction" NOT NULL,
	"kind" "message_kind" DEFAULT 'text' NOT NULL,
	"body" text,
	"media_url" varchar(1024),
	"template_id" uuid,
	"whatsapp_message_id" uuid,
	"author_user_id" uuid,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "procedure_appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"professional_id" uuid,
	"unit_id" uuid,
	"equipment_id" uuid,
	"scheduled_at" timestamp NOT NULL,
	"duration_minutes" integer DEFAULT 30 NOT NULL,
	"status" "appointment_status" DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "procedure_appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "procedure_appointments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "procedure_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"procedure_appointment_id" uuid,
	"status" "procedure_session_status" DEFAULT 'pending' NOT NULL,
	"executed_at" timestamp,
	"executed_by_user_id" uuid,
	"evolution_notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "procedure_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "procedure_sessions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "procedures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"default_sessions" integer DEFAULT 1 NOT NULL,
	"default_price" numeric(12, 2),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "procedures_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
ALTER TABLE "procedures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "procedures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quote_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quote_id" uuid NOT NULL,
	"procedure_id" uuid NOT NULL,
	"quantity_sessions" integer DEFAULT 1 NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"discount_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quote_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"origin" "quote_origin" NOT NULL,
	"total_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" "quote_status" DEFAULT 'draft' NOT NULL,
	"valid_until" timestamp,
	"notes" text,
	"created_by_user_id" uuid,
	"sent_at" timestamp,
	"accepted_at" timestamp,
	"rejected_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "quotes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "treatment_procedures" (
	"treatment_id" uuid NOT NULL,
	"procedure_session_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "treatment_procedures_treatment_id_procedure_session_id_pk" PRIMARY KEY("treatment_id","procedure_session_id")
);
--> statement-breakpoint
ALTER TABLE "treatment_procedures" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "treatment_procedures" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "treatments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journey_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"status" "treatment_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "treatments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "treatments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"provider_type" "whatsapp_provider_type" NOT NULL,
	"provider_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"phone_number" varchar(32),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_channels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"whatsapp_channel_id" uuid NOT NULL,
	"client_id" uuid,
	"phone_e164" varchar(20) NOT NULL,
	"profile_name" varchar(255),
	"opted_in_at" timestamp,
	"opt_in_source" varchar(64),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_contacts_channel_phone_unique" UNIQUE("whatsapp_channel_id","phone_e164")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"whatsapp_channel_id" uuid NOT NULL,
	"whatsapp_contact_id" uuid NOT NULL,
	"conversation_id" uuid,
	"last_inbound_at" timestamp,
	"last_outbound_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_convs_channel_contact_unique" UNIQUE("whatsapp_channel_id","whatsapp_contact_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"whatsapp_conversation_id" uuid NOT NULL,
	"external_id" varchar(255),
	"direction" "whatsapp_message_direction" NOT NULL,
	"payload_type" varchar(32) DEFAULT 'text' NOT NULL,
	"payload" jsonb,
	"status" varchar(32),
	"status_updated_at" timestamp,
	"error_message" text,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "whatsapp_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"whatsapp_channel_id" uuid NOT NULL,
	"message_template_id" uuid NOT NULL,
	"meta_template_id" varchar(255),
	"meta_status" varchar(32),
	"meta_category" varchar(64),
	"meta_language" varchar(16),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "wa_templates_channel_template_unique" UNIQUE("whatsapp_channel_id","message_template_id")
);
--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "skip_evaluation" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automations" ADD CONSTRAINT "automations_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_forms" ADD CONSTRAINT "client_forms_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_forms" ADD CONSTRAINT "client_forms_form_template_id_form_templates_id_fk" FOREIGN KEY ("form_template_id") REFERENCES "public"."form_templates"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_forms" ADD CONSTRAINT "client_forms_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_appointments" ADD CONSTRAINT "evaluation_appointments_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_appointments" ADD CONSTRAINT "evaluation_appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_appointments" ADD CONSTRAINT "evaluation_appointments_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_appointments" ADD CONSTRAINT "evaluation_appointments_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_client_form_id_client_forms_id_fk" FOREIGN KEY ("client_form_id") REFERENCES "public"."client_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_question_id_form_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."form_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_questions" ADD CONSTRAINT "form_questions_form_template_id_form_templates_id_fk" FOREIGN KEY ("form_template_id") REFERENCES "public"."form_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_events" ADD CONSTRAINT "journey_events_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journey_events" ADD CONSTRAINT "journey_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journeys" ADD CONSTRAINT "journeys_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_whatsapp_message_id_whatsapp_messages_id_fk" FOREIGN KEY ("whatsapp_message_id") REFERENCES "public"."whatsapp_messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_appointments" ADD CONSTRAINT "procedure_appointments_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_appointments" ADD CONSTRAINT "procedure_appointments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_appointments" ADD CONSTRAINT "procedure_appointments_professional_id_users_id_fk" FOREIGN KEY ("professional_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_appointments" ADD CONSTRAINT "procedure_appointments_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_sessions" ADD CONSTRAINT "procedure_sessions_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_sessions" ADD CONSTRAINT "procedure_sessions_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_sessions" ADD CONSTRAINT "procedure_sessions_procedure_appointment_id_procedure_appointments_id_fk" FOREIGN KEY ("procedure_appointment_id") REFERENCES "public"."procedure_appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedure_sessions" ADD CONSTRAINT "procedure_sessions_executed_by_user_id_users_id_fk" FOREIGN KEY ("executed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "procedures" ADD CONSTRAINT "procedures_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_items" ADD CONSTRAINT "quote_items_procedure_id_procedures_id_fk" FOREIGN KEY ("procedure_id") REFERENCES "public"."procedures"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_procedures" ADD CONSTRAINT "treatment_procedures_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatment_procedures" ADD CONSTRAINT "treatment_procedures_procedure_session_id_procedure_sessions_id_fk" FOREIGN KEY ("procedure_session_id") REFERENCES "public"."procedure_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_journey_id_journeys_id_fk" FOREIGN KEY ("journey_id") REFERENCES "public"."journeys"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treatments" ADD CONSTRAINT "treatments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_channels" ADD CONSTRAINT "whatsapp_channels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_whatsapp_channel_id_whatsapp_channels_id_fk" FOREIGN KEY ("whatsapp_channel_id") REFERENCES "public"."whatsapp_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ADD CONSTRAINT "whatsapp_contacts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_whatsapp_channel_id_whatsapp_channels_id_fk" FOREIGN KEY ("whatsapp_channel_id") REFERENCES "public"."whatsapp_channels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_whatsapp_contact_id_whatsapp_contacts_id_fk" FOREIGN KEY ("whatsapp_contact_id") REFERENCES "public"."whatsapp_contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_conversations" ADD CONSTRAINT "whatsapp_conversations_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_messages" ADD CONSTRAINT "whatsapp_messages_whatsapp_conversation_id_whatsapp_conversations_id_fk" FOREIGN KEY ("whatsapp_conversation_id") REFERENCES "public"."whatsapp_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_whatsapp_channel_id_whatsapp_channels_id_fk" FOREIGN KEY ("whatsapp_channel_id") REFERENCES "public"."whatsapp_channels"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_message_template_id_message_templates_id_fk" FOREIGN KEY ("message_template_id") REFERENCES "public"."message_templates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automations_tenant_id_idx" ON "automations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "automations_active_idx" ON "automations" USING btree ("tenant_id","active");--> statement-breakpoint
CREATE INDEX "client_forms_tenant_id_idx" ON "client_forms" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "client_forms_client_id_idx" ON "client_forms" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "clients_tenant_id_idx" ON "clients" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "clients_tenant_birth_month_idx" ON "clients" USING btree ("tenant_id","birth_date");--> statement-breakpoint
CREATE INDEX "conversations_tenant_id_idx" ON "conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "eval_appts_tenant_id_idx" ON "evaluation_appointments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "eval_appts_journey_id_idx" ON "evaluation_appointments" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "eval_appts_scheduled_idx" ON "evaluation_appointments" USING btree ("tenant_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "eval_appts_professional_idx" ON "evaluation_appointments" USING btree ("professional_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "form_answers_tenant_id_idx" ON "form_answers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_answers_client_form_id_idx" ON "form_answers" USING btree ("client_form_id");--> statement-breakpoint
CREATE INDEX "form_questions_tenant_id_idx" ON "form_questions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "form_questions_template_id_idx" ON "form_questions" USING btree ("form_template_id");--> statement-breakpoint
CREATE INDEX "form_templates_tenant_id_idx" ON "form_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "journey_events_tenant_id_idx" ON "journey_events" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "journey_events_journey_id_idx" ON "journey_events" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "journeys_tenant_id_idx" ON "journeys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "journeys_client_id_idx" ON "journeys" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "journeys_stage_status_idx" ON "journeys" USING btree ("tenant_id","stage","status");--> statement-breakpoint
CREATE INDEX "journeys_last_activity_idx" ON "journeys" USING btree ("tenant_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "msg_templates_tenant_id_idx" ON "message_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "messages_tenant_id_idx" ON "messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_journey_idx" ON "messages" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "messages_whatsapp_idx" ON "messages" USING btree ("whatsapp_message_id");--> statement-breakpoint
CREATE INDEX "proc_appts_tenant_id_idx" ON "procedure_appointments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "proc_appts_journey_id_idx" ON "procedure_appointments" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "proc_appts_scheduled_idx" ON "procedure_appointments" USING btree ("tenant_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "proc_appts_professional_idx" ON "procedure_appointments" USING btree ("professional_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "proc_appts_equipment_idx" ON "procedure_appointments" USING btree ("equipment_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "proc_sessions_tenant_id_idx" ON "procedure_sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "proc_sessions_client_id_idx" ON "procedure_sessions" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "proc_sessions_appointment_id_idx" ON "procedure_sessions" USING btree ("procedure_appointment_id");--> statement-breakpoint
CREATE INDEX "procedures_tenant_id_idx" ON "procedures" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "quote_items_tenant_id_idx" ON "quote_items" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "quote_items_quote_id_idx" ON "quote_items" USING btree ("quote_id");--> statement-breakpoint
CREATE INDEX "quotes_tenant_id_idx" ON "quotes" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "quotes_journey_id_idx" ON "quotes" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "quotes_status_idx" ON "quotes" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "treatment_procedures_tenant_id_idx" ON "treatment_procedures" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "treatments_tenant_id_idx" ON "treatments" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "treatments_journey_id_idx" ON "treatments" USING btree ("journey_id");--> statement-breakpoint
CREATE INDEX "treatments_status_idx" ON "treatments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "wa_channels_tenant_id_idx" ON "whatsapp_channels" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "wa_contacts_tenant_id_idx" ON "whatsapp_contacts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "wa_contacts_client_id_idx" ON "whatsapp_contacts" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "wa_convs_tenant_id_idx" ON "whatsapp_conversations" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "wa_convs_conversation_idx" ON "whatsapp_conversations" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "wa_messages_tenant_id_idx" ON "whatsapp_messages" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "wa_messages_conv_idx" ON "whatsapp_messages" USING btree ("whatsapp_conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "wa_messages_external_idx" ON "whatsapp_messages" USING btree ("external_id");--> statement-breakpoint
CREATE INDEX "wa_templates_tenant_id_idx" ON "whatsapp_templates" USING btree ("tenant_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "automations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "client_forms" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "clients" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "conversations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "evaluation_appointments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "form_answers" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "form_questions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "form_templates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journey_events" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "journeys" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "message_templates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "messages" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "procedure_appointments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "procedure_sessions" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "procedures" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "quote_items" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "quotes" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "treatment_procedures" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "treatments" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "whatsapp_channels" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "whatsapp_contacts" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "whatsapp_conversations" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "whatsapp_messages" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "whatsapp_templates" AS PERMISSIVE FOR ALL TO public USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);