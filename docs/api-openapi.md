# OpenAPI + Postman

Como cada endpoint do Elora aparece no Postman automaticamente, e o que você precisa fazer ao adicionar/alterar rotas.

## Como funciona

Cada app expõe `GET /openapi.json` montado a partir de um registry global. Toda rota declara seu shape (params, query, body, responses) via `openApiRegistry.registerPath(...)` no próprio `*Routes.ts`. O JSON resultante é OpenAPI **3.0.3** (não 3.1 — Postman tem suporte irregular pra 3.1; 3.0.3 é aceito universalmente).

- `apps/core` → `http://localhost:5501/openapi.json` — Auth, Me, Users, Groups, Menus, Tenant, Clients
- `apps/chat` → `http://localhost:5502/openapi.json` — WhatsApp Channels/Contacts/Messages, Message Templates, Conversations, Messages, Webhooks

Postman: **File → Import → Link → cola a URL → marca "Auto-update".** A cada save no código + restart do app, Postman sincroniza. Não precisa exportar nada manualmente.

**`servers.url` em dev usa placeholder de tenant:** o JSON declara `http://{tenant}.localhost:PORT` com `tenant` como variável (`clinica-a` default, `clinica-b` opção). Postman renderiza como variável editável da collection — trocar tenant é um click sem reescrever URLs. Em prod, sobrescreva via env `SERVER_URL_OVERRIDE`.

**Header `Host`** continua sendo o que importa pro tenant resolver — usando a URL `*.localhost` o Postman envia `Host: clinica-a.localhost` naturalmente (não precisa configurar). Importante pra `tenantContextMiddleware` extrair o slug.

**Auth flow**: depois de `POST /auth/login` no core, o cookie httpOnly `elora_token` cai no cookie jar do Postman e é enviado automaticamente em todos os requests subsequentes — inclusive nos do chat (mesma origem `*.localhost`). Sem trocar de header manual entre as duas collections.

## Setup no app (feito nos dois)

```
apps/{core,chat}/src/shared/openapi/
├── registry.ts    # extendZodWithOpenApi(z) + singleton OpenAPIRegistry
├── helpers.ts     # ERROR_RESPONSES, paginatedSchema(), errorResponseSchema
│                  # (no core também: REQUIRES_AUTH = [{ cookieAuth: [] }, { bearerAuth: [] }])
├── document.ts    # buildOpenApiDocument() — gera o JSON final
│                  # (no core também: registra securitySchemes cookieAuth + bearerAuth)
└── index.ts       # barrel
```

Pontos críticos:
- `server.ts` importa `./shared/openapi/registry.js` **antes de qualquer outro import** — o side-effect `extendZodWithOpenApi(z)` precisa rodar antes de qualquer schema chamar `.openapi(...)`.
- Schemas que querem usar `.openapi(...)` importam `z` de `shared/openapi/registry.ts` (não de `zod` direto).
- Rotas registradas via `registerPath` ficam no MESMO arquivo do `router.METHOD(...)` — locality > tabela central.

## Pattern de anotação (referência: [whatsappChannels](../apps/chat/src/modules/whatsappChannels))

### 1. `XxxTypes.ts` — anota schemas Zod

```ts
import type { InferSelectModel, whatsappChannels } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

// Response: escrito à mão. Drift risk gerenciado — quando schema.ts muda,
// atualiza aqui no mesmo PR. (Tentamos derivar via drizzle-zod mas
// drizzle-zod@0.8 usa Zod v4 e zod-to-openapi@7 só suporta v3 — quando
// subir todo o stack pra v4, dá pra automatizar.)
export const whatsappChannelResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    // ...
  })
  .openapi('WhatsappChannel');

// Input schemas: anota campo por campo com example + description.
export const createChannelSchema = z
  .object({
    name: z.string().min(1).max(255).openapi({ example: 'WhatsApp Recepção' }),
    providerType: z.enum(['baileys', 'meta_cloud']).openapi({ example: 'baileys' }),
    // ...
  })
  .openapi('CreateWhatsappChannelInput');
```

