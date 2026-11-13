import { withTenant, type Tx } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import { QuotesQuery } from '../quotes/QuotesQuery.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { SalesQuery, type SaleListItemRow } from './SalesQuery.js';
import { salesSortSpec } from './SalesTypes.js';
import type {
  CloseSaleInput,
  FindSalesQuery,
  MarkPaymentPaidInput,
  Payment,
  Sale,
  SaleItem,
  UpdatePaymentInput,
} from './SalesTypes.js';

// Tudo em centavos pra evitar floating point drift na validação. Money entra
// como number (ex: 1234.56) e converte pra inteiro multiplicando por 100.
function toCents(v: number | string): number {
  return Math.round(Number(v) * 100);
}

export interface CreateFromQuoteResult {
  sale: Sale;
  items: SaleItem[];
  payments: Payment[];
  procedureSessionIds: string[];
}

export const SalesService = {
  // Listagem -----------------------------------------------------------

  find: async (
    tenantId: string,
    query: FindSalesQuery
  ): Promise<PaginatedResult<SaleListItemRow>> => {
    return withTenant(db, tenantId, async (tx) => {
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        salesSortSpec
      );
      const { items, total } = await SalesQuery.findPaginated(
        tx,
        {
          clientId: query.clientId,
          journeyId: query.journeyId,
          status: query.status,
          closedFrom: query.closedFrom ? new Date(query.closedFrom) : undefined,
          closedTo: query.closedTo ? new Date(query.closedTo) : undefined,
          q: query.q,
        },
        { page: query.page, pageSize: query.pageSize },
        orderBy
      );
      return {
        items,
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: totalPagesOf(total, query.pageSize),
      };
    });
  },

  findById: async (
    tenantId: string,
    id: string
  ): Promise<{ sale: Sale; items: SaleItem[]; payments: Payment[] }> => {
    return withTenant(db, tenantId, async (tx) => {
      const sale = await SalesQuery.findById(tx, id);
      if (!sale) throw new AppError('Venda não encontrada', 404);
      const items = await SalesQuery.findItemsBySale(tx, id);
      const paymentList = await SalesQuery.findPaymentsBySale(tx, id);
      return { sale, items, payments: paymentList };
    });
  },

  // Fechamento (chamado por QuotesService.closeSale) ------------------
  //
  // Recebe Tx existente — opera dentro da transação maior do quote pra
  // garantir atomicidade entre quote status, sale, sale_items, payments e
  // procedure_sessions. Caller (QuotesService) é responsável por:
  //   - resolver tenantId/quote/journey antes
  //   - atualizar quote.status = 'accepted' depois
  //   - aplicar stage transition + recordJourneyEvent
  // Retorna a sale + items + payments + procedureSessionIds.
  createFromQuote: async (
    tx: Tx,
    tenantId: string,
    args: {
      quoteId: string;
      journeyId: string;
      clientId: string;
      input: CloseSaleInput;
      actorUserId: string | null;
    }
  ): Promise<CreateFromQuoteResult> => {
    const { quoteId, journeyId, clientId, input, actorUserId } = args;

    // Pega items do quote e filtra os selecionados. Tudo bate em memória —
    // quote tipicamente tem poucos items (≤ 10).
    const quoteItems = await QuotesQuery.findItemsByQuote(tx, quoteId);
    const itemsById = new Map(quoteItems.map((it) => [it.id, it]));

    const missing = input.selectedItemIds.filter((id) => !itemsById.has(id));
    if (missing.length > 0) {
      throw new AppError(
        `Itens não pertencem ao orçamento: ${missing.join(', ')}`,
        400
      );
    }

    const selectedItems = input.selectedItemIds.map((id) => itemsById.get(id)!);

    // Computa subtotal em centavos pra evitar drift.
    const subtotalCents = selectedItems.reduce((sum, it) => {
      const unitC = toCents(it.unitPrice);
      const pctNum = Number(it.discountPct);
      const lineCents = Math.round(unitC * it.quantitySessions * (1 - pctNum / 100));
      return sum + lineCents;
    }, 0);

    const discountCents = toCents(input.discountAmount);
    if (discountCents > subtotalCents) {
      throw new AppError('Desconto excede o subtotal selecionado', 400);
    }
    const totalCents = subtotalCents - discountCents;

    // Valida sum(payments) == total (centavos, exato).
    const paymentsSumCents = input.payments.reduce(
      (sum, p) => sum + toCents(p.amount),
      0
    );
    if (paymentsSumCents !== totalCents) {
      throw new AppError(
        `Soma das parcelas (R$ ${(paymentsSumCents / 100).toFixed(2)}) ` +
          `diverge do total (R$ ${(totalCents / 100).toFixed(2)})`,
        400
      );
    }

    // Cria sale.
    const sale = await SalesQuery.createSale(tx, tenantId, {
      quoteId,
      journeyId,
      clientId,
      subtotalAmount: subtotalCents / 100,
      discountAmount: discountCents / 100,
      totalAmount: totalCents / 100,
      notes: input.notes ?? null,
      closedByUserId: actorUserId,
    });

    // Cria sale_items (snapshot dos quote_items selecionados).
    const saleItemInputs = selectedItems.map((it) => {
      const unitC = toCents(it.unitPrice);
      const pctNum = Number(it.discountPct);
      const computedCents = Math.round(
        unitC * it.quantitySessions * (1 - pctNum / 100)
      );
      return {
        quoteItemId: it.id,
        procedureId: it.procedureId,
        quantitySessions: it.quantitySessions,
        unitPrice: Number(it.unitPrice),
        discountPct: Number(it.discountPct),
        computedAmount: computedCents / 100,
        notes: it.notes,
      };
    });
    const saleItems = await SalesQuery.createSaleItemsBulk(
      tx,
      tenantId,
      sale.id,
      saleItemInputs
    );

    // Cria payments (parcelas).
    const total = input.payments.length;
    const paymentInputs = input.payments.map((p, idx) => ({
      installmentNumber: idx + 1,
      totalInstallments: total,
      amount: p.amount,
      paymentMethod: p.paymentMethod,
      dueDate: p.dueDate,
      paidAt: p.paidAt ? new Date(p.paidAt) : null,
      status: (p.paidAt ? 'paid' : 'pending') as 'paid' | 'pending',
      notes: p.notes ?? null,
    }));
    const createdPayments = await SalesQuery.createPaymentsBulk(
      tx,
      tenantId,
      sale.id,
      paymentInputs
    );

    // Cria procedure_sessions (1 por sessão prescrita), linkadas ao sale_item.
    const sessionInputs = saleItems.map((si) => ({
      clientId,
      procedureId: si.procedureId,
      saleItemId: si.id,
      count: si.quantitySessions,
    }));
    const procedureSessionIds = await SalesQuery.createProcedureSessionsBulk(
      tx,
      tenantId,
      sessionInputs
    );

    // Recompute status caso já tenha parcela paga (ex: "à vista PIX").
    const updatedSale = await SalesQuery.recomputeSaleStatus(tx, sale.id);

    return {
      sale: updatedSale ?? sale,
      items: saleItems,
      payments: createdPayments,
      procedureSessionIds,
    };
  },

  // Operações em parcela individual ------------------------------------

  markPaymentPaid: async (
    tenantId: string,
    saleId: string,
    paymentId: string,
    input: MarkPaymentPaidInput
  ): Promise<{ payment: Payment; sale: Sale }> => {
    return withTenant(db, tenantId, async (tx) => {
      const sale = await SalesQuery.findById(tx, saleId);
      if (!sale) throw new AppError('Venda não encontrada', 404);

      const payment = await SalesQuery.findPaymentById(tx, paymentId);
      if (!payment) throw new AppError('Parcela não encontrada', 404);
      if (payment.saleId !== saleId) {
        throw new AppError('Parcela não pertence a esta venda', 404);
      }
      if (payment.status === 'paid') {
        throw new AppError('Parcela já está paga', 409);
      }
      if (payment.status === 'cancelled') {
        throw new AppError('Parcela cancelada — não pode ser marcada como paga', 409);
      }

      const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
      const updated = await SalesQuery.updatePayment(tx, paymentId, {
        status: 'paid',
        paidAt,
        notes: input.notes,
      });
      if (!updated) throw new AppError('Parcela não encontrada', 404);

      const refreshedSale = await SalesQuery.recomputeSaleStatus(tx, saleId);
      return { payment: updated, sale: refreshedSale ?? sale };
    });
  },

  updatePayment: async (
    tenantId: string,
    saleId: string,
    paymentId: string,
    input: UpdatePaymentInput
  ): Promise<{ payment: Payment; sale: Sale }> => {
    return withTenant(db, tenantId, async (tx) => {
      const sale = await SalesQuery.findById(tx, saleId);
      if (!sale) throw new AppError('Venda não encontrada', 404);

      const payment = await SalesQuery.findPaymentById(tx, paymentId);
      if (!payment) throw new AppError('Parcela não encontrada', 404);
      if (payment.saleId !== saleId) {
        throw new AppError('Parcela não pertence a esta venda', 404);
      }
      if (payment.status !== 'pending') {
        throw new AppError(
          `Edição só permitida em parcela pending (atual=${payment.status})`,
          409
        );
      }

      const updated = await SalesQuery.updatePayment(tx, paymentId, input);
      if (!updated) throw new AppError('Parcela não encontrada', 404);

      // Recompute pra manter paid_amount sincronizado caso amount mudou.
      const refreshedSale = await SalesQuery.recomputeSaleStatus(tx, saleId);
      return { payment: updated, sale: refreshedSale ?? sale };
    });
  },
};
