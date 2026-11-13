ALTER TABLE "users" ADD COLUMN "username" varchar(255);--> statement-breakpoint

-- Backfill: local-part do email; conflitos por tenant ganham sufixo numérico
-- (`base`, `base_2`, `base_3`, ...) na ordem de created_at (mais antigo fica
-- sem sufixo). Roda entre ADD COLUMN (nullable) e SET NOT NULL pra que a
-- constraint NOT NULL não falhe em linhas existentes.
WITH ranked AS (
  SELECT id,
         split_part(email, '@', 1) AS base,
         ROW_NUMBER() OVER (PARTITION BY tenant_id, split_part(email, '@', 1) ORDER BY created_at, id) AS rn
  FROM users
)
UPDATE users u
SET username = CASE WHEN r.rn = 1 THEN r.base ELSE r.base || '_' || r.rn::text END
FROM ranked r
WHERE u.id = r.id;
--> statement-breakpoint

ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_tenant_email_unique";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_username_unique" UNIQUE("tenant_id","username");
