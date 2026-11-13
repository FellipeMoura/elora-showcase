import {
  and,
  asc,
  clients,
  desc,
  eq,
  gte,
  isNotNull,
  lte,
  payments,
  sales,
  searchInColumns,
  sql,
  type Tx,
} from '@elora/db';

export interface CashierEntryRow {
  paymentId: string;
  saleId: string;
  clientId: string;
  clientName: string;
  clientPhoneE164: string;
  paidAt: Date;
  amount: string;
  paymentMethod:
    | 'pix'
    | 'credit_card'
    | 'debit_card'
    | 'cash'
    | 'bank_transfer'
    | 'other';
  installmentNumber: number;
  totalInstallments: number;
}

interface EntryFilters {
  from?: Date;
  to?: Date;
  paymentMethod?:
    | 'pix'
    | 'credit_card'
    | 'debit_card'
    | 'cash'
    | 'bank_transfer'
    | 'other';
  clientId?: string;
  q?: string;
}

interface Pagination {
  page: number;
  pageSize: number;
}

export interface CashierSummaryRow {
  paymentMethod:
    | 'pix'
    | 'credit_card'
    | 'debit_card'
    | 'cash'
    | 'bank_transfer'
    | 'other';
  count: number;
  total: string;
}

// Filtro base usado por entries e summary. status='paid' + paid_at NOT NULL
// pra excluir registros corrompidos (paid_at deveria sempre estar preenchido
// quando status=paid, mas o guard é barato).
function baseEntryWhere(filters: EntryFilters) {
  return and(
    eq(payments.status, 'paid'),
    isNotNull(payments.paidAt),
    filters.from ? gte(payments.paidAt, filters.from) : undefined,
    filters.to ? lte(payments.paidAt, filters.to) : undefined,
    filters.paymentMethod
      ? eq(payments.paymentMethod, filters.paymentMethod)
      : undefined,
    filters.clientId ? eq(sales.clientId, filters.clientId) : undefined,
    searchInColumns(filters.q, clients.name, clients.phoneE164),
  );
}

export const CashierQuery = {
  findEntriesPaginated: async (
    tx: Tx,
    filters: EntryFilters,
    pagination: Pagination
  ): Promise<{ items: CashierEntryRow[]; total: number }> => {
    const where = baseEntryWhere(filters);
    const offset = (pagination.page - 1) * pagination.pageSize;

    // ORDER por paid_at DESC pra ver as entradas mais recentes no topo —
    // padrão de caixa. Tiebreaker por payment.id pra estabilidade.
    const items = await tx
      .select({
        paymentId: payments.id,
        saleId: sales.id,
        clientId: clients.id,
        clientName: clients.name,
        clientPhoneE164: clients.phoneE164,
        paidAt: payments.paidAt,
        amount: payments.amount,
        paymentMethod: payments.paymentMethod,
        installmentNumber: payments.installmentNumber,
        totalInstallments: payments.totalInstallments,
      })
      .from(payments)
      .innerJoin(sales, eq(sales.id, payments.saleId))
      .innerJoin(clients, eq(clients.id, sales.clientId))
      .where(where)
      .orderBy(desc(payments.paidAt), asc(payments.id))
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(payments)
      .innerJoin(sales, eq(sales.id, payments.saleId))
      .innerJoin(clients, eq(clients.id, sales.clientId))
      .where(where);

    // paid_at é NOT NULL por filtro — cast seguro pro Date.
    return {
      items: items as CashierEntryRow[],
      total: totalRow?.count ?? 0,
    };
  },

  // Agrega total recebido por método no range. Não pagina — n linhas = n
  // métodos (máx 6). Frontend monta cards a partir disso.
  summarize: async (
    tx: Tx,
    filters: Pick<EntryFilters, 'from' | 'to'>
  ): Promise<{
    totalAmount: string;
    totalCount: number;
    byMethod: CashierSummaryRow[];
  }> => {
    const where = baseEntryWhere(filters);

    const byMethod = await tx
      .select({
        paymentMethod: payments.paymentMethod,
        count: sql<number>`count(*)::int`.as('count'),
        total: sql<string>`COALESCE(SUM(${payments.amount}::numeric), 0)::text`.as(
          'total'
        ),
      })
      .from(payments)
      .innerJoin(sales, eq(sales.id, payments.saleId))
      .innerJoin(clients, eq(clients.id, sales.clientId))
      .where(where)
      .groupBy(payments.paymentMethod)
      .orderBy(desc(sql`SUM(${payments.amount}::numeric)`));

    const totalAmount = byMethod
      .reduce((sum, row) => sum + Number(row.total), 0)
      .toFixed(2);
    const totalCount = byMethod.reduce((sum, row) => sum + row.count, 0);

    return {
      totalAmount,
      totalCount,
      byMethod: byMethod as CashierSummaryRow[],
    };
  },
};
