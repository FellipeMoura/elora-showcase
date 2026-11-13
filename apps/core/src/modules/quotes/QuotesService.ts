import {
  and,
  eq,
  inArray,
  procedures,
  quotes,
  recomputeLeadSubstage,
  sql,
  withTenant,
  type Tx,
} from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  recordJourneyEvent,
  touchJourneyActivity,
} from '../../shared/journeys/eventLogger.js';
import {
  applyStageTransition,
  markJourneyLost,
  type LostReason,
} from '../../shared/journeys/stageTransition.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { JourneysQuery } from '../journeys/JourneysQuery.js';
import { SalesService } from '../sales/SalesService.js';
import type { Payment, Sale, SaleItem } from '../sales/SalesTypes.js';
import { QuotesQuery, type QuoteListItemRow } from './QuotesQuery.js';
import { quotesSortSpec } from './QuotesTypes.js';
import type {
  CloseSaleInput,
  CreateQuoteInput,
  CreateQuoteItemInput,
  FindQuotesQuery,
  Quote,
  QuoteItem,
  UpdateQuoteInput,
  UpdateQuoteItemInput,
} from './QuotesTypes.js';

// Auto-lost da journey quando toda quote relevante foi fechada (chat-domain.md
// §5.3 ext.). Disparado por reject/expire — se restou pelo menos 1 quote ativo
// (status sent/accepted), não fecha. Se zero, marca journey como lost.
//
// Idempotente: se journey já está lost/won, no-op (não tenta sobrescrever).
// Caller passa o reason que vai pro `lostReason` da journey + payload do event.
async function autoLostIfAllQuotesClosed(
  tx: Tx,
  journeyId: string,
  reason: LostReason,
  actorUserId: string | null
): Promise<void> {
  // Existe ALGUM quote ainda vivo na journey? Se sim, não auto-lost.
  const [activeQuotes] = await tx
    .select({ count: sql<number>`count(*)::int`.as('count') })
    .from(quotes)
    .where(
      and(eq(quotes.journeyId, journeyId), inArray(quotes.status, ['sent', 'accepted']))
    );
  if (activeQuotes && activeQuotes.count > 0) return;

  // Checa status atual da journey — se já lost/won, no-op (markJourneyLost
  // throw AppError nesses casos, evitamos o ruído).
  const journey = await JourneysQuery.findById(tx, journeyId);
  if (!journey) return;
  if (journey.status !== 'active') return;

  await markJourneyLost(tx, journeyId, reason, actorUserId);
}

async function assertDraft(quote: Quote): Promise<void> {
  if (quote.status !== 'draft') {
    throw new AppError(
      `Operação só permitida em quote draft (atual=${quote.status})`,
      409
    );
  }
}

