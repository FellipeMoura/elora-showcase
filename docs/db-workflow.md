# Workflow de Banco de Dados

Como adicionar, alterar ou remover estrutura de banco no Elora. Este documento é a fonte de verdade para qualquer operação de DDL — qualquer dev ou agente Claude trabalhando no projeto deve seguir esses passos.

## Princípio fundamental

**`packages/db/src/schema.ts` é a fonte da verdade.** O banco é um espelho do schema. Nunca mexa direto no banco via psql/Drizzle Studio para alterar estrutura.

## Dois roles Postgres (RLS efetiva)

O banco do Elora usa **dois roles** distintos para que RLS funcione:

- **`elora`** — admin/superuser. Usado por `pnpm db:migrate` (DDL), `pnpm db:seed`, drizzle-kit, drizzle-studio. **Bypassa RLS por ser superuser** — natural pra migrations e debugging.
- **`elora_app`** — role da aplicação (`apps/core`, `apps/chat`). `NOSUPERUSER NOBYPASSRLS`. RLS efetiva — toda query precisa estar dentro de `withTenant(...)`.

Sem essa separação, o app conecta como superuser e RLS vira só "cinto sem suspensório" — qualquer query sem `WHERE tenant_id` vaza dados. **Não junte os dois roles em um.**

O role `elora_app` é criado por [infra/postgres-init.sql](../infra/postgres-init.sql) automaticamente quando o volume Postgres nasce. Para volume já existente, aplicar manualmente:

```powershell
docker exec -i elora_postgres psql -U elora -d elora_dev `< infra/postgres-init.sql
```

`ALTER DEFAULT PRIVILEGES` no init.sql garante que toda tabela nova criada por `elora` (via migration) já dá `SELECT/INSERT/UPDATE/DELETE` ao `elora_app` automaticamente — sem precisar de `GRANT` manual nas migrations geradas pelo drizzle-kit.

Variáveis de ambiente:
- `DATABASE_USER` / `DATABASE_PASSWORD` — admin (`elora`). Lido por drizzle-kit e migrate.ts.
- `DATABASE_APP_USER` / `DATABASE_APP_PASSWORD` — app (`elora_app`). Lido por `apps/core/src/env.ts` e `apps/chat/src/env.ts`.

```
schema.ts (TypeScript)
    │
    ▼ pnpm db:generate
    │
SQL migration (gerada pelo drizzle-kit)
    │
    ▼ edição manual (se houver RLS)
    │
SQL migration final (em migrations/)
    │
    ▼ pnpm migrate
    │
