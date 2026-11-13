import { randomUUID } from 'node:crypto';
import type {
  ContentBlock,
  Message,
  MessageParam,
  TextBlock,
  ToolResultBlockParam,
  ToolUseBlock,
  ToolUnion,
} from '@anthropic-ai/sdk/resources/messages';
import { env } from '../../env.js';
import { logger } from '../../shared/observability/logger.js';
import { requestContextStorage } from '../../shared/observability/requestContext.js';
import { createMessage } from '../../shared/anthropic/client.js';
import {
  executeToolCall,
  ToolRegistry,
  type ExecutedToolCall,
  type ToolHandlerContext,
} from '../tools/index.js';
import { PromptBuilder } from '../prompts/PromptBuilder.js';
import { ContextBuilder, type ConversationContext } from './ContextBuilder.js';
import { AgentTurnsRepo } from './AgentTurnsRepo.js';
import { ResponseDispatcher } from './ResponseDispatcher.js';

// =====================================================================
// AgentRunner — orquestra UMA rodada do agente (PR 6 conversational).
//
// Loop:
//   1. Carrega contexto (skip se pausado).
//   2. Monta prompt conversational (system + user com histórico).
//   3. Loop até stop_reason='end_turn' OU max iterations:
//        a. Chama Anthropic com TODAS as tools registradas.
//        b. Se tool_use → executa, anexa assistant+tool_result, repete.
//        c. Se end_turn → envia text blocks como mensagens outbound.
//   4. Persiste agent_turn com tudo (custo agregado, todas as tool calls,
//      messageIds enviados, handoffReason se aplicável).
//
// Max iterations: env.agent.maxToolIterations (default 5). Atingir limite
// força handoff automático — agente desistiu de resolver na rodada.
// =====================================================================

const CONVERSATIONAL_TOOL_NAMES = [
  'tagConversation',
  'getClientInfo',
  'getProcedureInfo',
  'getBusinessHours',
  'handoffToHuman',
] as const;

export interface AgentRunInput {
  tenantId: string;
  conversationId: string;
  clientId: string;
  inputMessageId: string;
  triggerType: 'idle' | 'out_of_hours' | 'manual_resume';
  triggerMetadata: Record<string, unknown> | null;
}

export const AgentRunner = {
  run: async (input: AgentRunInput): Promise<void> => {
    const agentTurnId = randomUUID();
    await requestContextStorage.run(
      {
        requestId: agentTurnId,
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        agentTurnId,
      },
      async () => {
        await runInner(input, agentTurnId);
      },
    );
  },
};

// Acumuladores agregados ao longo do loop pra o agent_turn final.
interface RunAccumulators {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costCents: number;
  llmLatencyMs: number;
  llmCallsCount: number;
  toolCalls: ExecutedToolCall[];
  outputMessageIds: string[];
}

function newAccumulators(): RunAccumulators {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costCents: 0,
    llmLatencyMs: 0,
    llmCallsCount: 0,
    toolCalls: [],
    outputMessageIds: [],
  };
}

function extractToolUseBlocks(message: Message): ToolUseBlock[] {
  return message.content.filter(
    (b): b is ToolUseBlock => b.type === 'tool_use',
  );
}

function extractTextBlocks(message: Message): TextBlock[] {
  return message.content.filter((b): b is TextBlock => b.type === 'text');
}

function buildToolResultContent(call: ExecutedToolCall): string {
  // Anthropic SDK aceita string ou content blocks no tool_result. String é
  // suficiente pra payloads pequenos do nosso V1; futuramente (se algum
  // resultado for grande/binário) trocamos pra blocks estruturados.
  if (call.result === 'ok') {
    return JSON.stringify(call.resultPayload ?? { ok: true });
  }
  return JSON.stringify({ error: call.errorMessage ?? 'falha desconhecida' });
}

