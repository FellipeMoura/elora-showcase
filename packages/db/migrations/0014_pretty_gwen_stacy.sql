CREATE TYPE "public"."message_deletion_origin" AS ENUM('client', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."message_media_type" AS ENUM('image', 'audio', 'video', 'document', 'sticker');--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'sticker';--> statement-breakpoint
ALTER TYPE "public"."message_kind" ADD VALUE 'call';--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "media_type" "message_media_type";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "call_payload" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "deletion_origin" "message_deletion_origin";--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ADD COLUMN "profile_picture_url" varchar(1024);