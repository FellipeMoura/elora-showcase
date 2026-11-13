import {
  and,
  asc,
  clients,
  eq,
  journeys,
  quoteItems,
  quotes,
  sales,
  searchInColumns,
  sql,
  type SQL,
  type Tx,
} from '@elora/db';
import type {
  Quote,
  QuoteItem,
} from './QuotesTypes.js';

// Row da listagem: Drizzle row (Date nas colunas) + join com client. Express
// serializa Date→ISO no res.json; o tipo de wire (`QuoteListItem` em
// QuotesTypes) descreve só o que chega no cliente. Mesma "mentira benigna"
// do `Quote` puro, mantida intencionalmente — sem conversão na camada query.
//
// sale* são nullable pra cobrir quote sem venda fechada. Relação 1:1
// (sales.quote_id é unique na prática — não há reabertura). Trazidos via
// LEFT JOIN pra que a listagem mostre o valor da venda (potencialmente !=
// do quote, devido a items "perdidos" no fechamento) sem segundo round-trip.
export type QuoteListItemRow = Quote & {
  clientId: string;
  clientName: string;
  clientPhoneE164: string;
  saleId: string | null;
  saleTotalAmount: string | null;
  saleClosedAt: Date | null;
};

interface FindFilters {
  journeyId?: string;
  // Histórico de vendas do cliente — agrega quotes de todas as journeys
  // (atual e fechadas). Filtra direto em journeys.clientId via inner join.
  clientId?: string;
  status?:
    | 'draft'
    | 'sent'
    | 'accepted'
    | 'rejected'
    | 'expired';
  origin?: 'evaluation' | 'referral' | 'direct_sale';
  // Busca textual em client.name + client.phone_e164.
  q?: string;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateQuoteInput {
  journeyId: string;
  origin: 'evaluation' | 'referral' | 'direct_sale';
  discountAmount: number;
  validUntil?: Date | null;
  notes?: string | null;
  createdByUserId?: string | null;
}

interface UpdateQuotePatch {
  discountAmount?: number;
  validUntil?: Date | null;
  notes?: string | null;
  totalAmount?: number;
  status?: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  // sentAt aceita `null` pra cobrir reversão `sent → draft` (revertToDraft).
  // acceptedAt/rejectedAt seguem só-set porque uma vez terminal não revertem.
  sentAt?: Date | null;
  acceptedAt?: Date;
  rejectedAt?: Date;
}

interface CreateItemInput {
  procedureId: string;
  quantitySessions: number;
  unitPrice: number;
  discountPct: number;
  notes?: string | null;
}

interface UpdateItemPatch {
  quantitySessions?: number;
  unitPrice?: number;
  discountPct?: number;
  notes?: string | null;
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

export const QuotesQuery = {
  // Quotes ------------------------------------------------------------

  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: QuoteListItemRow[]; total: number }> => {
    const where = and(
      filters.journeyId ? eq(quotes.journeyId, filters.journeyId) : undefined,
      filters.clientId ? eq(journeys.clientId, filters.clientId) : undefined,
      filters.status ? eq(quotes.status, filters.status) : undefined,
      filters.origin ? eq(quotes.origin, filters.origin) : undefined,
      // Busca casa nome OU telefone — operadora digita um dos dois.
      searchInColumns(filters.q, clients.name, clients.phoneE164),
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    // Inner join é seguro: quote.journey_id e journey.client_id são NOT NULL.
    // LEFT JOIN com sales pra trazer a venda fechada (1:1) quando houver —
    // colunas vêm null pra quotes sem fechamento.
    const items = await tx
      .select({
        id: quotes.id,
        tenantId: quotes.tenantId,
        journeyId: quotes.journeyId,
        origin: quotes.origin,
        totalAmount: quotes.totalAmount,
        discountAmount: quotes.discountAmount,
        status: quotes.status,
        validUntil: quotes.validUntil,
        notes: quotes.notes,
        createdByUserId: quotes.createdByUserId,
        sentAt: quotes.sentAt,
        acceptedAt: quotes.acceptedAt,
        rejectedAt: quotes.rejectedAt,
        createdAt: quotes.createdAt,
        updatedAt: quotes.updatedAt,
        clientId: clients.id,
        clientName: clients.name,
        clientPhoneE164: clients.phoneE164,
        saleId: sales.id,
        saleTotalAmount: sales.totalAmount,
        saleClosedAt: sales.closedAt,
      })
      .from(quotes)
      .innerJoin(journeys, eq(journeys.id, quotes.journeyId))
      .innerJoin(clients, eq(clients.id, journeys.clientId))
      .leftJoin(sales, eq(sales.quoteId, quotes.id))
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(quotes)
      .innerJoin(journeys, eq(journeys.id, quotes.journeyId))
      .innerJoin(clients, eq(clients.id, journeys.clientId))
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<Quote | undefined> => {
    const [row] = await tx
      .select()
      .from(quotes)
      .where(eq(quotes.id, id))
      .limit(1);
    return row;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateQuoteInput
  ): Promise<Quote> => {
    const [row] = await tx
      .insert(quotes)
      .values({
        tenantId,
        journeyId: input.journeyId,
        origin: input.origin,
        totalAmount: '0',
        discountAmount: moneyToString(input.discountAmount) ?? '0',
        status: 'draft',
        validUntil: input.validUntil ?? null,
        notes: input.notes ?? null,
        createdByUserId: input.createdByUserId ?? null,
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir quote');
    return row;
  },

  update: async (
    tx: Tx,
    id: string,
    patch: UpdateQuotePatch
  ): Promise<Quote | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.discountAmount !== undefined) set.discountAmount = moneyToString(patch.discountAmount);
    if (patch.validUntil !== undefined) set.validUntil = patch.validUntil;
    if (patch.notes !== undefined) set.notes = patch.notes;
    if (patch.totalAmount !== undefined) set.totalAmount = moneyToString(patch.totalAmount);
    if (patch.status !== undefined) set.status = patch.status;
    if (patch.sentAt !== undefined) set.sentAt = patch.sentAt;
    if (patch.acceptedAt !== undefined) set.acceptedAt = patch.acceptedAt;
    if (patch.rejectedAt !== undefined) set.rejectedAt = patch.rejectedAt;

    const [row] = await tx
      .update(quotes)
      .set(set)
      .where(eq(quotes.id, id))
      .returning();
    return row;
  },

  delete: async (tx: Tx, id: string): Promise<boolean> => {
    const deleted = await tx
      .delete(quotes)
      .where(eq(quotes.id, id))
      .returning({ id: quotes.id });
    return deleted.length > 0;
  },

  // Items -------------------------------------------------------------

  findItemsByQuote: async (
    tx: Tx,
    quoteId: string
  ): Promise<QuoteItem[]> => {
    return tx
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, quoteId))
      .orderBy(asc(quoteItems.createdAt));
  },

