import { journeys, LEAD_SUBSTAGES, type InferSelectModel } from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';
import { ALLOWED_LOST_REASONS } from '../../shared/journeys/stageTransition.js';

// =====================================================================
// Tipos do módulo /leads.
//
// O módulo opera em cima de `journeys WHERE stage='lead'` — não tem tabela
// própria (chat-domain.md §5.1 ext.). Endpoints são desenhados pra suportar
// uma UI de kanban (board com colunas por `lead_substage` + flat list +
// detail enriquecido com cliente / conversa / appointment / quote).
// =====================================================================

export type Journey = InferSelectModel<typeof journeys>;

// Ordenação default: mais recentemente tocada (fila de trabalho do staff).
export const leadsSortSpec = createSortSpec(
  {
    createdAt: journeys.createdAt,
    updatedAt: journeys.updatedAt,
    lastActivityAt: journeys.lastActivityAt,
  },
  { field: 'lastActivityAt', direction: 'desc' }
);

// =====================================================================
// Valores compartilhados (replicados em PT-BR na UI via labels).
// =====================================================================

export const leadSubstageValues = LEAD_SUBSTAGES;
export type LeadSubstageValue = (typeof leadSubstageValues)[number];

export const leadSourceValues = [
  'whatsapp',
  'form',
  'sheets',
  'manual',
  'recycling',
  'imported',
  'other',
] as const;

// Sources permitidas em POST manual (espelha JourneysTypes).
// Mantido pra outras integrações que ainda passem `source` explícito (form,
// sheets, importação). A rota `POST /leads` hoje fixa em 'manual' — outras
// origens terão endpoints próprios quando forem implementadas.
export const manualLeadSourceValues = [
  'manual',
  'form',
  'sheets',
  'imported',
  'other',
] as const;

export type ManualLeadSource = (typeof manualLeadSourceValues)[number];

// =====================================================================
// Card do kanban — payload enxuto pra renderização rápida em N colunas.
// =====================================================================

export const leadCardSchema = z
  .object({
    id: z.string().uuid(),
    clientId: z.string().uuid(),
    clientName: z.string(),
    clientPhone: z.string().nullable(),
    substage: z.enum(leadSubstageValues).nullable(),
    source: z.enum(leadSourceValues),
    lastActivityAt: z.string().datetime(),
    createdAt: z.string().datetime(),
    // Conversation associada (se houver), pra deep-link "abrir chat".
    conversationId: z.string().uuid().nullable(),
    // whatsapp_contacts.id da conversa associada — alimenta o avatar com
    // foto de perfil quando há.
    whatsappContactId: z.string().uuid().nullable(),
    // Última mensagem da conversa associada (até 200 chars) + metadados
    // pra UI renderizar prévia tipada igual à CHAT sidebar (mídia, sticker,
    // template, system, call).
    lastMessagePreview: z.string().nullable(),
    lastMessageDirection: z
      .enum(['inbound', 'outbound', 'internal_note'])
      .nullable(),
    lastMessageKind: z
      .enum(['text', 'media', 'template', 'system', 'sticker', 'call'])
      .nullable(),
    lastMessageMediaType: z
      .enum(['image', 'audio', 'video', 'document', 'sticker'])
      .nullable(),
    // Próximo appointment de avaliação futuro (se houver). Usado pra
    // mostrar data nos cards de substage 'scheduled' / 'rescheduled'.
    nextEvaluationAt: z.string().datetime().nullable(),
  })
  .openapi('LeadCard');

export type LeadCard = z.infer<typeof leadCardSchema>;

// =====================================================================
// Detalhe enriquecido — usado em GET /leads/:id (drawer/modal de detalhe).
// =====================================================================

export const leadDetailSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    clientId: z.string().uuid(),
    clientName: z.string(),
    clientPhone: z.string().nullable(),
    clientEmail: z.string().nullable(),
    stage: z.literal('lead'),
    substage: z.enum(leadSubstageValues).nullable(),
    status: z.enum(['active', 'won', 'lost']),
    source: z.enum(leadSourceValues),
    sourceMetadata: z.record(z.unknown()).nullable(),
    lostReason: z.string().nullable(),
    lastActivityAt: z.string().datetime(),
    closedAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    conversationId: z.string().uuid().nullable(),
    nextEvaluationAt: z.string().datetime().nullable(),
    latestQuoteId: z.string().uuid().nullable(),
    latestQuoteStatus: z.string().nullable(),
  })
  .openapi('LeadDetail');

export type LeadDetail = z.infer<typeof leadDetailSchema>;

// =====================================================================
// Filtros + paginação compartilhados por /leads e /leads/board.
// =====================================================================

export const findLeadsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    substage: z.enum(leadSubstageValues).optional(),
    source: z.enum(leadSourceValues).optional(),
    // Filtro por idade (dias desde createdAt). Útil pra "leads frias > 7d".
    ageMinDays: z.coerce.number().int().min(0).optional(),
    ageMaxDays: z.coerce.number().int().min(0).optional(),
    // Filtro por canal WhatsApp (futuro — multi-canal por tenant).
    channelId: z.string().uuid().optional(),
    // Busca textual em client.name e client.phone_e164.
    search: z.string().trim().min(1).max(120).optional(),
  })
  .merge(sortQuerySchema(leadsSortSpec))
  .openapi('FindLeadsQuery');

export type FindLeadsQuery = z.infer<typeof findLeadsQuerySchema>;

