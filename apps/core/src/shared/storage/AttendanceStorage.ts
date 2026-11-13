import { env } from '../../env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../observability/logger.js';
import { isStorageConfigured, storageClient } from './storageClient.js';

// =====================================================================
// AttendanceStorage — fachada pra persistir foto + assinatura de presença
// (procedure_session_attendances).
//
// Layout de paths:
//   {tenantId}/{yyyy}/{mm}/{attendanceId}-signature.svg
//   {tenantId}/{yyyy}/{mm}/{attendanceId}-photo.webp
//
// Bucket separado do contracts pra permitir TTL/lifecycle independente
// (foto/assinatura de presença costuma ter retenção legal específica).
// =====================================================================

let bucketEnsured = false;

async function ensureAttendancesBucket(): Promise<void> {
  if (bucketEnsured || !storageClient) return;
  const exists = await storageClient
    .bucketExists(env.storage.attendancesBucket)
    .catch(() => false);
  if (!exists) {
    await storageClient.makeBucket(env.storage.attendancesBucket, 'us-east-1');
  }
  bucketEnsured = true;
}

export const AttendanceStorage = {
  isConfigured: isStorageConfigured,

  persistSignature: async (
    tenantId: string,
    attendanceId: string,
    svg: string
  ): Promise<string> => {
    if (!storageClient) {
      throw new AppError('Storage não está configurado', 503);
    }
    await ensureAttendancesBucket();
    const objectKey = buildKey(tenantId, attendanceId, 'signature.svg');
    const buffer = Buffer.from(svg, 'utf-8');
    await storageClient.putObject(
      env.storage.attendancesBucket,
      objectKey,
      buffer,
      buffer.byteLength,
      { 'Content-Type': 'image/svg+xml' }
    );
    logger.debug(
      { tenantId, attendanceId, objectKey, size: buffer.byteLength },
      '[AttendanceStorage] assinatura persistida'
    );
    return objectKey;
  },

  persistPhoto: async (
    tenantId: string,
    attendanceId: string,
    photoBuffer: Buffer,
    mimeType: string
  ): Promise<string> => {
    if (!storageClient) {
      throw new AppError('Storage não está configurado', 503);
    }
    await ensureAttendancesBucket();
    const ext = mimeType === 'image/webp' ? 'webp' : 'png';
    const objectKey = buildKey(tenantId, attendanceId, `photo.${ext}`);
    await storageClient.putObject(
      env.storage.attendancesBucket,
      objectKey,
      photoBuffer,
      photoBuffer.byteLength,
      { 'Content-Type': mimeType }
    );
    logger.debug(
      { tenantId, attendanceId, objectKey, size: photoBuffer.byteLength },
      '[AttendanceStorage] foto persistida'
    );
    return objectKey;
  },

  fetchObject: async (objectKey: string): Promise<Buffer> => {
    if (!storageClient) {
      throw new AppError('Storage não está configurado', 503);
    }
    const chunks: Buffer[] = [];
    try {
      const stream = await storageClient.getObject(
        env.storage.attendancesBucket,
        objectKey
      );
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'NoSuchKey') {
        throw new AppError(`Objeto não encontrado no storage: ${objectKey}`, 404);
      }
      throw err;
    }
    return Buffer.concat(chunks);
  },

  // Best-effort: tenta apagar mas não derruba caller. Usado em rollback
  // quando o INSERT da row falha após o upload já ter rolado.
  deleteObjectQuiet: async (objectKey: string): Promise<void> => {
    if (!storageClient) return;
    try {
      await storageClient.removeObject(env.storage.attendancesBucket, objectKey);
    } catch (err) {
      logger.warn(
        { objectKey, err: (err as Error).message },
        '[AttendanceStorage] falha ao apagar objeto órfão (ignorado)'
      );
    }
  },
};

function buildKey(tenantId: string, attendanceId: string, suffix: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${tenantId}/${yyyy}/${mm}/${attendanceId}-${suffix}`;
}
