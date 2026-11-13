import type { ZodTypeAny } from 'zod';
import { openApiRegistry, z } from './registry.js';

// =====================================================================
// Schemas reutilizáveis entre endpoints. Registrados como components
// pra aparecerem na seção "Schemas" do OpenAPI/Postman e poderem ser
// referenciados via $ref.
// =====================================================================

// Shape do erro retornado por handleError. `details` aparece em validação
// Zod (array de { path, message }) ou em AppError construído com payload.
export const errorResponseSchema = z
  .object({
    message: z.string().openapi({ example: 'Recurso não encontrado' }),
    details: z.unknown().optional(),
  })
  .openapi('ErrorResponse');

openApiRegistry.register('ErrorResponse', errorResponseSchema);

export function paginatedSchema<T extends ZodTypeAny>(
  itemSchema: T,
  name: string
): ReturnType<typeof z.object> {
  const schema = z.object({
    items: z.array(itemSchema),
    total: z.number().int().nonnegative().openapi({ example: 42 }),
    page: z.number().int().min(1).openapi({ example: 1 }),
    pageSize: z.number().int().min(1).openapi({ example: 20 }),
    totalPages: z.number().int().min(0).openapi({ example: 3 }),
  });
  return schema.openapi(name);
}

export const ERROR_RESPONSES = {
  400: {
    description: 'Dados inválidos (falha de validação Zod ou AppError 400)',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  401: {
    description: 'Não autenticado / credenciais inválidas / token inválido',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  403: {
    description: 'Sem permissão / tenant inconsistente entre subdomínio e JWT',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  404: {
    description: 'Recurso não encontrado',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  409: {
    description: 'Conflito (ex: estado inválido pra ação)',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  429: {
    description: 'Rate limit (login attempts)',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  500: {
    description: 'Erro interno do servidor',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  502: {
    description: 'Erro em provider externo (ZapSign, Evolution, etc.)',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  503: {
    description: 'Provider externo não provisionado (token/config ausente)',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
} as const;

// =====================================================================
// Security: dois esquemas. `ensureAuthenticated` aceita os dois — então
// declaramos ambos e cada endpoint protegido lista `[{ cookieAuth }, { bearerAuth }]`
// (semântica OR: qualquer um basta).
//
// No Postman:
// - cookieAuth funciona automático via cookie jar — após POST /auth/login,
//   o cookie `elora_token` fica salvo e é enviado em requests subsequentes.
// - bearerAuth é fallback útil quando você quer rodar fora do flow de cookie
//   (CI, integração com outro app, debug forense). Pega o token do response
//   do login se preferir.
// =====================================================================
// Tipo explícito (Record<string, string[]>) pra casar com o
// SecurityRequirementObject que o `registerPath` exige. TS infere
// união de objetos quando cada item tem chave diferente — cast estabiliza.
export const REQUIRES_AUTH: Array<Record<string, string[]>> = [
  { cookieAuth: [] },
  { bearerAuth: [] },
];
