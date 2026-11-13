import { journeys, journeyEvents, type InferSelectModel } from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';
import {
  ALLOWED_LOST_REASONS,
} from '../../shared/journeys/stageTransition.js';
import { JOURNEY_EVENT_TYPES } from '../../shared/journeys/eventTypes.js';

export type Journey = InferSelectModel<typeof journeys>;
export type JourneyEvent = InferSelectModel<typeof journeyEvents>;

export const journeysSortSpec = createSortSpec(
  {
    createdAt: journeys.createdAt,
    updatedAt: journeys.updatedAt,
    lastActivityAt: journeys.lastActivityAt,
    stage: journeys.stage,
    status: journeys.status,
  },
  // "Mais recentemente tocada por staff" é a ordenação default — alinha com a
  // visão de "fila de trabalho" da recepção (chat-domain.md §10.1).
  { field: 'lastActivityAt', direction: 'desc' }
);

export const journeyStageValues = [
  'lead',
  'evaluation',
  'sale',
  'treatment',
  'result',
] as const;

export const journeyStatusValues = ['active', 'won', 'lost'] as const;

// Sources permitidas em POST manual. `whatsapp` e `recycling` saem por
// pipelines próprios (chat inbound, recycling worker) — não pelo endpoint
// HTTP de criação manual.
export const manualSourceValues = [
  'manual',
  'form',
  'sheets',
  'imported',
  'other',
] as const;

export const allSourceValues = [
  'whatsapp',
  ...manualSourceValues,
  'recycling',
] as const;

export const journeyResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    clientId: z.string().uuid(),
    stage: z.enum(journeyStageValues),
    source: z.enum(allSourceValues),
    sourceMetadata: z.record(z.unknown()).nullable(),
    status: z.enum(journeyStatusValues),
    lostReason: z.string().nullable(),
    lastActivityAt: z.string().datetime(),
    closedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Journey');

export const createJourneySchema = z
  .object({
    clientId: z
      .string()
      .uuid('clientId inválido')
      .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
    source: z.enum(manualSourceValues).default('manual'),
    sourceMetadata: z.record(z.unknown()).optional(),
  })
  .openapi('CreateJourneyInput');

export type CreateJourneyInput = z.infer<typeof createJourneySchema>;

export const findJourneysQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    stage: z.enum(journeyStageValues).optional(),
    status: z
      .enum([...journeyStatusValues, 'all'] as const)
      .default('active'),
    source: z.enum(allSourceValues).optional(),
    clientId: z.string().uuid().optional(),
  })
  .merge(sortQuerySchema(journeysSortSpec))
  .openapi('FindJourneysQuery');

export type FindJourneysQuery = z.infer<typeof findJourneysQuerySchema>;

export const journeyIdParamSchema = z.object({
  id: z
    .string()
    .uuid('ID inválido')
    .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export type JourneyIdParam = z.infer<typeof journeyIdParamSchema>;

export const markLostSchema = z
  .object({
    reason: z
      .enum(ALLOWED_LOST_REASONS)
      .openapi({ example: 'price', description: 'Razão da perda (enum fixo)' }),
  })
  .openapi('MarkLostInput');

export type MarkLostInput = z.infer<typeof markLostSchema>;

// =====================================================================
// Journey events (audit trail)
// =====================================================================

export const journeyEventResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    journeyId: z.string().uuid(),
    eventType: z.string(),
    payload: z.record(z.unknown()).nullable(),
    actorUserId: z.string().uuid().nullable(),
    createdAt: z.string().datetime(),
  })
  .openapi('JourneyEvent');

export const findJourneyEventsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
    eventType: z.enum(JOURNEY_EVENT_TYPES).optional(),
  })
  .openapi('FindJourneyEventsQuery');

export type FindJourneyEventsQuery = z.infer<typeof findJourneyEventsQuerySchema>;
