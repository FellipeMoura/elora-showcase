import Anthropic from '@anthropic-ai/sdk';
import type {
  Message,
  MessageCreateParamsNonStreaming,
  TextBlockParam,
  ToolUnion,
} from '@anthropic-ai/sdk/resources/messages';
import { env, type AgentSupportedModel } from '../../env.js';
import { logger } from '../observability/logger.js';
import { calculateCostCents, type TokenUsage } from './pricing.js';

// =====================================================================
// AnthropicClient — wrapper fino sobre o SDK oficial.
//
// Responsabilidades:
//   - Inicializar o cliente UMA vez (singleton) com creds do env.
//   - Marcar system + tools com `cache_control: { type: 'ephemeral' }`
//     transparentemente. AgentRunner passa system/tools normalmente;
//     a marcação acontece aqui pra não duplicar lógica em cada call site.
//   - Retentar erros transientes (429, 5xx, 529 overloaded) com backoff
//     exponencial. SDK já retenta network errors; isto cobre HTTP-level.
//   - Extrair usage + calcular custo em cents USD na hora.
//   - Log estruturado de cada chamada (turn id, model, tokens, custo, ms).
//
// Não-responsabilidades (vivem fora):
//   - Loop de tool_use → tool_result → next call (AgentRunner.run, PR 5)
//   - Persistência em agent_turns (AgentTurnsRepo, PR 5)
//   - Decisão de qual modelo usar (caller passa)
// =====================================================================

let singleton: Anthropic | null = null;

function getClient(): Anthropic {
  if (singleton) return singleton;
  singleton = new Anthropic({
    apiKey: env.anthropic.apiKey,
    ...(env.anthropic.baseUrl ? { baseURL: env.anthropic.baseUrl } : {}),
    // SDK faz retry interno só pra network errors (ECONNRESET etc.) — nosso
    // wrapper cobre HTTP-level (429, 529, 5xx). Setar 0 aqui delega tudo
    // pro nosso retry e dá controle único do backoff/log.
    maxRetries: 0,
  });
  return singleton;
}

// Erros HTTP-level que vale a pena retentar. 529 = Overloaded (Anthropic
// específico). 5xx genéricos. 408 timeout do upstream. 429 só com Retry-After
// — sem o header, espera nosso backoff padrão.
const RETRIABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504, 529]);

interface RetriableError extends Error {
  status?: number;
}

