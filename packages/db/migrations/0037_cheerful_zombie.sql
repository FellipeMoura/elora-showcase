ALTER TYPE "public"."message_failure_reason" ADD VALUE 'not_on_whatsapp' BEFORE 'channel_disconnected';--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ADD COLUMN "whatsapp_e164" varchar(20);