async function runInner(input: AgentRunInput, agentTurnId: string): Promise<void> {
  logger.info(
    { triggerType: input.triggerType },
    '[agentRunner] turn iniciado',
  );

  const startedAt = Date.now();
  const acc = newAccumulators();
  let runError: string | null = null;
  let handoffReason: string | null = null;
  let placeholderInserted = false;
  const promptVersion = 'conversational.v1';
  let modelUsed: string = env.agent.defaultModel;
  let ctx: ConversationContext | null = null;

  try {
    // 1) Contexto.
    ctx = await ContextBuilder.load(input.tenantId, input.conversationId);

    // 2) Pause check — abortado ANTES de inserir agent_turn. Sem custo de
    // IA, sem row vazia no banco (skip silencioso).
    if (ctx.pausedUntil && ctx.pausedUntil.getTime() > Date.now()) {
      logger.info(
        { pausedUntil: ctx.pausedUntil.toISOString() },
        '[agentRunner] skip — conversa pausada',
      );
      return;
    }

    // 3) Insert placeholder do agent_turn ANTES de tudo. Tools (especialmente
    // tagConversation) precisam linkar `assigned_by_agent_turn_id` pro FK
    // do row do turno — se inserissemos só no finally, FK violaria em runtime.
    await AgentTurnsRepo.createPlaceholder({
      id: agentTurnId,
      tenantId: input.tenantId,
      conversationId: input.conversationId,
      triggerType: input.triggerType,
      triggerMetadata: input.triggerMetadata,
      inputMessageId: input.inputMessageId,
      promptVersion,
      model: modelUsed,
    });
    placeholderInserted = true;

    // 4) Sem tags utilizáveis em conjunto com sem persona faz o prompt
    // ficar muito vago — mas seguimos: o modo conversational não exige tags.
    if (ctx.tags.length === 0) {
      logger.debug({}, '[agentRunner] tenant sem tags ativas — pulando tagging');
    }

    // 5) Prompt conversational.
    const prompt = PromptBuilder.conversational({
      tenantName: ctx.tenant.name,
      tenantPersona: ctx.tenant.agentPersona,
      tags: ctx.tags,
      procedures: ctx.procedures.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        defaultSessions: p.defaultSessions,
      })),
      client: {
        name: ctx.client.name,
        lastAppointmentSummary: null, // V1: contexto rico chega via getClientInfo tool
      },
      history: ctx.history,
    });
    // `prompt.promptVersion` deve bater com a const acima (mesmo modo). Se
    // futuramente o PromptBuilder retornar versão diferente do esperado,
    // disparamos um warn — placeholder já foi inserido com a versão correta.
    if (prompt.promptVersion !== promptVersion) {
      logger.warn(
        { expected: promptVersion, got: prompt.promptVersion },
        '[agentRunner] prompt.promptVersion divergente do placeholder',
      );
    }

    // 6) Tools (Anthropic SDK format).
    const toolDefs: ToolUnion[] = ToolRegistry.forNames(
      CONVERSATIONAL_TOOL_NAMES,
    ).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as {
        type: 'object';
        properties: Record<string, unknown>;
      },
    }));

    // 6) Loop tool_use → tool_result → next call.
    const messages: MessageParam[] = [...prompt.messages];
    const maxIterations = env.agent.maxToolIterations;
    let finalMessage: Message | null = null;

    for (let iter = 1; iter <= maxIterations; iter++) {
      const result = await createMessage({
        model: env.agent.defaultModel,
        maxTokens: 1024,
        system: prompt.system,
        tools: toolDefs,
        messages,
      });
      acc.inputTokens += result.usage.inputTokens;
      acc.outputTokens += result.usage.outputTokens;
      acc.cacheReadTokens += result.usage.cacheReadTokens;
      acc.cacheCreationTokens += result.usage.cacheCreationTokens;
      acc.costCents += result.costCents;
      acc.llmLatencyMs += result.latencyMs;
      acc.llmCallsCount += 1;
      modelUsed = result.message.model;

      const toolUses = extractToolUseBlocks(result.message);

      // end_turn ou response sem tool_use → enviar texto e sair.
      if (toolUses.length === 0 || result.message.stop_reason === 'end_turn') {
        finalMessage = result.message;
        break;
      }

      // Anexa o tool_use original (assistant) ANTES de processar os results.
      messages.push({
        role: 'assistant',
        content: result.message.content as ContentBlock[],
      });

      // Executa tools sequencialmente — simpler que paralelo, e tools
      // do PR 6 são leves (HTTP read + 1 DB write). Paralelizar quando
      // bench justificar.
      const toolHandlerCtx: ToolHandlerContext = {
        tenantId: input.tenantId,
        conversationId: input.conversationId,
        clientId: input.clientId,
        agentTurnId,
      };

      const toolResults: ToolResultBlockParam[] = [];
      for (const toolUse of toolUses) {
        const executed = await executeToolCall(
          { id: toolUse.id, name: toolUse.name, input: toolUse.input },
          toolHandlerCtx,
        );
        acc.toolCalls.push(executed);

        // handoffToHuman setou pausa — registra reason no turn.
        if (
          toolUse.name === 'handoffToHuman' &&
          executed.result === 'ok' &&
          typeof (executed.args as Record<string, unknown>).reason === 'string'
        ) {
          handoffReason = (executed.args as { reason: string }).reason;
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: buildToolResultContent(executed),
          is_error: executed.result === 'error',
        });
      }

      messages.push({ role: 'user', content: toolResults });

      // Última iteração consumida — força handoff se ainda não rolou e LLM
      // não fechou. Evita loop infinito e custo escalando.
      if (iter === maxIterations) {
        runError = `Atingido max iterations (${maxIterations}) sem end_turn`;
        logger.warn(
          { maxIterations },
          '[agentRunner] max iterations — force end',
        );
        if (!handoffReason) handoffReason = 'max_iterations_atingido';
      }
    }

    // 7) Envio das mensagens de texto da resposta final (se houve).
    if (finalMessage) {
      const textBlocks = extractTextBlocks(finalMessage);
      for (const block of textBlocks) {
        const trimmed = block.text.trim();
        if (trimmed.length === 0) continue;
        try {
          const sent = await ResponseDispatcher.sendText(
            input.tenantId,
            input.conversationId,
            trimmed,
          );
          acc.outputMessageIds.push(sent.id);
        } catch (err) {
          logger.error(
            { err: err instanceof Error ? err.message : err },
            '[agentRunner] falha ao enviar outbound',
          );
          // Sem re-throw: já estamos no fim, persistimos turn com erro parcial
          if (!runError) {
            runError = `Falha ao enviar outbound: ${
              err instanceof Error ? err.message : String(err)
            }`;
          }
          break;
        }
      }
    }
  } catch (err) {
    runError = err instanceof Error ? err.message : String(err);
    logger.error(
      { err: runError, stack: err instanceof Error ? err.stack : undefined },
      '[agentRunner] falha não tratada na rodada',
    );
  } finally {
    // 8) Extrai classificationTagIds da tool call de tagConversation se houver.
    const tagToolCall = acc.toolCalls.find(
      (c) => c.name === 'tagConversation' && c.result === 'ok',
    );
    const classificationTagIds =
      tagToolCall && Array.isArray(tagToolCall.args.tagIds)
        ? (tagToolCall.args.tagIds as string[])
        : null;

    const totalLatency = Date.now() - startedAt;

    // Finalize só se placeholder foi inserido. Skip por pausa ou erro
    // antes do placeholder = nada pra atualizar (sem row no DB).
    if (placeholderInserted) {
      try {
        await AgentTurnsRepo.finalize({
          id: agentTurnId,
          tenantId: input.tenantId,
          inputTokens: acc.inputTokens,
          outputTokens: acc.outputTokens,
          cacheReadTokens: acc.cacheReadTokens,
          cacheCreationTokens: acc.cacheCreationTokens,
          costCents: acc.costCents,
          latencyMs: totalLatency,
          toolCalls: acc.toolCalls,
          outputMessageIds:
            acc.outputMessageIds.length > 0 ? acc.outputMessageIds : null,
          classificationTagIds,
          handoffReason,
          error: runError,
        });
      } catch (err) {
        // Finalize falhar é catastrófico — placeholder fica no DB com
        // defaults, distorce relatórios. Log alto pra alarme.
        logger.error(
          {
            agentTurnId,
            err: err instanceof Error ? err.message : err,
          },
          '[agentRunner] CRÍTICO: finalize do agent_turn falhou — row fica como placeholder',
        );
      }
    }

    logger.info(
      {
        agentTurnId,
        totalLatencyMs: totalLatency,
        llmLatencyMs: acc.llmLatencyMs,
        llmCallsCount: acc.llmCallsCount,
        toolCallsCount: acc.toolCalls.length,
        costCents: acc.costCents,
        inputTokens: acc.inputTokens,
        outputTokens: acc.outputTokens,
        cacheReadTokens: acc.cacheReadTokens,
        outputMessagesCount: acc.outputMessageIds.length,
        appliedTagsCount: classificationTagIds?.length ?? 0,
        handoffReason,
        error: runError,
      },
      runError ? '[agentRunner] turn concluído com erro' : '[agentRunner] turn ok',
    );
  }
}
