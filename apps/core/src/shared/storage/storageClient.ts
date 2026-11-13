import { Client as MinioClient } from 'minio';
import { env } from '../../env.js';

// =====================================================================
// Cliente S3-compatível usado pelo módulo contracts pra persistir PDFs
// assinados. Em dev: MinIO local (opt-in via docker-compose profile
// storage-local). Em prod: Cloudflare R2 — mesma API S3.
//
// Opt-in: quando MINIO_ACCESS_KEY/SECRET ausentes, exportamos
// `storageClient = null` e `isStorageConfigured = false`. Callers checam
// e degradam graciosamente — ver ContractStorage.
//
// Não há `publicMinioClient` aqui (diferente do chat): contratos não são
// consumidos por container externo (Evolution). Frontend baixa via
// backend (endpoint /contracts/:id/signed-pdf), então o presigned URL é
// gerado apenas pra redirecionar o browser direto pro storage — usa o
// mesmo endpoint do server-side.
// =====================================================================

export const isStorageConfigured = Boolean(
  env.storage.accessKey && env.storage.secretKey,
);

export const storageClient: MinioClient | null = isStorageConfigured
  ? new MinioClient({
      endPoint: env.storage.endPoint,
      port: env.storage.port,
      useSSL: env.storage.useSSL,
      accessKey: env.storage.accessKey as string,
      secretKey: env.storage.secretKey as string,
    })
  : null;

let contractsBucketEnsured = false;

// Idempotente — só checa/cria 1x por processo. Falhas (permissão pra
// criar bucket negada no R2, por exemplo) não devem derrubar o servidor:
// caller já decidiu usar o storage, então o erro propaga e webhook
// específico falha 502.
export async function ensureContractsBucket(): Promise<void> {
  if (contractsBucketEnsured || !storageClient) return;
  const exists = await storageClient
    .bucketExists(env.storage.contractsBucket)
    .catch(() => false);
  if (!exists) {
    await storageClient.makeBucket(env.storage.contractsBucket, 'us-east-1');
  }
  contractsBucketEnsured = true;
}

let mediaBucketEnsured = false;

// Bucket guarda-chuva pra mídia genérica (logo de tenant + attachments
// polimórficos futuros). Mesma disciplina de idempotência do contracts —
// checa 1x por processo, falha propaga.
//
// Em prod (R2) o app roda com credencial que provavelmente NÃO tem
// permissão de `makeBucket`. Nesse caso o bucket precisa ser pré-criado
// no dashboard do R2; a chamada aqui só falha 1x no bucketExists e segue.
export async function ensureMediaBucket(): Promise<void> {
  if (mediaBucketEnsured || !storageClient) return;
  const exists = await storageClient
    .bucketExists(env.storage.mediaBucket)
    .catch(() => false);
  if (!exists) {
    await storageClient.makeBucket(env.storage.mediaBucket, 'us-east-1');
  }
  mediaBucketEnsured = true;
}
