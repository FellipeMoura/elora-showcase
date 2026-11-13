import type { AgentSupportedModel } from '../../env.js';

// =====================================================================
// Tabela de preços Anthropic — USD por 1M tokens.
// =====================================================================
// Valores em junho/2026. Atualizar quando Anthropic mudar tabela (ver
// https://www.anthropic.com/pricing#api). Cache pricing segue a regra
// padrão da Anthropic:
//   - Cache READ (hit) = 10% do preço de input normal
//   - Cache CREATION (miss, primeira chamada) = 125% do preço de input
//
// Por que separar 4 colunas: o billing real distingue cache_read de
// cache_creation no campo `usage` da resposta. Replicar aqui evita drift
// silencioso quando alguma chamada bate em cache miss inesperado.
//
// Custo total = (input * inputPerMtok + output * outputPerMtok +
//                cache_read * cacheReadPerMtok + cache_creation * cacheCreationPerMtok)
//                / 1_000_000

interface ModelPricing {
  /** USD por 1M input tokens (input "novo", sem cache). */
  inputPerMtok: number;
  /** USD por 1M output tokens. */
  outputPerMtok: number;
  /** USD por 1M cache READ tokens (hit, ephemeral 5min TTL). */
  cacheReadPerMtok: number;
  /** USD por 1M cache CREATION tokens (miss, primeira call que popula). */
  cacheCreationPerMtok: number;
}

export const ANTHROPIC_PRICING: Record<AgentSupportedModel, ModelPricing> = {
  'claude-sonnet-4-6': {
    inputPerMtok: 3.0,
    outputPerMtok: 15.0,
    cacheReadPerMtok: 0.3, // 10% de input
    cacheCreationPerMtok: 3.75, // 125% de input
  },
  'claude-haiku-4-5': {
    inputPerMtok: 1.0,
    outputPerMtok: 5.0,
    cacheReadPerMtok: 0.1,
    cacheCreationPerMtok: 1.25,
  },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/**
 * Calcula o custo em cents USD (com 4 casas decimais de precisão pra não
 * perder fração em chamadas baratas — ex: 0.0123 cents).
 *
 * O valor retornado bate com a coluna `agent_turns.cost_cents`
 * (decimal(10,4)). Conversão pra BRL é responsabilidade da camada de
 * relatório (taxa de câmbio depende da data e fica fora deste módulo).
 */
export function calculateCostCents(
  model: AgentSupportedModel,
  usage: TokenUsage,
): number {
  const pricing = ANTHROPIC_PRICING[model];
  const costUsd =
    (usage.inputTokens * pricing.inputPerMtok +
      usage.outputTokens * pricing.outputPerMtok +
      usage.cacheReadTokens * pricing.cacheReadPerMtok +
      usage.cacheCreationTokens * pricing.cacheCreationPerMtok) /
    1_000_000;

  // Round pra 4 casas decimais de cents pra evitar floats longos no DB.
  // Math.round(x * 10000) / 10000 cobre o suficiente sem libs extra.
  return Math.round(costUsd * 100 * 10_000) / 10_000;
}
