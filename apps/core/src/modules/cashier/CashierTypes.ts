import { z } from '../../shared/openapi/registry.js';
import { paymentMethodValues } from '../sales/SalesTypes.js';

// Caixa = view operacional dos `payments` com status='paid'. Não há entidade
// "cashier_session" no MVP — fechamento de caixa virá em iteração futura
// (consolidação por turno, sangria, conferência). Hoje a página só exibe.

// =====================================================================
// Entries (lista paginada)
// =====================================================================

export const cashierEntrySchema = z
  .object({
    paymentId: z.string().uuid(),
    saleId: z.string().uuid(),
    clientId: z.string().uuid(),
    clientName: z.string(),
    clientPhoneE164: z.string(),
    paidAt: z.string().datetime(),
    amount: z.string(),
    paymentMethod: z.enum(paymentMethodValues),
    installmentNumber: z.number().int(),
    totalInstallments: z.number().int(),
  })
  .openapi('CashierEntry');

export const findCashierEntriesQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    // Range de recebimento (paid_at). Default no controller = hoje 00:00 → 23:59.
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    paymentMethod: z.enum(paymentMethodValues).optional(),
    clientId: z.string().uuid().optional(),
    // Busca textual em client.name + client.phone_e164.
    q: z.string().trim().min(1).max(120).optional(),
  })
  .openapi('FindCashierEntriesQuery');

export type FindCashierEntriesQuery = z.infer<typeof findCashierEntriesQuerySchema>;

// =====================================================================
// Summary (agregado por método de pagamento)
// =====================================================================

export const cashierSummaryItemSchema = z
  .object({
    paymentMethod: z.enum(paymentMethodValues),
    count: z.number().int(),
    total: z.string(),
  })
  .openapi('CashierSummaryItem');

export const cashierSummarySchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    totalAmount: z.string(),
    totalCount: z.number().int(),
    byMethod: z.array(cashierSummaryItemSchema),
  })
  .openapi('CashierSummary');

export const cashierSummaryQuerySchema = z
  .object({
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  })
  .openapi('CashierSummaryQuery');

export type CashierSummaryQuery = z.infer<typeof cashierSummaryQuerySchema>;