  findItemById: async (
    tx: Tx,
    itemId: string
  ): Promise<QuoteItem | undefined> => {
    const [row] = await tx
      .select()
      .from(quoteItems)
      .where(eq(quoteItems.id, itemId))
      .limit(1);
    return row;
  },

  createItem: async (
    tx: Tx,
    tenantId: string,
    quoteId: string,
    input: CreateItemInput
  ): Promise<QuoteItem> => {
    const [row] = await tx
      .insert(quoteItems)
      .values({
        tenantId,
        quoteId,
        procedureId: input.procedureId,
        quantitySessions: input.quantitySessions,
        unitPrice: moneyToString(input.unitPrice) ?? '0',
        discountPct: percentToString(input.discountPct) ?? '0',
        notes: input.notes ?? null,
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir quote_item');
    return row;
  },

  updateItem: async (
    tx: Tx,
    itemId: string,
    patch: UpdateItemPatch
  ): Promise<QuoteItem | undefined> => {
    const set: Record<string, unknown> = {};
    if (patch.quantitySessions !== undefined) set.quantitySessions = patch.quantitySessions;
    if (patch.unitPrice !== undefined) set.unitPrice = moneyToString(patch.unitPrice);
    if (patch.discountPct !== undefined) set.discountPct = percentToString(patch.discountPct);
    if (patch.notes !== undefined) set.notes = patch.notes;

    const [row] = await tx
      .update(quoteItems)
      .set(set)
      .where(eq(quoteItems.id, itemId))
      .returning();
    return row;
  },

  deleteItem: async (tx: Tx, itemId: string): Promise<boolean> => {
    const deleted = await tx
      .delete(quoteItems)
      .where(eq(quoteItems.id, itemId))
      .returning({ id: quoteItems.id });
    return deleted.length > 0;
  },

  // Cálculo de total --------------------------------------------------

  // totalAmount = sum(unitPrice * quantitySessions * (1 - discountPct/100))
  //               - discountAmount  (do quote)
  // Cálculo feito em SQL pra evitar drift entre client e server. Retorna o
  // novo total (pre-discountAmount); caller subtrai e atualiza quote.
  computeItemsTotal: async (tx: Tx, quoteId: string): Promise<number> => {
    const [row] = await tx
      .select({
        total: sql<string>`
          COALESCE(SUM(
            ${quoteItems.unitPrice}::numeric
            * ${quoteItems.quantitySessions}::numeric
            * (1 - ${quoteItems.discountPct}::numeric / 100)
          ), 0)::text
        `.as('total'),
      })
      .from(quoteItems)
      .where(eq(quoteItems.quoteId, quoteId));
    return Number(row?.total ?? '0');
  },

};
