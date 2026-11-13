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

export const env = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: Number(optional('CORE_PORT', '5501')),
  appVersion: optional('APP_VERSION', Date.now().toString()),
  // Em dev, default = log enxuto (one-liner por request). LOG_VERBOSE=true
  // mantém os payloads completos de req/res (headers, query, params).
  logVerbose: optional('LOG_VERBOSE', 'false') === 'true',

  database: {
    // App conecta como role no-bypassrls. Admin/migrations usam DATABASE_USER.
    host: required('DATABASE_HOST'),
    port: Number(required('DATABASE_PORT')),
    user: required('DATABASE_APP_USER'),
    password: required('DATABASE_APP_PASSWORD'),
    database: required('DATABASE_NAME'),
  },

  redis: {
    // Mesma instância usada pelo chat. Core consome só pub/sub (eventos
    // canônicos vindos do chat repassados pros sockets) — não tem fila
    // própria por ora.
    host: optional('REDIS_HOST', 'localhost'),
    port: Number(optional('REDIS_PORT', '6379')),
  },

  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '7d'),
  },

  // Em prod: '.elora.app.br' faz o cookie ser enviado pra *.elora.app.br
  // (browser em `main.elora.app.br` envia cookie pra `api.elora.app.br`
  // e `chat.elora.app.br`). Em dev: vazio = cookie scoped no host atual,
  // que ja resolve same-origin (frontend e backend em <slug>.localhost).
  cookieDomain: process.env.COOKIE_DOMAIN ?? null,

  // CORS — ver shared/http/cors.ts. `appDomain` libera o domínio do produto
  // e os subdomínios de tenant; `extraOrigins` é a escotilha pra origens que
  // não seguem esse padrão (staging, app mobile, ferramenta interna).
  cors: {
    appDomain: optional('APP_DOMAIN', 'elora.app.br'),
    extraOrigins: (process.env.CORS_EXTRA_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  },

  sentry: {
    dsn: process.env.SENTRY_DSN ?? null,
    tracesSampleRate: Number(optional('SENTRY_TRACES_SAMPLE_RATE', '0.1')),
  },

  // Storage S3-compatível (MinIO em dev opt-in, Cloudflare R2 em prod) — usado
  // pelo módulo contracts pra persistir PDFs assinados puxados via webhook do
  // ZapSign. Opt-in: quando `accessKey`/`secretKey` ausentes, helper retorna
  // `isConfigured=false` e callers degradam pra fallback (baixar do ZapSign
  // sob demanda). Reaproveita MINIO_* do .env compartilhado com apps/chat —
  // bucket é separado (default `contracts`) pra governança independente da
  // mídia de WhatsApp.
  storage: {
    endPoint: optional('MINIO_ENDPOINT', 'localhost'),
    port: Number(optional('MINIO_PORT', '9000')),
    useSSL: optional('MINIO_USE_SSL', 'false') === 'true',
    accessKey: process.env.MINIO_ACCESS_KEY ?? null,
    secretKey: process.env.MINIO_SECRET_KEY ?? null,
    // Bucket separado da mídia de WhatsApp — paths namespaced por tenant:
    // {tenantId}/{yyyy}/{mm}/{contractId}.pdf.
    contractsBucket: optional('CONTRACTS_BUCKET', 'contracts'),
    // TTL do presigned GET devolvido pra UI baixar o PDF. 1h é suficiente —
    // o link costuma ser clicado na hora; refresh = nova chamada ao backend.
    presignedUrlTtlSec: Number(optional('CONTRACTS_PRESIGNED_TTL_SEC', '3600')),
    // Bucket pra atestados de presença (foto WebP + assinatura SVG). Mesmo
    // S3 client, separação só pra governança (TTL/lifecycle independente).
    attendancesBucket: optional('ATTENDANCES_BUCKET', 'attendances'),
    // Bucket "guarda-chuva" pra mídia genérica do core — hoje só logo de
    // tenant, futuramente attachments polimórficos (imagens de orçamento,
    // fotos de procedimento, docs anexos). Prefixo por domínio no objectKey
    // (`tenants/{tenantId}/logo{ext}`) mantém organização sem multiplicar
    // buckets. Bucket separado de contracts/attendances porque governança
    // (retention, público-alvo) é diferente.
    mediaBucket: optional('MEDIA_BUCKET', 'elora-media'),
    // TTL do presigned GET pra mídia (logos + attachments futuros).
    // 1h é curto o suficiente pra não vazar links e longo o suficiente pra
    // uma sessão de UI. Callback: se a UI cachear a URL além disso, quebra
    // no reload — solução é re-consultar o endpoint, não subir o TTL.
    mediaPresignedTtlSec: Number(optional('MEDIA_PRESIGNED_TTL_SEC', '3600')),
  },

  // ZapSign — provider de assinatura eletrônica (módulo contracts).
  // Conta única da Elora servindo todos os tenants. Token rotacionado no
  // painel deles → Integrações → API ZapSign → "Renovar Token".
  // Quando `apiToken` vazio, o módulo contracts ainda inicializa mas qualquer
  // operação de envio falha 503 — permite subir o backend sem ZapSign provisionado.
  //
  // Ambiente é decidido pelo subdomínio em apiBaseUrl:
  //   - https://api.zapsign.com.br/api/v1         → produção (requer Plano de API)
  //   - https://sandbox.api.zapsign.com.br/api/v1 → sandbox (gratuito, sem validade jurídica)
  // Default = produção pra evitar surpresa (esquecer de mudar antes do deploy).
  // Em dev, override pra sandbox no .env local.
  zapsign: {
    apiToken: process.env.ZAPSIGN_API_TOKEN ?? null,
    apiBaseUrl: optional('ZAPSIGN_API_BASE_URL', 'https://api.zapsign.com.br/api/v1'),
    // Secret nosso (gerado via openssl rand -hex 32) cadastrado no painel
    // de Webhooks da ZapSign como header X-Elora-Webhook-Token. Sem ele
    // configurado, verifyWebhook aceita qualquer payload — só pra dev.
    webhookToken: process.env.ZAPSIGN_WEBHOOK_TOKEN ?? null,
  },

  // Web Push (notificação do sistema quando chega mensagem no chat) — ver
  // modules/pushSubscriptions. Par VAPID gerado UMA vez por ambiente
  // (`npx web-push generate-vapid-keys`); trocar invalida todas as
  // assinaturas. Opt-in: sem as chaves, endpoints respondem 501 e nada é
  // enviado. `subject` é o contato que o serviço de push usa em abuso.
  push: {
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || null,
    vapidSubject: optional('VAPID_SUBJECT', 'mailto:suporte@example.com'),
  },
} as const;

export const isDev = env.nodeEnv === 'development';
export const isProd = env.nodeEnv === 'production';
