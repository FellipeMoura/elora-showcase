ALTER TABLE "conversations" ADD COLUMN "last_staff_seen_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferences" jsonb DEFAULT '{}'::jsonb NOT NULL;