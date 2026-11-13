import {
  and,
  asc,
  clients,
  eq,
  gte,
  inArray,
  lte,
  payments,
  procedureSessions,
  quoteItems,
  saleItems,
  sales,
  searchInColumns,
  sql,
  type SQL,
  type Tx,
} from '@elora/db';
import type {
  Payment,
  Sale,
  SaleItem,
} from './SalesTypes.js';

export type SaleListItemRow = Sale & {
  clientName: string;
  clientPhoneE164: string;
  pendingInstallments: number;
  overdueInstallments: number;
};

interface FindFilters {
  clientId?: string;
  journeyId?: string;
  status?: 'open' | 'paid' | 'cancelled';
  closedFrom?: Date;
  closedTo?: Date;
  q?: string;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateSaleInput {
  quoteId: string;
  journeyId: string;
  clientId: string;
  subtotalAmount: number;
  discountAmount: number;
  totalAmount: number;
  notes?: string | null;
  closedByUserId?: string | null;
}

interface CreateSaleItemInput {
  quoteItemId: string | null;
  procedureId: string;
  quantitySessions: number;
  unitPrice: number;
  discountPct: number;
  computedAmount: number;
  notes?: string | null;
}

interface CreatePaymentInput {
  installmentNumber: number;
  totalInstallments: number;
  amount: number;
  paymentMethod:
    | 'pix'
    | 'credit_card'
    | 'debit_card'
    | 'cash'
    | 'bank_transfer'
    | 'other';
  dueDate: string; // YYYY-MM-DD
  paidAt?: Date | null;
  status?: 'pending' | 'paid' | 'cancelled';
  notes?: string | null;
}

interface UpdatePaymentPatch {
  amount?: number;
  paymentMethod?:
    | 'pix'
    | 'credit_card'
    | 'debit_card'
    | 'cash'
    | 'bank_transfer'
    | 'other';
  dueDate?: string;
  paidAt?: Date | null;
  status?: 'pending' | 'paid' | 'cancelled';
  notes?: string | null;
}

interface CreateSessionsBulkInput {
  clientId: string;
  procedureId: string;
  saleItemId: string;
  count: number;
}

function moneyToString(v: number | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return v.toFixed(2);
}

function percentToString(v: number | undefined): string | undefined {
  if (v === undefined) return undefined;
  return v.toFixed(2);
}

export const SalesQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: SaleListItemRow[]; total: number }> => {
    const where = and(
      filters.clientId ? eq(sales.clientId, filters.clientId) : undefined,
      filters.journeyId ? eq(sales.journeyId, filters.journeyId) : undefined,
      filters.status ? eq(sales.status, filters.status) : undefined,
      filters.closedFrom ? gte(sales.closedAt, filters.closedFrom) : undefined,
      filters.closedTo ? lte(sales.closedAt, filters.closedTo) : undefined,
      searchInColumns(filters.q, clients.name, clients.phoneE164),
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    // Subquery agregando counts de parcelas por status — evita N+1 na lista.
    // `current_date` pra overdue (parcela pending com due_date no passado).
    const items = await tx
      .select({
        id: sales.id,
        tenantId: sales.tenantId,
        quoteId: sales.quoteId,
        journeyId: sales.journeyId,
        clientId: sales.clientId,
        subtotalAmount: sales.subtotalAmount,
        discountAmount: sales.discountAmount,
        totalAmount: sales.totalAmount,
        paidAmount: sales.paidAmount,
        status: sales.status,
        closedAt: sales.closedAt,
        closedByUserId: sales.closedByUserId,
        notes: sales.notes,
        createdAt: sales.createdAt,
        updatedAt: sales.updatedAt,
        clientName: clients.name,
        clientPhoneE164: clients.phoneE164,
        pendingInstallments: sql<number>`(
          SELECT COUNT(*)::int FROM payments p
          WHERE p.sale_id = ${sales.id} AND p.status = 'pending'
        )`.as('pending_installments'),
        overdueInstallments: sql<number>`(
          SELECT COUNT(*)::int FROM payments p
          WHERE p.sale_id = ${sales.id}
            AND p.status = 'pending'
            AND p.due_date < CURRENT_DATE
        )`.as('overdue_installments'),
      })
      .from(sales)
      .innerJoin(clients, eq(clients.id, sales.clientId))
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(sales)
      .innerJoin(clients, eq(clients.id, sales.clientId))
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<Sale | undefined> => {
    const [row] = await tx
      .select()
      .from(sales)
      .where(eq(sales.id, id))
      .limit(1);
    return row;
  },

  findItemsBySale: async (tx: Tx, saleId: string): Promise<SaleItem[]> => {
    return tx
      .select()
      .from(saleItems)
      .where(eq(saleItems.saleId, saleId))
      .orderBy(asc(saleItems.createdAt));
  },

  findPaymentsBySale: async (tx: Tx, saleId: string): Promise<Payment[]> => {
    return tx
      .select()
      .from(payments)
      .where(eq(payments.saleId, saleId))
      .orderBy(asc(payments.installmentNumber));
  },

  findPaymentById: async (
    tx: Tx,
    paymentId: string
  ): Promise<Payment | undefined> => {
    const [row] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .limit(1);
    return row;
  },

  createSale: async (
    tx: Tx,
    tenantId: string,
    input: CreateSaleInput
  ): Promise<Sale> => {
    const [row] = await tx
      .insert(sales)
      .values({
        tenantId,
        quoteId: input.quoteId,
        journeyId: input.journeyId,
        clientId: input.clientId,
        subtotalAmount: moneyToString(input.subtotalAmount) ?? '0',
        discountAmount: moneyToString(input.discountAmount) ?? '0',
        totalAmount: moneyToString(input.totalAmount) ?? '0',
        paidAmount: '0',
        status: 'open',
        notes: input.notes ?? null,
        closedByUserId: input.closedByUserId ?? null,
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir sale');
    return row;
  },

  createSaleItemsBulk: async (
    tx: Tx,
    tenantId: string,
    saleId: string,
    inputs: CreateSaleItemInput[]
  ): Promise<SaleItem[]> => {
    if (inputs.length === 0) return [];
    const rows = inputs.map((it) => ({
      tenantId,
      saleId,
      quoteItemId: it.quoteItemId,
      procedureId: it.procedureId,
      quantitySessions: it.quantitySessions,
      unitPrice: moneyToString(it.unitPrice) ?? '0',
      discountPct: percentToString(it.discountPct) ?? '0',
      computedAmount: moneyToString(it.computedAmount) ?? '0',
      notes: it.notes ?? null,
    }));
    return tx.insert(saleItems).values(rows).returning();
  },

  createPaymentsBulk: async (
    tx: Tx,
    tenantId: string,
    saleId: string,
    inputs: CreatePaymentInput[]
  ): Promise<Payment[]> => {
    if (inputs.length === 0) return [];
    const rows = inputs.map((p) => ({
      tenantId,
      saleId,
      installmentNumber: p.installmentNumber,
      totalInstallments: p.totalInstallments,
      amount: moneyToString(p.amount) ?? '0',
      paymentMethod: p.paymentMethod,
      dueDate: p.dueDate,
      paidAt: p.paidAt ?? null,
      status: p.status ?? 'pending',
      notes: p.notes ?? null,
    }));
    return tx.insert(payments).values(rows).returning();
  },

  // Cria N procedure_sessions (1 por sessão prescrita) já linkadas ao sale_item.
  createProcedureSessionsBulk: async (
    tx: Tx,
    tenantId: string,
    inputs: CreateSessionsBulkInput[]
  ): Promise<string[]> => {
    if (inputs.length === 0) return [];
    const rows: Array<{
      tenantId: string;
      clientId: string;
      procedureId: string;
      saleItemId: string;
      status: 'pending';
    }> = [];
    for (const input of inputs) {
      for (let i = 0; i < input.count; i++) {
        rows.push({
          tenantId,
          clientId: input.clientId,
          procedureId: input.procedureId,
          saleItemId: input.saleItemId,
          status: 'pending',
        });
      }
    }
    const inserted = await tx
      .insert(procedureSessions)
      .values(rows)
      .returning({ id: procedureSessions.id });
    return inserted.map((r) => r.id);
  },

  updatePayment: async (
    tx: Tx,
    paymentId: string,
    patch: UpdatePaymentPatch
  ): Promise<Payment | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.amount !== undefined) set.amount = moneyToString(patch.amount);
    if (patch.paymentMethod !== undefined) set.paymentMethod = patch.paymentMethod;
    if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
    if (patch.paidAt !== undefined) set.paidAt = patch.paidAt;
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.notes !== undefined) set.notes = patch.notes;

    const [row] = await tx
      .update(payments)
      .set(set)
      .where(eq(payments.id, paymentId))
      .returning();
    return row;
  },

  // Recompute paid_amount + status da sale baseado nas parcelas.
  // Sale vira 'paid' quando todas parcelas têm status='paid'. 'open' caso
  // contrário. 'cancelled' só por ação explícita (não muda aqui).
  recomputeSaleStatus: async (
    tx: Tx,
    saleId: string
  ): Promise<Sale | undefined> => {
    const allPayments = await tx
      .select({
        amount: payments.amount,
        status: payments.status,
      })
      .from(payments)
      .where(eq(payments.saleId, saleId));

    let paidAmount = 0;
    let hasPending = false;
    for (const p of allPayments) {
      if (p.status === 'paid') paidAmount += Number(p.amount);
      else if (p.status === 'pending') hasPending = true;
    }

    // Lê status atual pra não sobrescrever 'cancelled'.
    const current = await tx
      .select({ status: sales.status })
      .from(sales)
      .where(eq(sales.id, saleId))
      .limit(1);
    const currentStatus = current[0]?.status;
    let nextStatus: 'open' | 'paid' | 'cancelled' = 'open';
    if (currentStatus === 'cancelled') {
      nextStatus = 'cancelled';
    } else if (!hasPending && allPayments.length > 0) {
      nextStatus = 'paid';
    }

    const [row] = await tx
      .update(sales)
      .set({
        paidAmount: paidAmount.toFixed(2),
        status: nextStatus,
      })
      .where(eq(sales.id, saleId))
      .returning();
    return row;
  },

  // Helper de validação: confere se IDs dos quote_items pertencem ao quote.
  validateQuoteItemIds: async (
    tx: Tx,
    quoteId: string,
    itemIds: string[]
  ): Promise<{ id: string; quoteId: string }[]> => {
    if (itemIds.length === 0) return [];
    return tx
      .select({ id: quoteItems.id, quoteId: quoteItems.quoteId })
      .from(quoteItems)
      .where(
        and(eq(quoteItems.quoteId, quoteId), inArray(quoteItems.id, itemIds))
      );
  },
};
