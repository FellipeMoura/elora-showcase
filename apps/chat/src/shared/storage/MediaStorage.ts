import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { env } from '../../env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../observability/logger.js';
import { safeObjectName } from './safeObjectName.js';
import {
  ensureWhatsappBucket,
  minioClient,
  providerMinioClient,
  publicMinioClient,
} from './minioClient.js';

// =====================================================================
// MediaStorage — fachada única pra mídia de WhatsApp.
//
// Por que existir:
//   - URLs de mídia do Evolution/Baileys são efêmeras (links assinados pelo
//     próprio WhatsApp, expiram em horas). Sem persistência, histórico de
//     mídia quebra silenciosamente algumas horas depois.
//   - Frontend não pode receber credencial MinIO. Tudo passa por backend que
//     devolve presigned URL com TTL controlado.
//
// Layout de paths (objectKey):
//   {tenantId}/{channelId}/{yyyy}/{mm}/{dd}/{externalId}-{filename}
// =====================================================================

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50MB — limite generoso pro WhatsApp (~16MB hard cap real).

export interface UploadResult {
  // Object key dentro do bucket (NÃO é URL — é o caminho relativo).
  // Guardamos isso em `messages.media_url` em vez do presigned: presigned tem
  // TTL curto e não vale armazenar; gerar on-demand é mais simples e seguro.
  objectKey: string;
  size: number;
  mimeType: string;
}

export interface PersistInboundMediaInput {
  tenantId: string;
  channelId: string;
  externalId: string;
  sourceUrl: string;
  mimeType: string | undefined;
  filename?: string;
}

// Variante que recebe buffer pronto (Evolution descriptografa via
// `getBase64FromMediaMessage`). Caller passa o Buffer + mimeType corretos —
// pulamos o download externo e o risco de baixar bytes cifrados do `.enc`
// do WhatsApp.
export interface PersistInboundMediaBufferInput {
  tenantId: string;
  channelId: string;
  externalId: string;
  buffer: Buffer;
  mimeType: string;
  filename?: string;
}

export interface UploadOutboundInput {
  tenantId: string;
  channelId: string;
  buffer: Buffer;
  mimeType: string;
  originalFilename: string;
}

export interface PersistProfilePictureInput {
  tenantId: string;
  channelId: string;
  contactId: string;
  sourceUrl: string;
}

