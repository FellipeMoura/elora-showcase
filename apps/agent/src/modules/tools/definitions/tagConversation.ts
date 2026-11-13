import { z } from 'zod';
import { coreClient } from '../../../shared/coreClient/index.js';
import type { ToolDefinition } from '../types.js';

// =====================================================================
// tool: tagConversation
//
// Aplica conjunto de tags do catálogo do tenant à conversa atual.
// Endpoint do core (POST /conversation-tags/assignments) opera em modo
// REPLACE — substitui o conjunto anterior. Isso simplifica o prompt do
// classificador: ele sempre passa o conjunto desejado completo, sem
// precisar "lembrar" o que já estava aplicado.
//
// IDs precisam vir do catálogo apresentado no system prompt. Tag inativa
// ou ID inexistente faz o endpoint do core devolver 400 com `missing`
// no body — handler propaga o erro como tool_result com result='error',
// e o LLM tem chance de corrigir no próximo turn (no PR 5 onde o
// tool_choice força exatamente essa tool, ele simplesmente registra
// como falha do turno).
// =====================================================================

const inputZod = z.object({
  tagIds: z
    .array(z.string().uuid())
    .max(5, 'Máximo de 5 tags por classificação'),
});

export const tagConversationTool: ToolDefinition<
  z.infer<typeof inputZod>,
  { applied: number }
> = {
  name: 'tagConversation',
  description:
    'Aplica as tags apropriadas (do catálogo TAGS DISPONÍVEIS) à conversa atual. ' +
    'O conjunto enviado SUBSTITUI o conjunto anterior — para remover uma tag, ' +
    'omita o ID dela. Envie array vazio quando nenhuma tag se aplicar.',
  inputSchema: {
    type: 'object',
    properties: {
      tagIds: {
        type: 'array',
        items: { type: 'string', format: 'uuid' },
        minItems: 0,
        maxItems: 5,
        description:
          'IDs (UUID) das tags do catálogo apresentado. Use SOMENTE IDs presentes em TAGS DISPONÍVEIS — IDs desconhecidos causam erro.',
      },
    },
    required: ['tagIds'],
    additionalProperties: false,
  },
  inputZod,
  handler: async (input, ctx) => {
    await coreClient.assignConversationTags(ctx.tenantId, {
      conversationId: ctx.conversationId,
      tagIds: input.tagIds,
      agentTurnId: ctx.agentTurnId,
    });
    return { applied: input.tagIds.length };
  },
};