// =====================================================================
// /leads/board — uma página de cada coluna na mesma chamada.
// =====================================================================

const boardColumnSchema = z.object({
  items: z.array(leadCardSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
});

export const leadsBoardResponseSchema = z
  .object({
    columns: z.object({
      new: boardColumnSchema,
      template: boardColumnSchema,
      contact: boardColumnSchema,
      scheduled: boardColumnSchema,
      no_show: boardColumnSchema,
      rescheduled: boardColumnSchema,
      quoted: boardColumnSchema,
    }),
    totals: z.object({
      new: z.number().int(),
      template: z.number().int(),
      contact: z.number().int(),
      scheduled: z.number().int(),
      no_show: z.number().int(),
      rescheduled: z.number().int(),
      quoted: z.number().int(),
      // Leads sem substage definido (cenário transitório / criação manual sem cascata).
      unset: z.number().int(),
    }),
  })
  .openapi('LeadsBoardResponse');

export type LeadsBoardResponse = z.infer<typeof leadsBoardResponseSchema>;

// =====================================================================
// /leads/counts — só os totais, mais barato pra badges/sidebar.
// =====================================================================

export const leadsCountsResponseSchema = leadsBoardResponseSchema.shape.totals;
export type LeadsCountsResponse = z.infer<typeof leadsCountsResponseSchema>;

// =====================================================================
// POST /leads — criação manual (form único).
//
// Recebe os mesmos campos que /clients (cadastro inline) + flag
// `createWhatsappContact`. Source é fixa em 'manual'. Outras origens
// (form de landing, sync sheets) terão endpoints próprios — mantemos o
// form único focado no cadastro manual via UI.
// =====================================================================

const phoneE164Regex = /^\+[1-9]\d{7,14}$/;

// CPF e endereço duplicam a forma definida em ClientsTypes — mantemos inline
// pra evitar import cross-module. Backend normaliza CPF pra dígitos via
// transform e mantém endereço como jsonb estruturado.
const leadCpfSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 11, 'CPF deve conter 11 dígitos');

const leadAddressSchema = z.object({
  zipCode: z
    .string()
    .trim()
    .transform((s) => s.replace(/\D/g, ''))
    .refine((s) => s.length === 0 || s.length === 8, 'CEP deve conter 8 dígitos')
    .optional(),
  street: z.string().trim().max(255).optional(),
  number: z.string().trim().max(20).optional(),
  complement: z.string().trim().max(255).optional(),
  neighborhood: z.string().trim().max(255).optional(),
  city: z.string().trim().max(120).optional(),
  state: z
    .string()
    .trim()
    .length(2, 'UF deve ter 2 letras')
    .toUpperCase()
    .optional(),
  country: z.string().trim().max(60).optional(),
});

export const createLeadSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'Maria Silva' }),
    phoneE164: z
      .string()
      .trim()
      .regex(phoneE164Regex, 'Telefone deve estar em formato E.164 (ex: +5511999999999)')
      .max(20)
      .openapi({ example: '+5511999999999' }),
    email: z
      .string()
      .trim()
      .email('Email inválido')
      .max(255)
      .nullable()
      .optional(),
    birthDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar em formato YYYY-MM-DD')
      .nullable()
      .optional(),
    document: leadCpfSchema.nullable().optional().openapi({ example: '12345678909' }),
    address: leadAddressSchema.nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    isVip: z.boolean().optional(),
    // Frontend só seta `true` depois que GET /whatsapp/numbers/check
    // confirmou que o número responde no WhatsApp. Default `false` — sem
    // contact (warning amarelo).
    createWhatsappContact: z.boolean().default(false),
    // E.164 que o WhatsApp efetivamente reconhece — vem do check do
    // frontend (que já fez resolveNumber e sabe o número canônico). Pode
    // diferir de `phoneE164` por causa da quirk BR. Quando ausente e
    // `createWhatsappContact=true`, o backend deixa null e o worker
    // resolve no primeiro envio (lazy backfill).
    whatsappE164: z
      .string()
      .trim()
      .regex(phoneE164Regex, 'whatsappE164 deve estar em formato E.164')
      .max(20)
      .optional(),
  })
  .openapi('CreateLeadInput');

export type CreateLeadInput = z.infer<typeof createLeadSchema>;

// =====================================================================
// PUT /leads/:id/substage — override manual de substage.
// =====================================================================

export const updateLeadSubstageSchema = z
  .object({
    substage: z.enum(leadSubstageValues).openapi({
      example: 'contact',
      description: 'Substage a forçar (admin override). Cascata pode reescrever.',
    }),
  })
  .openapi('UpdateLeadSubstageInput');

export type UpdateLeadSubstageInput = z.infer<typeof updateLeadSubstageSchema>;

// =====================================================================
// POST /leads/:id/mark-lost — proxy pra journeys/:id/lost.
// =====================================================================

export const markLeadLostSchema = z
  .object({
    reason: z
      .enum(ALLOWED_LOST_REASONS)
      .openapi({ example: 'timeout', description: 'Motivo da perda (enum fixo)' }),
  })
  .openapi('MarkLeadLostInput');

export type MarkLeadLostInput = z.infer<typeof markLeadLostSchema>;

// =====================================================================
// Param :id
// =====================================================================

export const leadIdParamSchema = z.object({
  id: z
    .string()
    .uuid('ID inválido')
    .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export type LeadIdParam = z.infer<typeof leadIdParamSchema>;
