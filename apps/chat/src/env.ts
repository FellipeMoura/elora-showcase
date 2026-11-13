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
  port: Number(optional('CHAT_PORT', '5502')),
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
    host: optional('REDIS_HOST', 'localhost'),
    port: Number(optional('REDIS_PORT', '6379')),
  },

  // MinIO — storage de mídia (fotos, áudios, vídeos, documentos, stickers,
  // foto de perfil). URLs do Evolution/Baileys são efêmeras (expiram em
  // horas), então toda mídia recebida é re-uploaded aqui e toda mídia enviada
  // passa por aqui primeiro. Em prod, troca pra S3 mantendo a interface.
  // `publicUrl` é a URL base que o cliente HTTP usa pra baixar via presigned
  // — em dev é o próprio MinIO no host (localhost:9000); em prod, atrás de
  // CDN/proxy se necessário.
  minio: {
    // Endpoint pra operações server-side (upload, download, putObject).
    // O backend chat fala com MinIO usando esse host. Em dev rodando no
    // próprio host: `localhost`; em docker-compose interno: `minio` (nome
    // do serviço).
    endPoint: optional('MINIO_ENDPOINT', 'localhost'),
    port: Number(optional('MINIO_PORT', '9000')),
    useSSL: optional('MINIO_USE_SSL', 'false') === 'true',
    accessKey: required('MINIO_ACCESS_KEY'),
    secretKey: required('MINIO_SECRET_KEY'),
    // Bucket único pra mídia de WhatsApp — paths são namespaced por tenant:
    // {tenantId}/{channelId}/{yyyy}/{mm}/{dd}/{externalId}-{filename}.
    bucket: optional('MINIO_WHATSAPP_MEDIA_BUCKET', 'whatsapp-media'),
    // Região fixa nos clientes (presign sem chamada de rede). Default do
    // MinIO e aceito pelo S3/R2; trocar se o servidor tiver MINIO_REGION.
    region: optional('MINIO_REGION', 'us-east-1'),
    // TTL do presigned URL devolvido pro frontend (segundos). 7 dias deixa
    // mensagens recentes ficarem cacheáveis no browser sem precisar re-pedir.
    presignedUrlTtlSec: Number(optional('MINIO_PRESIGNED_TTL_SEC', '604800')),
    // Endpoint das presigned URLs que o BROWSER abre (foto de perfil,
    // mídia recebida, preview de upload). Em dev: `localhost`. Em prod:
    // hostname público do S3/MinIO. Default = endpoint server-side.
    publicEndPoint: optional(
      'MINIO_PUBLIC_ENDPOINT',
      optional('MINIO_ENDPOINT', 'localhost'),
    ),
    publicPort: Number(
      optional('MINIO_PUBLIC_PORT', optional('MINIO_PORT', '9000')),
    ),
    publicUseSSL:
      optional(
        'MINIO_PUBLIC_USE_SSL',
        optional('MINIO_USE_SSL', 'false'),
      ) === 'true',
    // Endpoint das presigned URLs que o PROVIDER baixa (Evolution puxando a
    // mídia de um envio). Separado do público porque em dev o Evolution
    // roda em container: `localhost` lá dentro é o próprio container, e
    // `host.docker.internal` resolve certo no container (extra_hosts) mas
    // no Windows depende do arquivo hosts, que fica com IP velho. Default =
    // endpoint público (prod: mesma URL pública pros dois).
    providerEndPoint: optional(
      'MINIO_PROVIDER_ENDPOINT',
      optional('MINIO_PUBLIC_ENDPOINT', optional('MINIO_ENDPOINT', 'localhost')),
    ),
    providerPort: Number(
      optional(
        'MINIO_PROVIDER_PORT',
        optional('MINIO_PUBLIC_PORT', optional('MINIO_PORT', '9000')),
      ),
    ),
    providerUseSSL:
      optional(
        'MINIO_PROVIDER_USE_SSL',
        optional('MINIO_PUBLIC_USE_SSL', optional('MINIO_USE_SSL', 'false')),
      ) === 'true',
  },

  jwt: {
    // JWT é compartilhado com o core — mesmo segredo, mesma chave de assinatura.
    secret: required('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '7d'),
  },

  // Header X-Internal-Auth — usado por core e chat pra autenticar requests
  // service-to-service (ver arquitetura.md §13.2).
  internalApiSecret: required('INTERNAL_API_SECRET'),
  coreInternalUrl: optional('CORE_INTERNAL_URL', 'http://localhost:5501'),

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

  // Evolution API — gateway WhatsApp (ver arquitetura.md §7).
  // - baseUrl: como o backend chat fala com Evolution. Em dev, host expõe :5503;
  //   em prod, URL interna do cluster.
  // - apiKey: master key global (AUTHENTICATION_API_KEY do container) — usada
  //   pra criar/destruir instâncias via EvolutionAdmin. Cada instância criada
  //   gera seu próprio token que vira `provider_config.apiKey` do canal.
  // - webhookBaseUrl: URL que o Evolution chama de volta com eventos. Tem que
  //   ser acessível DE DENTRO do container Evolution; em dev (apps no host),
  //   `host.docker.internal:5502` resolve pro host. Em prod, URL pública.
  evolution: {
    baseUrl: optional('EVOLUTION_BASE_URL', 'http://localhost:5503'),
    apiKey: required('EVOLUTION_API_KEY'),
    webhookBaseUrl: optional(
      'WHATSAPP_WEBHOOK_BASE_URL',
      'http://host.docker.internal:5502',
    ),
  },
} as const;

export const isDev = env.nodeEnv === 'development';
export const isProd = env.nodeEnv === 'production';
