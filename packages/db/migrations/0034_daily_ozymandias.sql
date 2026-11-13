ALTER TABLE "users" ADD COLUMN "can_evaluate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "can_apply_procedures" boolean DEFAULT false NOT NULL;