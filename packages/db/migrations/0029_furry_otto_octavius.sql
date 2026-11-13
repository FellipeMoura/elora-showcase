ALTER TYPE "public"."payment_method" ADD VALUE 'recurring' BEFORE 'other';--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "card_installments" integer DEFAULT 1 NOT NULL;