export const QuotesService = {
  // CRUD --------------------------------------------------------------

  find: async (
    tenantId: string,
    query: FindQuotesQuery
  ): Promise<PaginatedResult<QuoteListItemRow>> => {
    return withTenant(db, tenantId, async (tx) => {
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        quotesSortSpec
      );
      const { items, total } = await QuotesQuery.findPaginated(
        tx,
        {
          journeyId: query.journeyId,
          clientId: query.clientId,
          status: query.status,
          origin: query.origin,
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
  ): Promise<{ quote: Quote; items: QuoteItem[] }> => {
    return withTenant(db, tenantId, async (tx) => {
      const quote = await QuotesQuery.findById(tx, id);
      if (!quote) throw new AppError('Orçamento não encontrado', 404);
      const items = await QuotesQuery.findItemsByQuote(tx, id);
      return { quote, items };
    });
  },

  create: async (
    tenantId: string,
    input: CreateQuoteInput,
    actorUserId: string | null
  ): Promise<Quote> => {
    return withTenant(db, tenantId, async (tx) => {
      const journey = await JourneysQuery.findById(tx, input.journeyId);
      if (!journey) throw new AppError('Jornada não encontrada', 404);
      if (journey.status !== 'active') {
        throw new AppError('Jornada não está ativa', 409);
      }

      const created = await QuotesQuery.create(tx, tenantId, {
        journeyId: input.journeyId,
        origin: input.origin,
        discountAmount: input.discountAmount,
        validUntil: input.validUntil ? new Date(input.validUntil) : null,
        notes: input.notes,
        createdByUserId: actorUserId,
      });

      await recordJourneyEvent(tx, {
        tenantId,
        journeyId: journey.id,
        eventType: 'quote_created',
        payload: { quoteId: created.id, origin: created.origin },
        actorUserId,
      });
      await touchJourneyActivity(tx, journey.id);

      return created;
    });
  },

  update: async (
    tenantId: string,
    id: string,
    input: UpdateQuoteInput
  ): Promise<Quote> => {
    return withTenant(db, tenantId, async (tx) => {
      const current = await QuotesQuery.findById(tx, id);
      if (!current) throw new AppError('Orçamento não encontrado', 404);
      await assertDraft(current);

      const updated = await QuotesQuery.update(tx, id, {
        discountAmount: input.discountAmount,
        validUntil:
          input.validUntil === undefined
            ? undefined
            : input.validUntil === null
              ? null
              : new Date(input.validUntil),
        notes: input.notes,
      });
      if (!updated) throw new AppError('Orçamento não encontrado', 404);

      // Recompute totalAmount caso discountAmount mudou.
      if (input.discountAmount !== undefined) {
        await recomputeTotalInTx(tx, id, updated);
      }

      await touchJourneyActivity(tx, current.journeyId);
      return (await QuotesQuery.findById(tx, id)) ?? updated;
    });
  },

  remove: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<void> => {
    await withTenant(db, tenantId, async (tx) => {
      const current = await QuotesQuery.findById(tx, id);
      if (!current) throw new AppError('Orçamento não encontrado', 404);
      await assertDraft(current);

      const deleted = await QuotesQuery.delete(tx, id);
      if (!deleted) throw new AppError('Orçamento não encontrado', 404);

      await recordJourneyEvent(tx, {
        tenantId,
        journeyId: current.journeyId,
        eventType: 'quote_deleted',
        payload: { quoteId: id, origin: current.origin },
        actorUserId,
      });
      await touchJourneyActivity(tx, current.journeyId);
    });
  },

  // Items -------------------------------------------------------------

  findItems: async (
    tenantId: string,
    quoteId: string
  ): Promise<QuoteItem[]> => {
    return withTenant(db, tenantId, async (tx) => {
      const quote = await QuotesQuery.findById(tx, quoteId);
      if (!quote) throw new AppError('Orçamento não encontrado', 404);
      return QuotesQuery.findItemsByQuote(tx, quoteId);
    });
  },

  createItem: async (
    tenantId: string,
    quoteId: string,
    input: CreateQuoteItemInput
  ): Promise<{ item: QuoteItem; quote: Quote }> => {
    return withTenant(db, tenantId, async (tx) => {
      const quote = await QuotesQuery.findById(tx, quoteId);
      if (!quote) throw new AppError('Orçamento não encontrado', 404);
      await assertDraft(quote);

      // Confere que procedure existe e está ativo.
      const [proc] = await tx
        .select({ id: procedures.id, active: procedures.active })
        .from(procedures)
        .where(eq(procedures.id, input.procedureId))
        .limit(1);
      if (!proc) throw new AppError('Procedimento não encontrado', 404);
      if (!proc.active) throw new AppError('Procedimento está desativado', 409);

      const item = await QuotesQuery.createItem(tx, tenantId, quoteId, input);
      const refreshedQuote = await recomputeTotalInTx(tx, quoteId, quote);

      await touchJourneyActivity(tx, quote.journeyId);
      return { item, quote: refreshedQuote };
    });
  },

  updateItem: async (
    tenantId: string,
    quoteId: string,
    itemId: string,
    input: UpdateQuoteItemInput
  ): Promise<{ item: QuoteItem; quote: Quote }> => {
    return withTenant(db, tenantId, async (tx) => {
      const quote = await QuotesQuery.findById(tx, quoteId);
      if (!quote) throw new AppError('Orçamento não encontrado', 404);
      await assertDraft(quote);

      const current = await QuotesQuery.findItemById(tx, itemId);
      if (!current) throw new AppError('Item não encontrado', 404);
      if (current.quoteId !== quoteId) {
        throw new AppError('Item não pertence a este orçamento', 404);
      }

      const updated = await QuotesQuery.updateItem(tx, itemId, input);
      if (!updated) throw new AppError('Item não encontrado', 404);
      const refreshedQuote = await recomputeTotalInTx(tx, quoteId, quote);

      await touchJourneyActivity(tx, quote.journeyId);
      return { item: updated, quote: refreshedQuote };
    });
  },

  removeItem: async (
    tenantId: string,
    quoteId: string,
    itemId: string
  ): Promise<{ quote: Quote }> => {
    return withTenant(db, tenantId, async (tx) => {
      const quote = await QuotesQuery.findById(tx, quoteId);
      if (!quote) throw new AppError('Orçamento não encontrado', 404);
      await assertDraft(quote);

      const current = await QuotesQuery.findItemById(tx, itemId);
      if (!current) throw new AppError('Item não encontrado', 404);
      if (current.quoteId !== quoteId) {
        throw new AppError('Item não pertence a este orçamento', 404);
      }

      const deleted = await QuotesQuery.deleteItem(tx, itemId);
      if (!deleted) throw new AppError('Item não encontrado', 404);
      const refreshedQuote = await recomputeTotalInTx(tx, quoteId, quote);

      await touchJourneyActivity(tx, quote.journeyId);
      return { quote: refreshedQuote };
    });
  },

  // Transições --------------------------------------------------------

  send: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<Quote> => {
    return withTenant(db, tenantId, async (tx) => {
      const quote = await QuotesQuery.findById(tx, id);
      if (!quote) throw new AppError('Orçamento não encontrado', 404);
      await assertDraft(quote);

      const items = await QuotesQuery.findItemsByQuote(tx, id);
      if (items.length === 0) {
        throw new AppError(
          'Orçamento sem itens — adicione ao menos um antes de enviar',
          409
        );
      }

      // Recompute pra garantir total alinhado.
      await recomputeTotalInTx(tx, id, quote);

      const now = new Date();
      const updated = await QuotesQuery.update(tx, id, {
        status: 'sent',
        sentAt: now,
      });
      if (!updated) throw new AppError('Orçamento não encontrado', 404);

      const journey = await JourneysQuery.findById(tx, quote.journeyId);
      if (!journey) throw new AppError('Jornada não encontrada', 500);

      await recordJourneyEvent(tx, {
        tenantId,
        journeyId: journey.id,
        eventType: 'quote_sent',
        payload: { quoteId: updated.id, origin: updated.origin },
        actorUserId,
      });
      await touchJourneyActivity(tx, journey.id);

      // Semântica atual (chat-domain.md §5.3 ext.): stage só avança pra 'sale'
      // quando o quote é ACEITO (closeSale), não enviado. Aqui o lead/eval
      // continua no mesmo stage; substage do lead vai pra 'quoted'.
      await recomputeLeadSubstage(tx, journey.id, {
        reason: 'quote_sent',
        actorUserId,
      });

      return updated;
    });
  },

  // Reversão `sent → draft`. Permite editar items/condições depois do envio
  // sem ter que criar um quote novo (ex.: recepcionista mandou e cliente
  // pediu ajuste de parcela). Limpa `sentAt` pra refletir "nunca foi enviado
  // na versão atual". Substage `quoted` cai junto — sem quote vivo restante,
  // recompute volta pro estado anterior baseado em messages/appointments.
  revertToDraft: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<Quote> => {
    return withTenant(db, tenantId, async (tx) => {
      const quote = await QuotesQuery.findById(tx, id);
      if (!quote) throw new AppError('Orçamento não encontrado', 404);
      if (quote.status !== 'sent') {
        throw new AppError(
          `Reversão para rascunho só permitida em quote sent (atual=${quote.status})`,
          409
        );
      }

      const updated = await QuotesQuery.update(tx, id, {
        status: 'draft',
        sentAt: null,
      });
      if (!updated) throw new AppError('Orçamento não encontrado', 404);

      await recordJourneyEvent(tx, {
        tenantId,
        journeyId: quote.journeyId,
        eventType: 'quote_reverted_to_draft',
        payload: { quoteId: updated.id, previousSentAt: quote.sentAt?.toISOString() ?? null },
        actorUserId,
      });
      await touchJourneyActivity(tx, quote.journeyId);

      // Substage 'quoted' depende de quote vivo (sent/accepted). Quote agora
      // em draft → recompute volta pra contact/scheduled/etc.
      await recomputeLeadSubstage(tx, quote.journeyId, {
        reason: 'quote_reverted_to_draft',
        actorUserId,
      });

      return updated;
    });
  },

  closeSale: async (
    tenantId: string,
    id: string,
    input: CloseSaleInput,
    actorUserId: string | null
  ): Promise<{
    quote: Quote;
    sale: Sale;
    items: SaleItem[];
    payments: Payment[];
    procedureSessionIds: string[];
  }> => {
    return withTenant(db, tenantId, async (tx) => {
      const quote = await QuotesQuery.findById(tx, id);
      if (!quote) throw new AppError('Orçamento não encontrado', 404);
      if (quote.status !== 'sent') {
        throw new AppError(
          `Fechamento só permitido em quote sent (atual=${quote.status})`,
          409
        );
      }

      const items = await QuotesQuery.findItemsByQuote(tx, id);
      if (items.length === 0) {
        throw new AppError('Orçamento sem itens — não pode fechar', 409);
      }

      const journey = await JourneysQuery.findById(tx, quote.journeyId);
      if (!journey) throw new AppError('Jornada não encontrada', 500);

      // Delega criação de sale + sale_items + payments + procedure_sessions
      // pro SalesService — mantém atomicidade compartilhando a mesma Tx.
      // Items "perdidos" (não em selectedItemIds) ficam só no quote.
      const result = await SalesService.createFromQuote(tx, tenantId, {
        quoteId: quote.id,
        journeyId: journey.id,
        clientId: journey.clientId,
        input,
        actorUserId,
      });

      const now = new Date();
      const updated = await QuotesQuery.update(tx, id, {
        status: 'accepted',
        acceptedAt: now,
      });
      if (!updated) throw new AppError('Orçamento não encontrado', 404);

      const ignoredItemIds = items
        .map((it) => it.id)
        .filter((iid) => !input.selectedItemIds.includes(iid));

      await recordJourneyEvent(tx, {
        tenantId,
        journeyId: journey.id,
        eventType: 'sale_closed',
        payload: {
          quoteId: updated.id,
          saleId: result.sale.id,
          totalAmount: result.sale.totalAmount,
          discountAmount: result.sale.discountAmount,
          installments: result.payments.length,
          procedureSessionIds: result.procedureSessionIds,
          selectedItemIds: input.selectedItemIds,
          ignoredItemIds,
        },
        actorUserId,
      });
      await touchJourneyActivity(tx, journey.id);

      // Stage transition: lead/evaluation → sale acontece AQUI (fechamento),
      // não no envio do quote (chat-domain.md §5.3 ext., 2026-05). Se journey
      // ainda em lead, transiciona direto pra sale — `tenants.skip_evaluation`
      // não bloqueia mais, só emite warning no log quando=false.
      // Já em sale: closeSale de quote referral/cross-sell — no-op de stage.
      if (journey.stage === 'lead' || journey.stage === 'evaluation') {
        await applyStageTransition(tx, journey.id, {
          to: 'sale',
          reason: 'sale_closed',
          context: { quoteId: updated.id },
          actorUserId,
        });
      }
      // Stage NÃO muda mais — segue em sale até 1ª presença (§16.4).
      return {
        quote: updated,
        sale: result.sale,
        items: result.items,
        payments: result.payments,
        procedureSessionIds: result.procedureSessionIds,
      };
    });
  },

  reject: async (
    tenantId: string,
    id: string,
    actorUserId: string | null
  ): Promise<Quote> => {
    return withTenant(db, tenantId, async (tx) => {
      const quote = await QuotesQuery.findById(tx, id);
      if (!quote) throw new AppError('Orçamento não encontrado', 404);
      if (quote.status !== 'sent') {
        throw new AppError(
          `Recusa só permitida em quote sent (atual=${quote.status})`,
          409
        );
      }

      const now = new Date();
      const updated = await QuotesQuery.update(tx, id, {
        status: 'rejected',
        rejectedAt: now,
      });
      if (!updated) throw new AppError('Orçamento não encontrado', 404);

      await recordJourneyEvent(tx, {
        tenantId,
        journeyId: quote.journeyId,
        eventType: 'quote_rejected',
        payload: { quoteId: updated.id },
        actorUserId,
      });
      await touchJourneyActivity(tx, quote.journeyId);

      // Auto-lost se todas as quotes da journey ficaram fechadas (nenhuma
      // sent/accepted). Recepcionista que vai mandar 2º quote deve criar
      // o draft ANTES de rejeitar o 1º pra evitar o auto-lost — ou
      // reabrir via /leads/:id/recycle depois. Comportamento intencional
      // pra manter o kanban limpo.
      await autoLostIfAllQuotesClosed(tx, quote.journeyId, 'quote_rejected', actorUserId);

      // Recompute substage — saiu de 'quoted' (quote rejeitado) volta pro
      // estado anterior baseado em messages/appointments.
      await recomputeLeadSubstage(tx, quote.journeyId, {
        reason: 'quote_rejected',
        actorUserId,
      });
      return updated;
    });
  },

  expire: async (
    tenantId: string,
    id: string
  ): Promise<Quote> => {
    return withTenant(db, tenantId, async (tx) => {
      const quote = await QuotesQuery.findById(tx, id);
      if (!quote) throw new AppError('Orçamento não encontrado', 404);
      if (quote.status !== 'sent') {
        throw new AppError(
          `Expiração só permitida em quote sent (atual=${quote.status})`,
          409
        );
      }
      if (!quote.validUntil || quote.validUntil > new Date()) {
        throw new AppError('Orçamento ainda válido — não pode expirar', 409);
      }

      const updated = await QuotesQuery.update(tx, id, { status: 'expired' });
      if (!updated) throw new AppError('Orçamento não encontrado', 404);
      // Sem journey_event próprio — expiração é evento de sistema.

      // Mesmo padrão do reject: se todas as quotes fechadas, auto-lost
      // com motivo 'quote_expired'. Caller (automação de expire) não passa
      // actorUserId — é evento de sistema.
      await autoLostIfAllQuotesClosed(tx, quote.journeyId, 'quote_expired', null);

      await recomputeLeadSubstage(tx, quote.journeyId, {
        reason: 'quote_expired',
        actorUserId: null,
      });
      return updated;
    });
  },
};

// Recomputa totalAmount = itemsTotal - discountAmount, atualiza e retorna
// o quote refresh. Usado pelos métodos de items + update de discount.
async function recomputeTotalInTx(
  tx: import('@elora/db').Tx,
  quoteId: string,
  current: Quote
): Promise<Quote> {
  const itemsTotal = await QuotesQuery.computeItemsTotal(tx, quoteId);
  const discount = Number(current.discountAmount);
  const total = Math.max(0, itemsTotal - discount);
  const updated = await QuotesQuery.update(tx, quoteId, { totalAmount: total });
  if (!updated) {
    // Quote sumiu (race com delete?). Retorna estado anterior pra caller decidir.
    return current;
  }
  // Pega a versão fresh (com updatedAt atualizado).
  const fresh = await QuotesQuery.findById(tx, quoteId);
  return fresh ?? updated;
}