Banco atualizado
```

Drizzle Studio é pra mexer em **dados** (CRUD em linhas). Pra **estrutura** (DDL: tabelas, colunas, índices), sempre o fluxo acima.

---

## Cenários

### 1. Adicionar uma nova coluna a uma tabela existente

**Exemplo**: adicionar `phone` à tabela `users`.

1. **Editar `packages/db/src/schema.ts`** — adicionar a coluna na definição da tabela:

   ```ts
   export const users = pgTable('users', {
     // ... colunas existentes ...
     phone: varchar('phone', { length: 20 }),  // nullable por default
   });
   ```

2. **Gerar a migration**:

   ```powershell
   pnpm db:generate
   ```

   Drizzle-kit cria um arquivo `migrations/000N_<nome_aleatorio>.sql` com o `ALTER TABLE` correspondente.

3. **Revisar o SQL gerado.** Abrir o arquivo e conferir se faz sentido. Para adições de coluna, normalmente não precisa editar.

4. **Aplicar**:

   ```powershell
   pnpm migrate
   ```

5. **Commit**: schema.ts + migration gerada + meta atualizada (`migrations/meta/`).

### 2. Adicionar uma nova tabela COM RLS

**Exemplo**: adicionar tabela `clients` que precisa de isolamento por tenant.

1. **Editar `packages/db/src/schema.ts`** — definir a tabela com `pgPolicy` + `enableRLS()`:

   ```ts
   import { sql } from 'drizzle-orm';
   import { pgPolicy, pgTable, /* ... */ } from 'drizzle-orm/pg-core';

   const tenantPolicy = sql`tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid`;

   export const clients = pgTable(
     'clients',
     {
       id: uuid('id').primaryKey().defaultRandom(),
       tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
       name: varchar('name', { length: 255 }).notNull(),
       // ... outras colunas ...
       createdAt: timestamp('created_at').notNull().defaultNow(),
       updatedAt: timestamp('updated_at')
         .notNull()
         .defaultNow()
         .$onUpdate(() => new Date()),
     },
     (t) => [
       index('clients_tenant_id_idx').on(t.tenantId),
       pgPolicy('tenant_isolation', {
         as: 'permissive',
         for: 'all',
         using: tenantPolicy,
         withCheck: tenantPolicy,
       }),
     ]
   ).enableRLS();
   ```

2. **Gerar a migration**:

   ```powershell
   pnpm db:generate
   ```

   Drizzle-kit gera CREATE TABLE + ENABLE RLS + CREATE POLICY.

3. **EDITAR a migration gerada** para adicionar `FORCE ROW LEVEL SECURITY`. Drizzle-kit não gera FORCE automaticamente, e sem ele o owner da tabela bypassa RLS.

   Abrir `migrations/000N_<nome>.sql`. Logo após cada linha:

   ```sql
   ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
   ```

   Adicionar:

   ```sql
   ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;
   ```

   **Esse passo é obrigatório para toda tabela com `enableRLS()`.** Esquecer significa: dados visíveis sem tenant context, vazamento entre tenants.

4. **Aplicar**:

   ```powershell
   pnpm migrate
   ```

5. **Commit**: schema.ts + migration editada.

### 3. Renomear uma coluna ou tabela

Drizzle-kit detecta renames quando os tipos batem mas o nome muda. Pode pedir confirmação interativa no `db:generate`.

1. **Editar `schema.ts`** com o novo nome.
2. **Rodar `pnpm db:generate`**. Drizzle-kit pode perguntar: "Is `old_name` renamed to `new_name`? (y/n)". Responder `y` se for rename, `n` se for drop+create.
3. Aplicar normalmente.

**Cuidado em prod**: rename é breaking change. Em SaaS multi-tenant rodando, fazer rename via duas migrations (`add new column → backfill → drop old column`) é mais seguro. Pra dev é tranquilo.

### 4. Adicionar um índice

1. **Editar `schema.ts`** — adicionar dentro do array de constraints:

   ```ts
   (t) => [
     index('clients_email_idx').on(t.email),
     // ... outros constraints ...
   ]
   ```

2. `pnpm db:generate` → `pnpm migrate`.

### 5. Drop de coluna ou tabela

Drizzle-kit detecta o que foi removido do schema e gera `DROP COLUMN` / `DROP TABLE`.

**Cuidado**: drop apaga dados. Em prod, considerar:
- Soft delete (manter coluna, marcar como deprecated)
- Migration em duas fases (parar de escrever → remover)

Em dev, drop direto é OK.

---

## Seed em dev — preservação de canais reais

O `pnpm seed` faz `TRUNCATE tenants CASCADE`, que normalmente apagaria `whatsapp_channels` e quebraria a vinculação Elora ↔ Evolution (a pareação WhatsApp persiste no servidor Evolution mesmo após o truncate, mas o link com o canal no Elora não).

**Como funciona a preservação** (`packages/db/seed.ts`):
1. **Antes do TRUNCATE**: snapshot de todos canais NÃO-mock (`provider_config.mock IS NOT TRUE`), gravando `id`, `tenantSlug` (via JOIN com `tenants`), `providerConfig` (instanceName + apiKey), `name`, `phoneNumber`, `active`.
2. **TRUNCATE + recreate tenants** normalmente — UUIDs de tenant mudam, mas slugs são estáveis.
3. **Restauração**: pra cada canal preservado, resolve `tenantId` novo via slug e re-insere com o **mesmo `id` original**. UUID preservado é crítico: o webhook URL gravado dentro do Evolution embute esse UUID — sem preservar, todo evento bate em endpoint inexistente (404 spam).
4. Tenants que ficaram com canal preservado **não recebem o mock** padrão (evita 2 canais por tenant).

**Quando isso falha:**
- Você removeu/renomeou o slug do tenant: o seed loga `console.warn` e descarta o canal preservado. Reparear nesse caso.
- O canal era mock: descartado intencionalmente (próximo seed recria mock como sempre).

## Comandos disponíveis

| Comando | O que faz |
|---|---|
| `pnpm db:generate` | Gera migration SQL a partir do diff entre `schema.ts` e o último snapshot |
| `pnpm db:check` | Valida que as migrations estão consistentes com o schema |
| `pnpm migrate` | Aplica migrations pendentes (via runner custom em `migrate.ts`) |
| `pnpm migrate:status` | Lista migrations aplicadas e pendentes |
| `pnpm seed` | Roda o seed de dev (`packages/db/seed.ts`) |
| `pnpm studio` | Abre Drizzle Studio (GUI pra dados, não pra DDL) |
| `pnpm infra:reset` | Apaga volumes Docker — RESET total do banco |

---

## Estrutura de arquivos

```
packages/db/
├── drizzle.config.ts      # Config do drizzle-kit (caminho do schema, credenciais dev)
├── migrate.ts             # Runner custom (aplica .sql files em ordem alfabética)
├── seed.ts                # Seed de dev (Drizzle queries)
├── src/
│   ├── schema.ts          # FONTE DA VERDADE — definição de todas as tabelas
│   ├── createDb.ts        # Factory do client Drizzle
│   ├── tenantContext.ts   # withTenant() — abre transação + SET LOCAL
│   └── index.ts           # Exports públicos do package
└── migrations/
    ├── 0000_*.sql         # Migrations geradas (auto + edits manuais de RLS)
    ├── 0001_*.sql
    └── meta/              # Snapshots usados pelo drizzle-kit (NÃO MEXER)
        ├── _journal.json
        └── 0000_snapshot.json
