CREATE TYPE "public"."message_delivery_status" AS ENUM('pending', 'sent', 'failed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."message_failure_reason" AS ENUM('no_opt_in', 'channel_disconnected', 'window_24h_expired', 'invalid_template', 'rate_limited', 'provider_error', 'worker_timeout', 'unknown');--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "template_variables" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "delivery_status" "message_delivery_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "failure_reason" "message_failure_reason";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "failure_detail" jsonb;--> statement-breakpoint
CREATE INDEX "messages_pending_stuck_idx" ON "messages" USING btree ("created_at") WHERE delivery_status = 'pending';--> statement-breakpoint
ALTER TABLE "client_forms" DROP COLUMN "general_observations";