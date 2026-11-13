import {
  and,
  desc,
  eq,
  journeyEvents,
  journeys,
  sql,
  type SQL,
  type Tx,
} from '@elora/db';
import {
  type Journey,
  type JourneyEvent,
  type allSourceValues,
  type journeyStageValues,
  type journeyStatusValues,
} from './JourneysTypes.js';

interface FindFilters {
  stage?: (typeof journeyStageValues)[number];
  status?: (typeof journeyStatusValues)[number] | undefined; // undefined = 'all'
  source?: (typeof allSourceValues)[number];
  clientId?: string;
}

interface Pagination {
  page: number;
  pageSize: number;
}

interface CreateInput {
  clientId: string;
  source: (typeof allSourceValues)[number];
  sourceMetadata?: Record<string, unknown>;
}

export const JourneysQuery = {
  findPaginated: async (
    tx: Tx,
    filters: FindFilters,
    pagination: Pagination,
    orderBy: SQL
  ): Promise<{ items: Journey[]; total: number }> => {
    const where = and(
      filters.stage ? eq(journeys.stage, filters.stage) : undefined,
      filters.status ? eq(journeys.status, filters.status) : undefined,
      filters.source ? eq(journeys.source, filters.source) : undefined,
      filters.clientId ? eq(journeys.clientId, filters.clientId) : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(journeys)
      .where(where)
      .orderBy(orderBy)
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(journeys)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },

  findById: async (tx: Tx, id: string): Promise<Journey | undefined> => {
    const [row] = await tx
      .select()
      .from(journeys)
      .where(eq(journeys.id, id))
      .limit(1);
    return row;
  },

  findActiveByClient: async (
    tx: Tx,
    clientId: string
  ): Promise<Journey | undefined> => {
    const [row] = await tx
      .select()
      .from(journeys)
      .where(and(eq(journeys.clientId, clientId), eq(journeys.status, 'active')))
      .limit(1);
    return row;
  },

  create: async (
    tx: Tx,
    tenantId: string,
    input: CreateInput
  ): Promise<Journey> => {
    const [row] = await tx
      .insert(journeys)
      .values({
        tenantId,
        clientId: input.clientId,
        stage: 'lead',
        source: input.source,
        sourceMetadata: input.sourceMetadata ?? {},
        status: 'active',
      })
      .returning();
    if (!row) throw new Error('Falha ao inserir journey');
    return row;
  },

  // Audit trail
  findEventsPaginated: async (
    tx: Tx,
    journeyId: string,
    filters: { eventType?: string },
    pagination: Pagination
  ): Promise<{ items: JourneyEvent[]; total: number }> => {
    const where = and(
      eq(journeyEvents.journeyId, journeyId),
      filters.eventType ? eq(journeyEvents.eventType, filters.eventType) : undefined,
    );

    const offset = (pagination.page - 1) * pagination.pageSize;

    const items = await tx
      .select()
      .from(journeyEvents)
      .where(where)
      .orderBy(desc(journeyEvents.createdAt))
      .limit(pagination.pageSize)
      .offset(offset);

    const [totalRow] = await tx
      .select({ count: sql<number>`count(*)::int`.as('count') })
      .from(journeyEvents)
      .where(where);

    return { items, total: totalRow?.count ?? 0 };
  },
};
