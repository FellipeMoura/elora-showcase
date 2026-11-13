import type { z } from 'zod';

// =====================================================================
// Contratos das tools do agente.
//
// `inputSchema` é JSON Schema (object) que vai pra Anthropic SDK — o LLM
// vê esse shape pra decidir como chamar. `inputZod` é a versão Zod que
// VALIDAMOS o que o LLM produziu antes de chamar o handler — proteção
// contra alucinação de campos/tipos. As duas precisam descrever o mesmo
// formato; quando crescerem, geramos uma a partir da outra (zod →
// json-schema lib). Por ora coexistem manualmente.
// =====================================================================

export interface ToolHandlerContext {
  tenantId: string;
  conversationId: string;
  clientId: string;
  /**
   * UUID do agent_turn em curso, pré-gerado pelo AgentRunner. Passado pra
   * handlers que precisam linkar registros à origem (ex.: tagConversation
   * passa pra `conversation_tag_assignments.assigned_by_agent_turn_id`).
   */
  agentTurnId: string;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  /** JSON Schema (formato esperado pelo Anthropic SDK no campo `tools[].input_schema`). */
  inputSchema: object;
  /** Validador Zod usado dentro do executeToolCall. */
  inputZod: z.ZodType<I>;
  /** Handler que recebe input validado + contexto da rodada. */
  handler: (input: I, ctx: ToolHandlerContext) => Promise<O>;
}

// Tipo da row armazenada em `agent_turns.tool_calls` (jsonb array). Re-exportado
// aqui pra evitar dependência circular entre tools/ e conversations/.
export interface ExecutedToolCall {
  name: string;
  args: Record<string, unknown>;
  result: 'ok' | 'error';
  resultPayload?: unknown;
  errorMessage?: string;
  ms: number;
}
