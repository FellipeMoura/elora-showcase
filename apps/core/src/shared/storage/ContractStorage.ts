import { env } from '../../env.js';
import { AppError } from '../errors/AppError.js';
import { logger } from '../observability/logger.js';
import {
  ensureContractsBucket,
  isStorageConfigured,
  storageClient,
} from './storageClient.js';

// =====================================================================
// ContractStorage — fachada pra persistir/baixar PDFs assinados.
//
// Layout de paths (objectKey):
//   {tenantId}/{yyyy}/{mm}/{contractId}.pdf
//
// Particionamento por mês simplifica retention/lifecycle (S3 prefix
// pattern). Tenant namespace na raiz garante que listagens de bucket
// nunca cruzam tenants.
//
// Opt-in: quando o storage não está provisionado, todos os métodos
// retornam null/false sem lançar. Caller decide degradar (baixar do
// ZapSign on-demand) ou avisar 503.
// =====================================================================

export const ContractStorage = {
  isConfigured: isStorageConfigured,

  // Upload do PDF assinado. Idempotente por (tenantId, contractId) — re-up
  // sobrescreve sem erro. Retorna objectKey persistido ou null quando
  // storage não está configurado (webhook ainda atualiza status do
  // contrato; downloadSignedPdf degrade pra ZapSign on-demand).
  persistSignedPdf: async (
    tenantId: string,
    contractId: string,
    buffer: Buffer,
  ): Promise<string | null> => {
    if (!storageClient) return null;
    await ensureContractsBucket();

    const objectKey = buildSignedPdfKey(tenantId, contractId);
    await storageClient.putObject(
      env.storage.contractsBucket,
      objectKey,
      buffer,
      buffer.byteLength,
      { 'Content-Type': 'application/pdf' },
    );

    logger.debug(
      { tenantId, contractId, objectKey, size: buffer.byteLength },
      '[ContractStorage] PDF assinado persistido',
    );
    return objectKey;
  },

  // Download server-side do PDF previamente persistido. Usado pelo endpoint
  // /contracts/:id/signed-pdf quando há objectKey gravado — evita ir até
  // o ZapSign. Lança 404 se o objeto sumiu (bucket reset, lifecycle,
  // tenant deletado).
  fetchSignedPdf: async (objectKey: string): Promise<Buffer> => {
    if (!storageClient) {
      throw new AppError('Storage não está configurado', 503);
    }
    const chunks: Buffer[] = [];
    try {
      const stream = await storageClient.getObject(
        env.storage.contractsBucket,
        objectKey,
      );
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'NoSuchKey') {
        throw new AppError(`PDF não encontrado no storage: ${objectKey}`, 404);
      }
      throw err;
    }
    return Buffer.concat(chunks);
  },
};

function buildSignedPdfKey(tenantId: string, contractId: string): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${tenantId}/${yyyy}/${mm}/${contractId}.pdf`;
}
