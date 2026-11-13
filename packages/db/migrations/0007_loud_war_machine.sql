-- Rename enum value `quepasa` → `baileys` (ver arquitetura.md §7.2).
-- Drizzle-kit não gera o UPDATE intermediário automaticamente — sem ele, o
-- USING cast da última linha estoura porque 'quepasa' não está no enum novo.
-- Editado à mão depois do drizzle-kit pra remapear linhas existentes.
ALTER TABLE "public"."whatsapp_channels" ALTER COLUMN "provider_type" SET DATA TYPE text;--> statement-breakpoint
UPDATE "public"."whatsapp_channels" SET "provider_type" = 'baileys' WHERE "provider_type" = 'quepasa';--> statement-breakpoint
DROP TYPE "public"."whatsapp_provider_type";--> statement-breakpoint
CREATE TYPE "public"."whatsapp_provider_type" AS ENUM('baileys', 'meta_cloud');--> statement-breakpoint
ALTER TABLE "public"."whatsapp_channels" ALTER COLUMN "provider_type" SET DATA TYPE "public"."whatsapp_provider_type" USING "provider_type"::"public"."whatsapp_provider_type";