Convenção:
- `.openapi('NomeDoComponent')` no schema raiz → vira referenciável via `$ref` no doc final.
- `.openapi({ example, description })` em campo individual → enriquece Postman/Swagger UI.
- Nome do componente em PascalCase, prefixado pelo domínio (`WhatsappChannel`, `CreateWhatsappChannelInput`, `PaginatedWhatsappChannels`).

### 2. `xxxRoutes.ts` — registra cada endpoint

```ts
import { ERROR_RESPONSES, openApiRegistry, paginatedSchema } from '../../shared/openapi/index.js';

const TAG = 'WhatsApp Channels';

const paginatedChannelsSchema = paginatedSchema(
  whatsappChannelResponseSchema,
  'PaginatedWhatsappChannels'
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/whatsapp/channels',  // OpenAPI usa {id}, não :id
  tags: [TAG],
  summary: 'Lista canais WhatsApp do tenant',
  request: { query: findChannelsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedChannelsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
  },
});

router.get('/whatsapp/channels', validateQuery(findChannelsQuerySchema), Controller.find);
```

Convenções:
- **Tag única por módulo** — agrupa endpoints em uma "pasta" no Postman.
- Paths em OpenAPI usam `{id}`, em Express usam `:id`. Mantém os dois sincronizados manualmente.
- `ERROR_RESPONSES[400|401|403|404|409|500]` — códigos prontos com schema de erro. Inclua só os que aquele endpoint realmente retorna.
- `paginatedSchema(itemSchema, 'Name')` — só pra endpoints `find` paginados.

## Quando criar uma rota nova

Checklist mental:
1. Definir Zod schemas em `XxxTypes.ts` (input + se precisar, response derivado).
2. Anotar com `.openapi(...)` (campo + nome do componente).
3. No `xxxRoutes.ts`: chamar `openApiRegistry.registerPath(...)` **antes** do `router.METHOD(...)`.
4. Restart do app → Postman puxa a versão nova via auto-update.

## Quando NÃO usar

- **Health check** (`/health`) — sem schema relevante, é só ping. Pode anotar se quiser, mas não obriga.
- **Webhook de provider real** (`/webhook/whatsapp/:channelId`) — o body varia POR provider. Documentamos o shape do Mock como exemplo; o adapter de cada provider real normaliza payloads próprios pra `NormalizedInboundEvent` internamente.

## Quando o doc fica desatualizado

A única fonte de drift possível é alguém adicionar uma rota e esquecer do `registerPath`. Pra pegar:
- Code review: PR que adiciona `router.METHOD(...)` sem o `registerPath` correspondente é caught manualmente.
- Validação automatizada: futuro lint/test que itera `router.stack` e compara com `registry.definitions`. Pendente.

## Security scheme (só no core)

Endpoints autenticados do core usam `security: REQUIRES_AUTH` no `registerPath` — declara `cookieAuth` (preferido, automático via Postman cookie jar após `/auth/login`) **OU** `bearerAuth` (header `Authorization: Bearer <jwt>`). Semântica OR: qualquer um basta. O middleware `ensureAuthenticated` aceita ambos.

Chat não precisa declarar security explícito hoje porque todas as rotas autenticadas passam pelo mesmo `ensureAuthenticated` que o core (cookie + bearer). Se quiser apertar a documentação no chat também, importa `REQUIRES_AUTH` do `shared/openapi/helpers.ts` do core e replica.

## Quando a duplicação `shared/openapi/` doer

Hoje cada app tem sua cópia (~5 arquivos quase idênticos). Quando virar fricção real (3+ apps, ou mudança de pattern que precise propagar manualmente), extrai pra `packages/openapi-setup/` re-exportando registry + helpers. Custo de extração é baixo — registry é singleton por process, então `packages/openapi-setup` exportaria uma factory `createRegistry()` chamada uma vez por app.
