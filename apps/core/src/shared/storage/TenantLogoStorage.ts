import { env } from '../../env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../observability/logger.js';
import {
  ensureMediaBucket,
  isStorageConfigured,
  storageClient,
} from './storageClient.js';

// =====================================================================
// TenantLogoStorage — fachada pra persistir/apagar/servir logo de tenant.
//
// Layout de paths:
//   tenants/{tenantId}/logo.{ext}
//
// Path estável (não versionado por data) — logo é asset "vivo": upload
// sobrescreve a versão anterior, sem histórico. Se um dia o tenant quiser
// histórico, o objectKey vira `tenants/{tenantId}/logo/{yyyymmdd-hhmmss}.{ext}`
// sem mudar API pública (só o buildLogoKey).
//
// Bucket: `env.storage.mediaBucket` (compartilhado com attachments
// polimórficos futuros). Prefixo `tenants/` deixa claro o domínio no
// listing/lifecycle rules.
//
// Opt-in: quando storage não está provisionado (MINIO_ACCESS_KEY ausente),
// operações retornam null ou lançam 503. Callers precisam checar
// `isConfigured` antes de expor UI de upload.
// =====================================================================

// Extensões aceitas — casadas com o mime que o navegador envia. Mantido
// enxuto de propósito: SVG traz risco de XSS embutido, GIF quase nunca é
// usado como logo. Amplia sob demanda com validação.
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export interface PersistLogoResult {
  objectKey: string;
  size: number;
  mimeType: string;
}

export const TenantLogoStorage = {
  isConfigured: isStorageConfigured,

  // Persiste logo. Sobrescreve idempotentemente (path estável por tenant).
  // Valida mimeType contra allow-list — outros mimes viram 400.
  persistLogo: async (
    tenantId: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<PersistLogoResult> => {
    if (!storageClient) {
      throw new AppError('Storage não está configurado', 503);
    }
    const ext = ALLOWED_MIME_TYPES[mimeType];
    if (!ext) {
      throw new AppError(
        `Formato de imagem não suportado: ${mimeType}. Use PNG, JPEG ou WebP.`,
        400,
      );
    }
    await ensureMediaBucket();

    const objectKey = buildLogoKey(tenantId, ext);
    await storageClient.putObject(
      env.storage.mediaBucket,
      objectKey,
      buffer,
      buffer.byteLength,
      { 'Content-Type': mimeType },
    );

    logger.debug(
      { tenantId, objectKey, size: buffer.byteLength },
      '[TenantLogoStorage] logo persistido',
    );
    return { objectKey, size: buffer.byteLength, mimeType };
  },

  // Best-effort delete — usado quando super-admin remove logo. Erro de
  // "não existe" é engolido; o caller já vai zerar o campo no DB de
  // qualquer jeito.
  deleteLogoQuiet: async (objectKey: string): Promise<void> => {
    if (!storageClient) return;
    try {
      await storageClient.removeObject(env.storage.mediaBucket, objectKey);
    } catch (err) {
      logger.warn(
        { objectKey, err: (err as Error).message },
        '[TenantLogoStorage] falha ao apagar logo (ignorado)',
      );
    }
  },

  // Presigned GET pro browser renderizar sem expor credencial. TTL curto —
  // frontend re-consulta o endpoint se a URL expirar (sessão longa).
  getPresignedUrl: async (objectKey: string): Promise<string> => {
    if (!storageClient) {
      throw new AppError('Storage não está configurado', 503);
    }
    return storageClient.presignedGetObject(
      env.storage.mediaBucket,
      objectKey,
      env.storage.mediaPresignedTtlSec,
    );
  },
};

function buildLogoKey(tenantId: string, ext: string): string {
  return `tenants/${tenantId}/logo.${ext}`;
}