export const MediaStorage = {
  // Baixa mídia de uma URL externa (Evolution) e persiste no MinIO. Retorna
  // o objectKey que vai pra `messages.media_url`. Idempotente por externalId
  // — se objectKey já existe, retorna o existente sem re-baixar.
  persistInboundMedia: async (
    input: PersistInboundMediaInput,
  ): Promise<UploadResult> => {
    await ensureWhatsappBucket();

    const objectKey = buildObjectKey({
      tenantId: input.tenantId,
      channelId: input.channelId,
      externalId: input.externalId,
      filename: input.filename ?? guessFilenameFromUrl(input.sourceUrl) ?? 'media',
    });

    // Curto-circuito de idempotência: se já gravamos esse objectKey antes
    // (retry do job), pula o download. statObject lança quando não existe.
    const existing = await minioClient
      .statObject(env.minio.bucket, objectKey)
      .catch(() => null);
    if (existing) {
      return {
        objectKey,
        size: existing.size,
        mimeType: input.mimeType ?? existing.metaData?.['content-type'] ?? 'application/octet-stream',
      };
    }

    // 60s de timeout pra mídia grande em conexão lenta. Evolution + WhatsApp
    // costuma servir rápido (CDN), mas vídeos de 16MB em rede ruim podem
    // exigir margem extra.
    const res = await fetch(input.sourceUrl, {
      signal: AbortSignal.timeout(60_000),
    }).catch((err) => {
      throw new AppError(
        `Falha ao baixar mídia (${input.sourceUrl}): ${err instanceof Error ? err.message : err}`,
        502,
      );
    });

    if (!res.ok) {
      throw new AppError(
        `Mídia retornou ${res.status} em ${input.sourceUrl}`,
        502,
      );
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new AppError(
        `Mídia maior que ${MAX_DOWNLOAD_BYTES} bytes — rejeitada`,
        413,
      );
    }

    const mimeType =
      input.mimeType ??
      res.headers.get('content-type') ??
      'application/octet-stream';

    await minioClient.putObject(
      env.minio.bucket,
      objectKey,
      buffer,
      buffer.byteLength,
      { 'Content-Type': mimeType },
    );

    logger.debug(
      {
        tenantId: input.tenantId,
        channelId: input.channelId,
        externalId: input.externalId,
        objectKey,
        size: buffer.byteLength,
      },
      '[MediaStorage] mídia inbound persistida',
    );

    return { objectKey, size: buffer.byteLength, mimeType };
  },

  // Variante usada quando o caller JÁ tem o buffer decodificado (Evolution
  // descriptografa via fetchInboundMediaBuffer). Mesma idempotência por
  // objectKey, mas pula o fetch externo. Caminho preferido pra mídia
  // inbound do WhatsApp — `persistInboundMedia(sourceUrl)` ainda existe
  // como fallback pra providers que não descriptografam (mock).
  persistInboundMediaBuffer: async (
    input: PersistInboundMediaBufferInput,
  ): Promise<UploadResult> => {
    await ensureWhatsappBucket();

    const objectKey = buildObjectKey({
      tenantId: input.tenantId,
      channelId: input.channelId,
      externalId: input.externalId,
      filename: input.filename ?? `media-${input.externalId}`,
    });

    // Curto-circuito de idempotência (BullMQ retry safe).
    const existing = await minioClient
      .statObject(env.minio.bucket, objectKey)
      .catch(() => null);
    if (existing) {
      return {
        objectKey,
        size: existing.size,
        mimeType:
          input.mimeType ??
          existing.metaData?.['content-type'] ??
          'application/octet-stream',
      };
    }

    await minioClient.putObject(
      env.minio.bucket,
      objectKey,
      input.buffer,
      input.buffer.byteLength,
      { 'Content-Type': input.mimeType },
    );

    logger.debug(
      {
        tenantId: input.tenantId,
        channelId: input.channelId,
        externalId: input.externalId,
        objectKey,
        size: input.buffer.byteLength,
      },
      '[MediaStorage] mídia inbound persistida (via buffer decodificado)',
    );

    return {
      objectKey,
      size: input.buffer.byteLength,
      mimeType: input.mimeType,
    };
  },

  // Upload direto pelo frontend (multipart) → bucket. Usado pelo endpoint
  // POST /messages/upload-media antes do staff confirmar o envio.
  uploadOutbound: async (input: UploadOutboundInput): Promise<UploadResult> => {
    await ensureWhatsappBucket();

    const objectKey = buildObjectKey({
      tenantId: input.tenantId,
      channelId: input.channelId,
      externalId: randomUUID(),
      filename: input.originalFilename,
    });

    await minioClient.putObject(
      env.minio.bucket,
      objectKey,
      input.buffer,
      input.buffer.byteLength,
      { 'Content-Type': input.mimeType },
    );

    return {
      objectKey,
      size: input.buffer.byteLength,
      mimeType: input.mimeType,
    };
  },

  // Presigned GET pra que o frontend baixe direto do MinIO sem expor
  // credencial. Endpoint público (MINIO_PUBLIC_*) — o que o browser abre.
  getSignedDownloadUrl: async (objectKey: string): Promise<string> => {
    return publicMinioClient.presignedGetObject(
      env.minio.bucket,
      objectKey,
      env.minio.presignedUrlTtlSec,
    );
  },

  // Presigned GET entregue ao provider no sendMedia: o Evolution puxa o
  // arquivo dessa URL. Endpoint MINIO_PROVIDER_* (default = público).
  getProviderDownloadUrl: async (objectKey: string): Promise<string> => {
    return providerMinioClient.presignedGetObject(
      env.minio.bucket,
      objectKey,
      env.minio.presignedUrlTtlSec,
    );
  },

  // Baixa foto de perfil do WhatsApp e re-grava no MinIO em path estável
  // (sobrescreve a anterior — não mantemos histórico). URLs do Evolution
  // expiram em horas; precisamos persistir pra UI funcionar amanhã.
  persistProfilePicture: async (
    input: PersistProfilePictureInput,
  ): Promise<UploadResult> => {
    await ensureWhatsappBucket();

    const res = await fetch(input.sourceUrl, {
      signal: AbortSignal.timeout(30_000),
    }).catch((err) => {
      throw new AppError(
        `Falha ao baixar foto de perfil (${input.sourceUrl}): ${err instanceof Error ? err.message : err}`,
        502,
      );
    });
    if (!res.ok) {
      throw new AppError(
        `Foto de perfil retornou ${res.status}`,
        502,
      );
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const mimeType =
      res.headers.get('content-type') ?? 'image/jpeg';

    // Path estável → sobrescrever sempre que refresh disparar. Sem date
    // partition (foto atual interessa, não histórico).
    const ext = mimeType.includes('png') ? '.png' : mimeType.includes('webp') ? '.webp' : '.jpg';
    const objectKey = `${input.tenantId}/${input.channelId}/profile-pictures/${input.contactId}${ext}`;

    await minioClient.putObject(
      env.minio.bucket,
      objectKey,
      buffer,
      buffer.byteLength,
      { 'Content-Type': mimeType },
    );

    return { objectKey, size: buffer.byteLength, mimeType };
  },
};

interface BuildObjectKeyInput {
  tenantId: string;
  channelId: string;
  externalId: string;
  filename: string;
}

// {tenantId}/{channelId}/{yyyy}/{mm}/{dd}/{externalId}-{filename}
// Particionamento por data simplifica retention/lifecycle policies depois
// (S3 lifecycle rule "delete > 365d" pega o prefix). Filename é sanitizado
// pra remover caracteres de path traversal.
function buildObjectKey(input: BuildObjectKeyInput): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  // Só [A-Za-z0-9._-] na chave: atrás de proxy que recodifica o caminho,
  // espaço/acento/parênteses quebram a assinatura SigV4 do upload.
  // externalId também passa — a chave inteira tem que ser à prova de proxy.
  const safeId = safeObjectName(input.externalId);
  const safeName = safeObjectName(input.filename);
  return `${input.tenantId}/${input.channelId}/${yyyy}/${mm}/${dd}/${safeId}-${safeName}`;
}

function guessFilenameFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').pop();
    if (!last) return null;
    // Evolution serve URLs do tipo `.enc` (criptografadas) e o path costuma
    // ter extensão útil. Se não tiver, deixamos pra mimeType decidir.
    return extname(last) ? last : null;
  } catch {
    return null;
  }
}
