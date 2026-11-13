ALTER TABLE "clients" ADD COLUMN "document" varchar(20);--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "address" jsonb;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "legal_name" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "trade_name" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "document" varchar(20);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "representative_name" varchar(255);--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "logo_url" varchar(1024);--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "card_installments";--> statement-breakpoint
ALTER TABLE "public"."payments" ALTER COLUMN "payment_method" SET DATA TYPE text;--> statement-breakpoint
-- Converte rows com valor `recurring` (removido do enum) pra `other` antes
-- de recriar o type. Sem isso, o cast falha com 22P02.
UPDATE "public"."payments" SET "payment_method" = 'other' WHERE "payment_method" = 'recurring';--> statement-breakpoint
DROP TYPE "public"."payment_method";--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('pix', 'credit_card', 'debit_card', 'cash', 'bank_transfer', 'other');--> statement-breakpoint
ALTER TABLE "public"."payments" ALTER COLUMN "payment_method" SET DATA TYPE "public"."payment_method" USING "payment_method"::"public"."payment_method";