import { agentTurns, eq, withTenant } from '@elora/db';
import { db } from '../../shared/database/db.js';
import type { ExecutedToolCall } from '../tools/index.js';

// =====================================================================
// AgentTurnsRepo — persistência da row em `agent_turns` por rodada.
//
// Fluxo em 2 passos (PR 6+):
//   1. `createPlaceholder` no INÍCIO da rodada — INSERT mínimo com id +
//      ids de tenant/conv/trigger + promptVersion + model. Defaults
//      cobrem o resto (tokens=0, cost=0, tool_calls='[]').
//   2. `finalize` no FIM (sempre — finally block) — UPDATE com os
//      valores reais: tokens, custo, latência, tool_calls jsonb,
//      outputMessageIds, classificationTagIds, handoffReason, error.
//
// Por que 2 passos: tools como `tagConversation` precisam linkar
// `assigned_by_agent_turn_id` FK pro row do turno. Insert único só no
// fim quebra FK em tempo de tool. Insert cedo + update no fim resolve
// sem precisar trocar a FK pra DEFERRABLE.
// =====================================================================

export interface CreatePlaceholderInput {
  id: string;
  tenantId: string;
  conversationId: string;
  triggerType: 'idle' | 'out_of_hours' | 'manual_resume';
  triggerMetadata: Record<string, unknown> | null;
  inputMessageId: string | null;
  promptVersion: string;
  model: string;
}

export interface FinalizeAgentTurnInput {
  id: string;
  tenantId: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costCents: number;
  latencyMs: number;
  toolCalls: ExecutedToolCall[];
  outputMessageIds: string[] | null;
  classificationTagIds: string[] | null;
  handoffReason: string | null;
  error: string | null;
}

export const AgentTurnsRepo = {
  createPlaceholder: async (input: CreatePlaceholderInput): Promise<void> => {
    await withTenant(db, input.tenantId, async (tx) => {
      await tx.insert(agentTurns).values({
        id: input.id,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        triggerType: input.triggerType,
        triggerMetadata: input.triggerMetadata,
        inputMessageId: input.inputMessageId,
        promptVersion: input.promptVersion,
        model: input.model,
        // Demais campos: NOT NULL com default (0, '[]', etc) — não precisa setar.
      });
    });
  },

  finalize: async (input: FinalizeAgentTurnInput): Promise<void> => {
    await withTenant(db, input.tenantId, async (tx) => {
      await tx
        .update(agentTurns)
        .set({
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          cacheReadTokens: input.cacheReadTokens,
          cacheCreationTokens: input.cacheCreationTokens,
          // Drizzle aceita number pra colunas decimal; serializa pra string.
          costCents: String(input.costCents),
          latencyMs: input.latencyMs,
          toolCalls: input.toolCalls,
          outputMessageIds: input.outputMessageIds,
          classificationTagIds: input.classificationTagIds,
          handoffReason: input.handoffReason,
          error: input.error,
        })
        .where(eq(agentTurns.id, input.id));
    });
  },
};
