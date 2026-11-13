import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Variável ${name} esperava número, recebeu "${raw}"`);
  }
  return parsed;
}

// Modelos suportados na V1 — só os dois Anthropic. Adicionar provider novo
// (Bedrock, Vertex, OpenAI fallback) exige migration de schema + nova entrada
// na pricing table + cliente novo. Por ora hard-coded.
const SUPPORTED_MODELS = ['claude-sonnet-4-6', 'claude-haiku-4-5'] as const;
type SupportedModel = (typeof SUPPORTED_MODELS)[number];

function modelFromEnv(name: string, fallback: SupportedModel): SupportedModel {
  const raw = process.env[name] ?? fallback;
  if (!(SUPPORTED_MODELS as readonly string[]).includes(raw)) {
    throw new Error(
      `Variável ${name}: modelo "${raw}" não suportado. Aceitos: ${SUPPORTED_MODELS.join(', ')}`,
    );
  }
  return raw as SupportedModel;
}

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('AGENT_PORT', '5504')),
  appVersion: optional('APP_VERSION', Date.now().toString()),
  logVerbose: optional('LOG_VERBOSE', 'false') === 'true',

  database: {
    host: required('DATABASE_HOST'),
    port: Number(required('DATABASE_PORT')),
    user: required('DATABASE_APP_USER'),
    password: required('DATABASE_APP_PASSWORD'),
    database: required('DATABASE_NAME'),
  },

  redis: {
    host: optional('REDIS_HOST', 'localhost'),
    port: Number(optional('REDIS_PORT', '6379')),
  },

  jwt: {
    // JWT compartilhado com o core (mesmo segredo). Agente assina token
    // efêmero pra cada chamada de tool no core (ver PR 3 — HttpCoreClient.jwt).
    secret: required('JWT_SECRET'),
    // Janela curta — token só vive entre AgentRunner.run() e a última call
    // de tool. 60s é folga confortável; tools individuais demoram <2s.
    expiresInSec: optionalNumber('AGENT_JWT_EXPIRES_SEC', 60),
  },

  // URL base do apps/core pra chamadas internas do CoreClient. Em dev local,
  // chat e core falam por http://localhost; em prod, URL interna do cluster.
  // Note que CoreClient usa esse URL + Host header sintético `<slug>.localhost`
  // (ou prod equivalente) pra disparar tenantContextMiddleware do core.
  coreBaseUrl: optional('CORE_INTERNAL_URL', 'http://localhost:5501'),

  // URL base do apps/chat. Usado pela tool `sendMessage` (PR 6+) — agente
  // dispara outbound chamando `POST /conversations/:id/messages` em chat.
  chatBaseUrl: optional('CHAT_INTERNAL_URL', 'http://localhost:5502'),

  // Hostname base pra montar o Host header sintético quando o CoreClient/
  // ChatClient chama core/chat. Em dev: `localhost` (browsers e Node
  // resolvem `<slug>.localhost` pra 127.0.0.1 nativamente). Em prod:
  // `elora.app.br` (gera `<slug>.elora.app.br`).
  internalHostBase: optional('AGENT_INTERNAL_HOST_BASE', 'localhost'),

  sentry: {
    dsn: process.env.SENTRY_DSN ?? null,
    tracesSampleRate: Number(optional('SENTRY_TRACES_SAMPLE_RATE', '0.1')),
  },

  // =====================================================================
  // Agente IA
  // =====================================================================
  agent: {
    // Kill switch global — quando true, NENHUM tenant tem agente rodando,
    // independente de tenants.agent_enabled. Liga em prod só depois de smoke
    // test (default true até go-live no PR 10). Mudança requer restart do
    // apps/agent: triggers checam essa flag no boot e em cada job, mas o
    // worker BullMQ é a fonte da verdade — restart garante que nenhum job
    // em vôo passe da checagem.
    globalKillSwitch: optional('AGENT_GLOBAL_KILL_SWITCH', 'true') === 'true',

    // Modelo padrão pro raciocínio principal (loop conversacional).
    defaultModel: modelFromEnv('AGENT_DEFAULT_MODEL', 'claude-sonnet-4-6'),

    // Modelo "barato" — reservado pra tarefas de classificação ou triage
    // rápida (PR 5+ pode usar). Não obrigatório usar; defaults seguros.
    fastModel: modelFromEnv('AGENT_FAST_MODEL', 'claude-haiku-4-5'),

    // Limite hard do loop de tools dentro de UMA chamada do AgentRunner.
    // Atingir o limite força handoffToHuman automático (PR 5+).
    maxToolIterations: optionalNumber('AGENT_MAX_TOOL_ITERATIONS', 5),

    // Rate limits por conversation (Redis-based, implementado em PR 10).
    // Documentados aqui pra centralizar a config — workers leem `env.agent`.
    rateLimitHourly: optionalNumber('AGENT_RATE_LIMIT_HOURLY', 10),
    rateLimitDaily: optionalNumber('AGENT_RATE_LIMIT_DAILY', 50),
    // Hard cap de custo diário por tenant em cents USD (R$ 5000 ≈ R$ 25/dia
    // ao câmbio 5.0). PR 10 implementa o gate; valor pode crescer por tenant
    // depois (campo dedicado em tenants quando virar dor).
    tenantDailyCostCapCents: optionalNumber('AGENT_TENANT_DAILY_COST_CAP_CENTS', 5000),
  },

  // Anthropic — credenciais e config do provider.
  anthropic: {
    // Chave precisa estar setada mesmo quando killSwitch=true: faz parte do
    // smoke test de boot (boot falha cedo se chave fraltar, em vez de
    // descobrir só quando primeiro job rodar).
    apiKey: required('ANTHROPIC_API_KEY'),
    // baseURL: usado pra apontar pra proxy/observability layer (Helicone,
    // Langfuse proxy). Vazio = SDK usa o default https://api.anthropic.com.
    baseUrl: process.env.ANTHROPIC_BASE_URL ?? null,
    // Quantas tentativas antes de marcar a chamada como falha terminal.
    // SDK já retenta network errors transparentemente; isso aqui é nosso
    // wrapper retentando erros não-recuperáveis-pra-SDK (ex.: 529 overloaded).
    maxRetries: optionalNumber('ANTHROPIC_MAX_RETRIES', 3),
    // Default max_tokens da resposta — pra evitar resposta longa demais
    // pro contexto WhatsApp (mensagens grandes quebram pior). 1024 cabe
    // 2-3 parágrafos com folga.
    defaultMaxTokens: optionalNumber('ANTHROPIC_DEFAULT_MAX_TOKENS', 1024),
  },
} as const;

export type AgentSupportedModel = SupportedModel;

export const isDev = env.nodeEnv === 'development';
export const isProd = env.nodeEnv === 'production';