function isRetriable(err: unknown): err is RetriableError {
  if (!(err instanceof Error)) return false;
  const status = (err as RetriableError).status;
  if (typeof status === 'number' && RETRIABLE_STATUSES.has(status)) return true;
  // SDK lança APIConnectionError sem status pra falhas de network — não
  // chega aqui (SDK já retentou), mas mantemos defensivo.
  const name = err.name;
  return name === 'APIConnectionError' || name === 'APIConnectionTimeoutError';
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// =====================================================================
// Cache control helpers
// =====================================================================
// Anthropic aceita `cache_control: { type: 'ephemeral' }` em até 4 blocos
// por request (system + tools combinados). Cache TTL = 5 minutos a partir
// da última chamada que hit/criou a entrada — perfeito pra agente que
// roda vários turnos do mesmo tenant em sequência.
//
// Marcamos automaticamente:
//   1. Último bloco do system (cabe quase sempre num único bloco grande)
//   2. Último tool definition (cobre o array inteiro pra cache key)
// Se caller já passou system/tools com cache_control próprio, respeitamos.

function ensureSystemCached(
  system: string | TextBlockParam[] | undefined,
): TextBlockParam[] | undefined {
  if (!system) return undefined;
  // SDK aceita string OU array de blocos; normalizamos pra array sempre,
  // pra poder cravar cache_control no último bloco.
  const blocks: TextBlockParam[] =
    typeof system === 'string'
      ? [{ type: 'text', text: system }]
      : system.map((b) => ({ ...b }));
  if (blocks.length === 0) return blocks;
  const last = blocks[blocks.length - 1]!;
  if (!last.cache_control) {
    last.cache_control = { type: 'ephemeral' };
  }
  return blocks;
}

function ensureToolsCached(tools: ToolUnion[] | undefined): ToolUnion[] | undefined {
  if (!tools || tools.length === 0) return tools;
  const out = tools.map((t) => ({ ...t }));
  const last = out[out.length - 1]!;
  // Cast: ToolUnion union de variantes; cache_control é aceito por todas
  // mas o tipo da union não expõe diretamente — annotation é seguro.
  const lastWithCache = last as ToolUnion & {
    cache_control?: { type: 'ephemeral' };
  };
  if (!lastWithCache.cache_control) {
    lastWithCache.cache_control = { type: 'ephemeral' };
  }
  return out;
}

// =====================================================================
// API pública
// =====================================================================

export interface CreateMessageResult {
  /** Resposta crua do SDK pra caller inspecionar content blocks. */
  message: Message;
  /** Usage normalizado (cache_creation/read podem vir undefined no SDK). */
  usage: TokenUsage;
  /** Custo em cents USD (4 casas decimais). */
  costCents: number;
  /** Latência total do call (incluindo retries) em ms. */
  latencyMs: number;
  /** Quantas tentativas até obter a resposta (1 = primeiro try). */
  attempts: number;
}

interface CreateMessageInput
  extends Omit<MessageCreateParamsNonStreaming, 'model' | 'max_tokens' | 'stream'> {
  /** Override do modelo. Default = env.agent.defaultModel. */
  model?: AgentSupportedModel;
  /** Override de max_tokens. Default = env.anthropic.defaultMaxTokens. */
  maxTokens?: number;
}

/**
 * Chama Anthropic Messages API com:
 *   - cache_control automático no system + tools (se caller não passou)
 *   - retry exponencial pra erros transientes
 *   - cálculo de custo e log estruturado
 *
 * Caller (AgentRunner) é responsável pelo loop de tool_use; este wrapper
 * é uma chamada única.
 */
export async function createMessage(
  input: CreateMessageInput,
): Promise<CreateMessageResult> {
  const client = getClient();
  // Destructure pra tirar nossos campos custom (camelCase) do payload — Anthropic
  // valida shape estrito e rejeita 400 em qualquer extra field. Sem isso,
  // `maxTokens` vazaria pela API junto com `max_tokens`.
  const { model: modelOverride, maxTokens: maxTokensOverride, ...rest } = input;
  const model = modelOverride ?? env.agent.defaultModel;
  const maxTokens = maxTokensOverride ?? env.anthropic.defaultMaxTokens;
  const maxAttempts = env.anthropic.maxRetries + 1; // env.maxRetries = retentativas; total = +1

  const params: MessageCreateParamsNonStreaming = {
    ...rest,
    model,
    max_tokens: maxTokens,
    system: ensureSystemCached(rest.system),
    tools: ensureToolsCached(rest.tools),
  };

  const startedAt = Date.now();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const message = await client.messages.create(params);
      const latencyMs = Date.now() - startedAt;

      // SDK pode omitir cache_* fields quando 0 — normalizamos pra number sempre.
      const usage: TokenUsage = {
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
        cacheCreationTokens: message.usage.cache_creation_input_tokens ?? 0,
      };
      const costCents = calculateCostCents(model, usage);

      logger.debug(
        {
          model,
          attempts: attempt,
          latencyMs,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cacheReadTokens: usage.cacheReadTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          costCents,
          stopReason: message.stop_reason,
        },
        '[anthropic] createMessage ok',
      );

      return { message, usage, costCents, latencyMs, attempts: attempt };
    } catch (err) {
      lastErr = err;
      if (!isRetriable(err) || attempt === maxAttempts) {
        const latencyMs = Date.now() - startedAt;
        logger.error(
          {
            model,
            attempts: attempt,
            latencyMs,
            err: err instanceof Error ? err.message : String(err),
            status: (err as RetriableError | undefined)?.status,
          },
          '[anthropic] createMessage falhou — sem retry',
        );
        throw err;
      }

      // Backoff exponencial com jitter: 250ms, 500ms, 1000ms (+ até 250ms jitter).
      const backoffMs = 250 * 2 ** (attempt - 1) + Math.floor(Math.random() * 250);
      logger.warn(
        {
          model,
          attempt,
          backoffMs,
          status: (err as RetriableError).status,
          err: err instanceof Error ? err.message : String(err),
        },
        '[anthropic] erro transiente — retentando',
      );
      await sleep(backoffMs);
    }
  }

  // Inalcançável (loop sempre retorna ou throws), mas TS exige.
  throw lastErr;
}

/**
 * Smoke test do client — usado pelo endpoint admin /agent/diagnostics.
 * Faz uma chamada mínima ao Haiku pra validar que API key + conexão funcionam.
 * NÃO use em hot path: cada call custa ~$0.001 e ~1s de latência.
 */
export async function pingAnthropic(): Promise<{
  ok: boolean;
  model: string;
  latencyMs: number;
  costCents: number;
  error?: string;
}> {
  try {
    const result = await createMessage({
      model: env.agent.fastModel,
      maxTokens: 8,
      messages: [{ role: 'user', content: 'ping' }],
    });
    return {
      ok: true,
      model: env.agent.fastModel,
      latencyMs: result.latencyMs,
      costCents: result.costCents,
    };
  } catch (err) {
    return {
      ok: false,
      model: env.agent.fastModel,
      latencyMs: 0,
      costCents: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
