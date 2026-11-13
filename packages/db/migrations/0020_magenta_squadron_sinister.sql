CREATE TYPE "public"."lead_substage" AS ENUM('new', 'template', 'contact', 'scheduled', 'no_show', 'rescheduled', 'quoted');--> statement-breakpoint
ALTER TABLE "journeys" ADD COLUMN "lead_substage" "lead_substage";--> statement-breakpoint
CREATE INDEX "journeys_lead_substage_idx" ON "journeys" USING btree ("tenant_id","lead_substage");