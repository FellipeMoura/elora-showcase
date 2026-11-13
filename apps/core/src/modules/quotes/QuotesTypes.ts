import {
  quoteItems,
  quotes,
  type InferSelectModel,
} from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';
import { paymentMethodValues as salesPaymentMethodValues } from '../sales/SalesTypes.js';

export type Quote = InferSelectModel<typeof quotes>;
export type QuoteItem = InferSelectModel<typeof quoteItems>;

export const quotesSortSpec = createSortSpec(
  {
    createdAt: quotes.createdAt,
    updatedAt: quotes.updatedAt,
    sentAt: quotes.sentAt,
    acceptedAt: quotes.acceptedAt,
    totalAmount: quotes.totalAmount,
  },
  { field: 'createdAt', direction: 'desc' }
);

export const quoteOriginValues = ['evaluation', 'referral', 'direct_sale'] as const;
export const quoteStatusValues = [
  'draft',
  'sent',
  'accepted',
  'rejected',
  'expired',
] as const;

// Métodos de pagamento — fonte da verdade em sales/SalesTypes (espelha o pg
// enum payment_method). Re-export aqui pra manter API estável e evitar
// duplicação.
export const paymentMethodValues = salesPaymentMethodValues;

// Decimal padronizado pra valores monetários — number na entrada, string
// (Drizzle decimal) na saída. Limita 2 casas decimais.
const moneySchema = z
  .number()
  .nonnegative('Valor não pode ser negativo')
  .max(9_999_999_999.99)
  .refine((v) => Math.round(v * 100) === v * 100, {
    message: 'Valor deve ter no máximo 2 casas decimais',
  });

const percentSchema = z
  .number()
  .min(0)
  .max(100)
  .refine((v) => Math.round(v * 100) === v * 100, {
    message: 'Percentual deve ter no máximo 2 casas decimais',
  });

// =====================================================================
// Quote (orçamento)
// =====================================================================

export const quoteResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    journeyId: z.string().uuid(),
    origin: z.enum(quoteOriginValues),
    totalAmount: z.string(),
    discountAmount: z.string(),
    status: z.enum(quoteStatusValues),
    validUntil: z.string().datetime().nullable(),
    notes: z.string().nullable(),
    createdByUserId: z.string().uuid().nullable(),
    sentAt: z.string().datetime().nullable(),
    acceptedAt: z.string().datetime().nullable(),
    rejectedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Quote');

// Versão enriquecida usada na listagem (`GET /quotes`) — junta dados do
// cliente (via journey) pra UI exibir nome/telefone sem N+1. Não usado em
// GET /quotes/:id porque o detalhe já vive sob contexto de journey/client.
export const quoteListItemSchema = quoteResponseSchema
  .extend({
    clientId: z.string().uuid(),
    clientName: z.string(),
    clientPhoneE164: z.string(),
    // Sale associado ao quote quando fechado (relação 1:1 via sales.quote_id).
    // null quando o quote ainda não virou venda. Permite à listagem exibir o
    // valor da venda (que pode divergir do quote por items "perdidos" no
    // fechamento) sem chamada adicional.
    saleId: z.string().uuid().nullable(),
    saleTotalAmount: z.string().nullable(),
    saleClosedAt: z.string().datetime().nullable(),
  })
  .openapi('QuoteListItem');

export const createQuoteSchema = z
  .object({
    journeyId: z.string().uuid('journeyId inválido'),
    origin: z.enum(quoteOriginValues),
    discountAmount: moneySchema.default(0),
    validUntil: z.string().datetime().nullable().optional(),
    notes: z.string().trim().max(10000).nullable().optional(),
  })
  .openapi('CreateQuoteInput');

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;

export const updateQuoteSchema = z
  .object({
    discountAmount: moneySchema.optional(),
    validUntil: z.string().datetime().nullable().optional(),
    notes: z.string().trim().max(10000).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateQuoteInput');

export type UpdateQuoteInput = z.infer<typeof updateQuoteSchema>;

export const findQuotesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    journeyId: z.string().uuid().optional(),
    // Filtra por cliente agregando todas as journeys do cliente — histórico
    // completo de vendas/orçamentos. Mutualmente compatível com journeyId.
    clientId: z.string().uuid().optional(),
    status: z.enum(quoteStatusValues).optional(),
    origin: z.enum(quoteOriginValues).optional(),
    // Busca textual em client.name + client.phone_e164 (cascata via journeys).
    q: z.string().trim().min(1).max(120).optional(),
  })
  .merge(sortQuerySchema(quotesSortSpec))
  .openapi('FindQuotesQuery');

export type FindQuotesQuery = z.infer<typeof findQuotesQuerySchema>;

export type QuoteListItem = z.infer<typeof quoteListItemSchema>;

export const quoteIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export type QuoteIdParam = z.infer<typeof quoteIdParamSchema>;

// =====================================================================
// Items (sub-recurso)
// =====================================================================

export const quoteItemResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    quoteId: z.string().uuid(),
    procedureId: z.string().uuid(),
    quantitySessions: z.number().int(),
    unitPrice: z.string(),
    discountPct: z.string(),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('QuoteItem');

export const createQuoteItemSchema = z
  .object({
    procedureId: z.string().uuid('procedureId inválido'),
    quantitySessions: z.number().int().min(1).max(999),
    unitPrice: moneySchema,
    discountPct: percentSchema.default(0),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .openapi('CreateQuoteItemInput');

export type CreateQuoteItemInput = z.infer<typeof createQuoteItemSchema>;

export const updateQuoteItemSchema = z
  .object({
    quantitySessions: z.number().int().min(1).max(999).optional(),
    unitPrice: moneySchema.optional(),
    discountPct: percentSchema.optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateQuoteItemInput');

export type UpdateQuoteItemInput = z.infer<typeof updateQuoteItemSchema>;

export const quoteItemIdParamSchema = z.object({
  id: z.string().uuid('ID do quote inválido'),
  itemId: z.string().uuid('ID do item inválido'),
});

export type QuoteItemIdParam = z.infer<typeof quoteItemIdParamSchema>;

// =====================================================================
// Operações dedicadas
// =====================================================================

// Input do fechamento — define em SalesTypes.ts (módulo dono da entidade
// sale). Re-export aqui pra preservar a API histórica do módulo quotes.
export { closeSaleInputSchema as closeSaleSchema } from '../sales/SalesTypes.js';
export type { CloseSaleInput } from '../sales/SalesTypes.js';
