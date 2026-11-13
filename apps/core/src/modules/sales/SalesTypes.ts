import {
  payments,
  saleItems,
  sales,
  type InferSelectModel,
} from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type Sale = InferSelectModel<typeof sales>;
export type SaleItem = InferSelectModel<typeof saleItems>;
export type Payment = InferSelectModel<typeof payments>;

export const salesSortSpec = createSortSpec(
  {
    createdAt: sales.createdAt,
    closedAt: sales.closedAt,
    totalAmount: sales.totalAmount,
    paidAmount: sales.paidAmount,
  },
  { field: 'closedAt', direction: 'desc' }
);

export const saleStatusValues = ['open', 'paid', 'cancelled'] as const;
export const paymentStatusValues = ['pending', 'paid', 'cancelled'] as const;

// Fonte da verdade de método de pagamento — espelha `payment_method_enum` em
// schema.ts. Quotes/QuotesTypes re-exporta daqui pra não duplicar.
export const paymentMethodValues = [
  'pix',
  'credit_card',
  'debit_card',
  'cash',
  'bank_transfer',
  'other',
] as const;

const moneySchema = z
  .number()
  .nonnegative('Valor não pode ser negativo')
  .max(9_999_999_999.99)
  .refine((v) => Math.round(v * 100) === v * 100, {
    message: 'Valor deve ter no máximo 2 casas decimais',
  });

// =====================================================================
// Sale
// =====================================================================

export const saleResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    quoteId: z.string().uuid(),
    journeyId: z.string().uuid(),
    clientId: z.string().uuid(),
    subtotalAmount: z.string(),
    discountAmount: z.string(),
    totalAmount: z.string(),
    paidAmount: z.string(),
    status: z.enum(saleStatusValues),
    closedAt: z.string().datetime(),
    closedByUserId: z.string().uuid().nullable(),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Sale');

export const saleItemResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    saleId: z.string().uuid(),
    quoteItemId: z.string().uuid().nullable(),
    procedureId: z.string().uuid(),
    quantitySessions: z.number().int(),
    unitPrice: z.string(),
    discountPct: z.string(),
    computedAmount: z.string(),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('SaleItem');

export const paymentResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    saleId: z.string().uuid(),
    installmentNumber: z.number().int(),
    totalInstallments: z.number().int(),
    amount: z.string(),
    paymentMethod: z.enum(paymentMethodValues),
    dueDate: z.string(),
    paidAt: z.string().datetime().nullable(),
    status: z.enum(paymentStatusValues),
    notes: z.string().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Payment');

// Listagem em /sales — junta dados do cliente sem N+1.
export const saleListItemSchema = saleResponseSchema
  .extend({
    clientName: z.string(),
    clientPhoneE164: z.string(),
    pendingInstallments: z.number().int(),
    overdueInstallments: z.number().int(),
  })
  .openapi('SaleListItem');

export const saleWithDetailsSchema = z
  .object({
    sale: saleResponseSchema,
    items: z.array(saleItemResponseSchema),
    payments: z.array(paymentResponseSchema),
  })
  .openapi('SaleWithDetails');

export const findSalesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    clientId: z.string().uuid().optional(),
    journeyId: z.string().uuid().optional(),
    status: z.enum(saleStatusValues).optional(),
    closedFrom: z.string().datetime().optional(),
    closedTo: z.string().datetime().optional(),
    q: z.string().trim().min(1).max(120).optional(),
  })
  .merge(sortQuerySchema(salesSortSpec))
  .openapi('FindSalesQuery');

export type FindSalesQuery = z.infer<typeof findSalesQuerySchema>;

export const saleIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

export type SaleIdParam = z.infer<typeof saleIdParamSchema>;

// =====================================================================
// Close sale (input do POST /quotes/:id/close-sale)
// =====================================================================

// Parcela na criação. dueDate é date-only (YYYY-MM-DD); paidAt opcional pra
// permitir registrar parcela já recebida na hora do fechamento (à vista).
const paymentInputSchema = z
  .object({
    amount: moneySchema,
    paymentMethod: z.enum(paymentMethodValues),
    // Aceita 'YYYY-MM-DD'. Coerce pra string ISO pra evitar inferência confusa.
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD)'),
    paidAt: z.string().datetime().nullable().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .openapi('PaymentInput');

export const closeSaleInputSchema = z
  .object({
    // IDs dos quote_items que entram na venda. Pelo menos 1; service valida
    // que todos pertencem ao quote alvo. Items não listados ficam só no
    // histórico do quote (sem contrapartida em sale_items).
    selectedItemIds: z
      .array(z.string().uuid())
      .min(1, 'Selecione pelo menos um item'),
    // Desconto específico desta venda (pode diferir do quote.discountAmount).
    // Default 0; backend valida que ≤ subtotal computado.
    discountAmount: moneySchema.default(0),
    // 1+ parcelas. Service valida que sum(amount) == subtotal - discount.
    payments: z.array(paymentInputSchema).min(1, 'Adicione pelo menos uma parcela'),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .openapi('CloseSaleInput');

export type CloseSaleInput = z.infer<typeof closeSaleInputSchema>;

// =====================================================================
// Payments (operações em parcela individual)
// =====================================================================

export const paymentIdParamSchema = z.object({
  id: z.string().uuid('ID da venda inválido'),
  paymentId: z.string().uuid('ID da parcela inválido'),
});

export type PaymentIdParam = z.infer<typeof paymentIdParamSchema>;

export const markPaymentPaidSchema = z
  .object({
    paidAt: z.string().datetime().optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .openapi('MarkPaymentPaidInput');

export type MarkPaymentPaidInput = z.infer<typeof markPaymentPaidSchema>;

export const updatePaymentSchema = z
  .object({
    amount: moneySchema.optional(),
    paymentMethod: z.enum(paymentMethodValues).optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida (use YYYY-MM-DD)')
      .optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdatePaymentInput');

export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;
