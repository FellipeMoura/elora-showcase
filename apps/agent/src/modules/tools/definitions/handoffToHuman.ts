import { conversations, eq, withTenant } from '@elora/db';
import { z } from 'zod';
import { db } from '../../../shared/database/db.js';
import { logger } from '../../../shared/observability/logger.js';
import type { ToolDefinition } from '../types.js';

// =====================================================================
// tool: handoffToHuman
//
// Marca a conversa pra humano assumir. Implementação: atualiza
// `conversations.agent_paused_until = now + 1h`. AgentRunner respeita
// esse campo no início da próxima rodada e dropa sem chamar Anthropic.
//
// Por que escrita direta no DB (sem hop HTTP pelo core): operação simples
// e exclusiva do domínio do agent — RLS via withTenant garante isolamento.
// Quando precisarmos de auditoria/notificação cross-app (ex.: webhook pra
// recepção), promovemos pra endpoint dedicado.
//
// Default = 1h. Suficiente pra equipe ver e responder; expira sozinho
// caso ninguém olhe — agente volta a ajudar. UI do PR 8 vai permitir
// override (24h, indefinido).
//
// `urgency`: NÃO altera comportamento V1 — registra no log/turn pra
// telemetria. PR 9 vai usar pra priorizar fila de handoffs no painel.
// =====================================================================

const HANDOFF_DURATION_MS = 60 * 60 * 1000; // 1 hora

const inputZod = z
  .object({
    reason: z
      .string()
      .trim()
      .min(3, 'Motivo muito curto')
      .max(200, 'Motivo muito longo'),
    urgency: z.enum(['low', 'high']).optional(),
  })
  .strict();

interface HandoffOutput {
  pausedUntil: string;
  message: string;
}

export const handoffToHumanTool: ToolDefinition<
  z.infer<typeof inputZod>,
  HandoffOutput
> = {
  name: 'handoffToHuman',
  description:
    'Marca a conversa pra um humano da equipe assumir — agente fica pausado ' +
    'por 1 hora. USE quando: (1) cliente pede explicitamente pra falar com ' +
    'alguém; (2) reclama, ameaça desistir, fala de queixa médica; (3) você ' +
    'não consegue responder com confiança; (4) cliente quer FECHAR um ' +
    'agendamento (V1 não confirma — só sugere). Depois de chamar handoff, ' +
    'AINDA responda ao cliente avisando que alguém vai atender em breve.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: {
        type: 'string',
        minLength: 3,
        maxLength: 200,
        description:
          'Motivo do handoff em PT-BR curto (ex: "cliente quer fechar agendamento", "reclamação de atendimento").',
      },
      urgency: {
        type: 'string',
        enum: ['low', 'high'],
        description:
          '"high" pra casos médicos urgentes/reclamações sérias; "low" pro restante. Default: low.',
      },
    },
    required: ['reason'],
    additionalProperties: false,
  },
  inputZod,
  handler: async (input, ctx) => {
    const pausedUntilDate = new Date(Date.now() + HANDOFF_DURATION_MS);

    await withTenant(db, ctx.tenantId, async (tx) => {
      await tx
        .update(conversations)
        .set({ agentPausedUntil: pausedUntilDate })
        .where(eq(conversations.id, ctx.conversationId));
    });

    logger.info(
      {
        conversationId: ctx.conversationId,
        agentTurnId: ctx.agentTurnId,
        reason: input.reason,
        urgency: input.urgency ?? 'low',
        pausedUntil: pausedUntilDate.toISOString(),
      },
      '[handoffToHuman] conversa pausada pra humano',
    );

    return {
      pausedUntil: pausedUntilDate.toISOString(),
      message: 'Conversa marcada pra atendimento humano. Responda ao cliente avisando.',
    };
  },
};
