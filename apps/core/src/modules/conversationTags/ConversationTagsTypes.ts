import { conversationTags, type InferSelectModel } from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type ConversationTag = InferSelectModel<typeof conversationTags>;

export const conversationTagsSortSpec = createSortSpec(
  {
    name: conversationTags.name,
    createdAt: conversationTags.createdAt,
    updatedAt: conversationTags.updatedAt,
  },
  { field: 'name', direction: 'asc' }
);

// Hex 7 chars (#RRGGBB). UI dá picker; backend valida formato pra evitar
// '#fff' ou 'red' entrar no banco. Frontend pode escolher entre paleta
// curada ou color picker livre — backend não impõe paleta.
const hexColorSchema = z
  .string()
  .regex(/^#[0-9A-Fa-f]{6}$/, 'Cor deve ser hex no formato #RRGGBB');

export const conversationTagResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    name: z.string(),
    color: z.string(),
    agentInstruction: z.string().nullable(),
    active: z.boolean(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ConversationTag');

export const createConversationTagSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(64)
      .openapi({ example: 'Interessado em laser' }),
    color: hexColorSchema.openapi({ example: '#3B82F6' }),
    // Instrução em PT-BR de quando o agente IA deve aplicar a tag. Null/vazio
    // = tag puramente humana, agente ignora. Texto vai DENTRO do system prompt.
    agentInstruction: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .openapi({
        example:
          'Aplique quando o cliente menciona depilação a laser, citar pelos como problema ou perguntar sobre tratamento de pelos.',
      }),
  })
  .openapi('CreateConversationTagInput');

export type CreateConversationTagInput = z.infer<typeof createConversationTagSchema>;

export const updateConversationTagSchema = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    color: hexColorSchema.optional(),
    agentInstruction: z.string().trim().max(500).nullable().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateConversationTagInput');

export type UpdateConversationTagInput = z.infer<typeof updateConversationTagSchema>;

export const findConversationTagsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1).openapi({ example: 1 }),
    pageSize: z.coerce.number().int().min(1).max(500).default(100),
    q: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
  })
  .merge(sortQuerySchema(conversationTagsSortSpec))
  .openapi('FindConversationTagsQuery');

export type FindConversationTagsQuery = z.infer<typeof findConversationTagsQuerySchema>;

export const conversationTagIdParamSchema = z.object({
  id: z
    .string()
    .uuid('ID inválido')
    .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export type ConversationTagIdParam = z.infer<typeof conversationTagIdParamSchema>;

// =====================================================================
// Assignments — atribuição de tags a uma conversa.
// =====================================================================
// V1: endpoint único `POST /conversation-tags/assignments` em modo REPLACE
// (substitui o conjunto inteiro pra aquela conversa). Caller pode ser:
//   - apps/agent: depois de classificar a conversa via tool tagConversation
//     (preenche agentTurnId pra audit). PR 5.
//   - UI humana: futura, sem agentTurnId. (PR 8 ou ad-hoc)
// Tags removidas no replace simplesmente saem dos chips do frontend —
// histórico fica via `agent_turns.classification_tag_ids` que NÃO sofre
// edição.

export const replaceConversationTagsSchema = z
  .object({
    conversationId: z
      .string()
      .uuid()
      .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
    tagIds: z
      .array(z.string().uuid())
      .max(10, 'Máximo de 10 tags por conversa')
      .openapi({
        example: ['00000000-0000-0000-0000-000000000000'],
        description:
          'Conjunto completo. Conjunto anterior é REMOVIDO antes da inserção.',
      }),
    agentTurnId: z
      .string()
      .uuid()
      .nullish()
      .openapi({
        description:
          'Procedência. Preenchido pelo apps/agent quando a classificação vem do AgentRunner; null/omitido em atribuições humanas.',
      }),
  })
  .openapi('ReplaceConversationTagsInput');

export type ReplaceConversationTagsInput = z.infer<typeof replaceConversationTagsSchema>;

export const conversationTagAssignmentResponseSchema = z
  .object({
    conversationId: z.string().uuid(),
    tagId: z.string().uuid(),
    assignedByAgentTurnId: z.string().uuid().nullable(),
    assignedAt: z.string().datetime(),
  })
  .openapi('ConversationTagAssignment');

export const replaceConversationTagsResponseSchema = z
  .object({
    conversationId: z.string().uuid(),
    tagIds: z.array(z.string().uuid()),
    source: z.enum(['agent', 'human']),
    agentTurnId: z.string().uuid().nullable(),
    updatedAt: z.string().datetime(),
  })
  .openapi('ReplaceConversationTagsResponse');

export type ReplaceConversationTagsResponse = z.infer<
  typeof replaceConversationTagsResponseSchema
>;
