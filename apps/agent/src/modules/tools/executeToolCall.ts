import { logger } from '../../shared/observability/logger.js';
import { ToolRegistry } from './ToolRegistry.js';
import type { ExecutedToolCall, ToolHandlerContext } from './types.js';

// Bloco tool_use vindo da Anthropic SDK. Re-declarado aqui pra evitar
// import circular do SDK no tipo da função (caller pode passar shape mínimo).
export interface ToolUseInvocation {
  id: string;
  name: string;
  input: unknown;
}

/**
 * Executa uma chamada de tool emitida pelo LLM:
 *   1. Resolve a tool no registry (falha estruturada se nome desconhecido).
 *   2. Valida o `input` via Zod (falha estruturada se shape errado).
 *   3. Chama o handler com `ctx`. Sucessos viram `{ result: 'ok', resultPayload }`.
 *      Exceções viram `{ result: 'error', errorMessage }` — NUNCA propagam.
 *
 * Retorno sempre é um `ExecutedToolCall` pronto pra:
 *   - empilhar em `agent_turns.tool_calls` (jsonb array)
 *   - mandar de volta pro LLM como tool_result no próximo turno
 *
 * Decisão "nunca lança": o AgentRunner precisa registrar TODA tentativa
 * mesmo quando o LLM alucina nome de tool ou input inválido — sem isso o
 * agent_turn sai com erro genérico sem rastro do que aconteceu.
 */
export async function executeToolCall(
  call: ToolUseInvocation,
  ctx: ToolHandlerContext,
): Promise<ExecutedToolCall> {
  const startedAt = Date.now();
  const args = (call.input as Record<string, unknown>) ?? {};

  const tool = ToolRegistry.get(call.name);
  if (!tool) {
    const errorMessage = `Tool '${call.name}' não registrada`;
    logger.warn(
      { tool: call.name, agentTurnId: ctx.agentTurnId },
      `[executeToolCall] ${errorMessage}`,
    );
    return {
      name: call.name,
      args,
      result: 'error',
      errorMessage,
      ms: Date.now() - startedAt,
    };
  }

  const parsed = tool.inputZod.safeParse(call.input);
  if (!parsed.success) {
    const errorMessage = `Input inválido: ${parsed.error.issues
      .map((i) => `${i.path.join('.') || '(root)'} - ${i.message}`)
      .join('; ')}`;
    logger.warn(
      {
        tool: call.name,
        agentTurnId: ctx.agentTurnId,
        issues: parsed.error.issues,
      },
      '[executeToolCall] input falhou validação Zod',
    );
    return {
      name: call.name,
      args,
      result: 'error',
      errorMessage,
      ms: Date.now() - startedAt,
    };
  }

  try {
    const output = await tool.handler(parsed.data, ctx);
    const ms = Date.now() - startedAt;
    logger.debug(
      {
        tool: call.name,
        agentTurnId: ctx.agentTurnId,
        ms,
      },
      '[executeToolCall] ok',
    );
    return {
      name: call.name,
      args,
      result: 'ok',
      resultPayload: output,
      ms,
    };
  } catch (err) {
    const ms = Date.now() - startedAt;
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(
      {
        tool: call.name,
        agentTurnId: ctx.agentTurnId,
        ms,
        err: errorMessage,
      },
      '[executeToolCall] handler lançou exceção',
    );
    return {
      name: call.name,
      args,
      result: 'error',
      errorMessage,
      ms,
    };
  }
}
