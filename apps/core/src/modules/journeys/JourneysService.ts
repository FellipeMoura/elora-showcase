import { clients, eq, journeyEvents, withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  markJourneyLost,
  markJourneyWon,
  type LostReason,
} from '../../shared/journeys/stageTransition.js';
import { resolveSort } from '../../shared/sorting/buildSort.js';
import type { PaginatedResult } from '../../shared/types/pagination.js';
import { totalPagesOf } from '../../shared/types/pagination.js';
import { JourneysQuery } from './JourneysQuery.js';
import { journeysSortSpec } from './JourneysTypes.js';
import type {
  CreateJourneyInput,
  FindJourneyEventsQuery,
  FindJourneysQuery,
  Journey,
  JourneyEvent,
} from './JourneysTypes.js';

export const JourneysService = {
  find: async (
    tenantId: string,
    query: FindJourneysQuery
  ): Promise<PaginatedResult<Journey>> => {
    return withTenant(db, tenantId, async (tx) => {
      const orderBy = resolveSort(
        { sortBy: query.sortBy, sortDir: query.sortDir },
        journeysSortSpec
      );
      const { items, total } = await JourneysQuery.findPaginated(
        tx,
        {
          stage: query.stage,
          status: query.status === 'all' ? undefined : query.status,
          source: query.source,
          clientId: query.clientId,
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

  findById: async (tenantId: string, id: string): Promise<Journey> => {
    return withTenant(db, tenantId, async (tx) => {
      const journey = await JourneysQuery.findById(tx, id);
      if (!journey) throw new AppError('Jornada não encontrada', 404);
      return journey;
    });
  },

  create: async (
    tenantId: string,
    input: CreateJourneyInput
  ): Promise<Journey> => {
    return withTenant(db, tenantId, async (tx) => {
      // Verifica que cliente existe no tenant (RLS já filtra).
      const [client] = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, input.clientId))
        .limit(1);
      if (!client) throw new AppError('Cliente não encontrado', 404);

      // Princípio §2.2: 1 active por cliente. Existente = retorna 409 com o ID
      // pra UI redirecionar.
      const existing = await JourneysQuery.findActiveByClient(tx, input.clientId);
      if (existing) {
        throw new AppError(
          'Cliente já possui uma jornada ativa',
          409,
          { activeJourneyId: existing.id }
        );
      }

      const created = await JourneysQuery.create(tx, tenantId, {
        clientId: input.clientId,
        source: input.source,
        sourceMetadata: input.sourceMetadata,
      });

      await tx.insert(journeyEvents).values({
        tenantId,
        journeyId: created.id,
        eventType: 'journey_created',
        payload: {
          source: input.source,
          sourceMetadata: input.sourceMetadata ?? {},
        } as Record<string, unknown>,
      });

      return created;
    });
  },

  markWon: async (
    tenantId: string,
    journeyId: string,
    actorUserId: string | null
  ): Promise<Journey> => {
    return withTenant(db, tenantId, async (tx) => {
      return markJourneyWon(tx, journeyId, actorUserId);
    });
  },

  markLost: async (
    tenantId: string,
    journeyId: string,
    reason: LostReason,
    actorUserId: string | null
  ): Promise<Journey> => {
    return withTenant(db, tenantId, async (tx) => {
      return markJourneyLost(tx, journeyId, reason, actorUserId);
    });
  },

  findEvents: async (
    tenantId: string,
    journeyId: string,
    query: FindJourneyEventsQuery
  ): Promise<PaginatedResult<JourneyEvent>> => {
    return withTenant(db, tenantId, async (tx) => {
      // Confere que journey existe (e que o tenant pode vê-la — RLS).
      const journey = await JourneysQuery.findById(tx, journeyId);
      if (!journey) throw new AppError('Jornada não encontrada', 404);

      const { items, total } = await JourneysQuery.findEventsPaginated(
        tx,
        journeyId,
        { eventType: query.eventType },
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
};
