import { withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import {
  CashierQuery,
  type CashierEntryRow,
  type CashierSummaryRow,
} from './CashierQuery.js';
import type {
  CashierSummaryQuery,
  FindCashierEntriesQuery,
} from './CashierTypes.js';

// Resolve range default = dia corrente (00:00 → 23:59:59.999 do servidor).
// Filtragem usa timestamp UTC do `paid_at`, então "hoje" reflete o calendário
// do servidor — não do navegador. Frontend pode passar `from`/`to` explícitos
// quando precisa de timezone do cliente.
function resolveRange(
  fromIso: string | undefined,
  toIso: string | undefined
): { from: Date; to: Date } {
  if (fromIso && toIso) {
    return { from: new Date(fromIso), to: new Date(toIso) };
  }
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const to = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    23,
    59,
    59,
    999
  );
  return {
    from: fromIso ? new Date(fromIso) : from,
    to: toIso ? new Date(toIso) : to,
  };
}

export const CashierService = {
  findEntries: async (
    tenantId: string,
    query: FindCashierEntriesQuery
  ): Promise<PaginatedResult<CashierEntryRow>> => {
    return withTenant(db, tenantId, async (tx) => {
      const { from, to } = resolveRange(query.from, query.to);
      const { items, total } = await CashierQuery.findEntriesPaginated(
        tx,
        {
          from,
          to,
          paymentMethod: query.paymentMethod,
          clientId: query.clientId,
          q: query.q,
        },
        { page: query.page, pageSize: query.pageSize }
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

  summary: async (
    tenantId: string,
    query: CashierSummaryQuery
  ): Promise<{
    from: string;
    to: string;
    totalAmount: string;
    totalCount: number;
    byMethod: CashierSummaryRow[];
  }> => {
    return withTenant(db, tenantId, async (tx) => {
      const { from, to } = resolveRange(query.from, query.to);
      const result = await CashierQuery.summarize(tx, { from, to });
      return {
        from: from.toISOString(),
        to: to.toISOString(),
        ...result,
      };
    });
  },
};