```

---

## Regras absolutas

1. **Nunca alterar estrutura via Drizzle Studio ou psql direto.** Sempre via schema.ts + migration.
2. **Nunca editar uma migration já aplicada.** Se precisa corrigir algo, gerar nova migration.
3. **Toda tabela com `enableRLS()` no schema.ts deve ter `FORCE ROW LEVEL SECURITY` adicionado manualmente na migration gerada.** Sem FORCE, RLS não vale pro owner.
4. **Toda coluna `updated_at` deve ter `.$onUpdate(() => new Date())`.** Atualização automática de timestamp é responsabilidade do Drizzle (camada de aplicação), não de trigger Postgres. Padrão fixo:

   ```ts
   updatedAt: timestamp('updated_at')
     .notNull()
     .defaultNow()
     .$onUpdate(() => new Date()),
   ```

   Risco aceito: writes que não passam pelo Drizzle (psql manual, scripts SQL puros) não atualizam `updated_at`. Considerado tolerável dado que toda escrita em produção passa pelo backend Node.
5. **Migration gerada vai pro git.** Inclui o snapshot em `migrations/meta/`.
6. **Após `db:generate`, sempre revisar o SQL antes de `migrate`.** Drizzle-kit acerta na maior parte, mas é responsabilidade do dev validar.
7. **Nunca renomear arquivo de migration.** O nome do arquivo é a chave usada pelo runner (`packages/db/migrate.ts`) na tabela `__migrations` e pelo drizzle-kit em `migrations/meta/_journal.json`. Renomear depois de aplicado quebra os dois ao mesmo tempo: o runner tenta reaplicar (colide com tabelas existentes) e o drizzle-kit perde rastro do snapshot. Se quiser nomes mais descritivos, edite manualmente **antes** de rodar `pnpm migrate` E atualize a entrada `tag` em `migrations/meta/_journal.json` na mesma operação.

---

## Anti-padrões a evitar

- ❌ Mexer no banco via Drizzle Studio e depois "atualizar" o schema.ts pra refletir.
- ❌ Editar uma migration já aplicada pra "consertar" — gerar uma nova.
- ❌ Usar `db.execute(sql\`ALTER TABLE...\`)` em código de aplicação. DDL é responsabilidade de migration.
- ❌ Adicionar coluna no schema sem rodar `db:generate` (banco fica defasado).
- ❌ Esquecer `FORCE ROW LEVEL SECURITY` em tabela nova com RLS — vazamento silencioso entre tenants.
- ❌ Declarar `updated_at` sem `.$onUpdate(() => new Date())` — coluna fica congelada após o insert, sem refletir alterações.
- ❌ Adicionar trigger Postgres pra manter `updated_at` — decisão consciente do projeto é manter a regra na camada de aplicação (ver Regras absolutas, item 4).
- ❌ Renomear arquivo de migration depois de aplicado — quebra o tracking em `__migrations` e em `migrations/meta/_journal.json` (ver Regras absolutas, item 7).
