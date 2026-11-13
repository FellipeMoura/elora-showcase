import type { ZodTypeAny } from 'zod';
import { openApiRegistry, z } from './registry.js';

// =====================================================================
// Schemas reutilizáveis entre endpoints. Registrados como components
// pra aparecerem na seção "Schemas" do OpenAPI/Postman e poderem ser
// referenciados via $ref.
// =====================================================================

// Shape do erro retornado por handleError (apps/chat/src/shared/middleware/handleError.ts).
// `details` aparece quando é validação Zod (array de { path, message }) ou
// um AppError construído com payload customizado.
export const errorResponseSchema = z
  .object({
    message: z.string().openapi({ example: 'Recurso não encontrado' }),
    details: z.unknown().optional(),
  })
  .openapi('ErrorResponse');

openApiRegistry.register('ErrorResponse', errorResponseSchema);

// Builder pra resposta paginada — chamado uma vez por entidade (ex:
// `paginatedSchema(channelSchema, 'PaginatedWhatsappChannels')`).
// `items` muda por endpoint, o resto é constante.
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

// Atalho: respostas de erro padronizadas. Inclui só os codes que aquele
// endpoint realmente pode retornar — passa os que se aplicam.
export const ERROR_RESPONSES = {
  400: {
    description: 'Dados inválidos (falha de validação Zod ou AppError 400)',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  401: {
    description: 'Não autenticado / assinatura inválida',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  403: {
    description: 'Tenant inconsistente entre subdomínio e JWT',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  404: {
    description: 'Recurso não encontrado',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  409: {
    description: 'Conflito (ex: nome duplicado, estado inválido pra ação)',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  410: {
    description:
      'Recurso desapareceu permanentemente (ex: canal de webhook removido). Provider deve parar de tentar.',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  500: {
    description: 'Erro interno do servidor',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
  502: {
    description: 'Erro de gateway (Evolution upstream indisponível ou inválido)',
    content: { 'application/json': { schema: errorResponseSchema } },
  },
} as const;

// =====================================================================
// Security: dois esquemas. `ensureAuthenticated` aceita os dois — então
// declaramos ambos e cada endpoint protegido lista `[{ cookieAuth }, { bearerAuth }]`
// (semântica OR: qualquer um basta).
//
// No Postman:
// - cookieAuth funciona automático via cookie jar — após POST /auth/login
//   (no CORE), o cookie `elora_token` fica salvo e é enviado em requests
//   subsequentes pro chat também (mesma origem em dev: `*.localhost`).
// - bearerAuth é fallback útil quando você quer rodar fora do flow de cookie.
// =====================================================================
export const REQUIRES_AUTH: Array<Record<string, string[]>> = [
  { cookieAuth: [] },
  { bearerAuth: [] },
];
