import { Client as MinioClient } from 'minio';
import { env } from '../../env.js';

// =====================================================================
// Dois clientes MinIO. Em dev o frontend roda no browser do host, app
// roda no host, mas Evolution roda em container Docker — então a URL
// presigned precisa ser acessível dos três contextos:
//   - browser do dev (host): `localhost:9000`
//   - app no host: `localhost:9000`
//   - Evolution no container: `host.docker.internal:9000` (em Docker
//     Desktop Mac/Win; precisa de extra_hosts em Linux compose)
//
// `minioClient` (default): server-side ops (uploads, downloads pelo app).
//   Aponta pro endpoint local-friendly (env.minio.endPoint).
// `publicMinioClient`: APENAS gera presigned URLs externas. Aponta pro
//   endpoint público que Evolution + browser dev conseguem resolver
//   (env.minio.publicEndPoint). Se as duas configs forem iguais, os dois
//   clientes ficam idênticos — degrade transparente.
//
// A assinatura é calculada sobre o canonical request (path + query +
// SignedHeaders) — o `Host` header não entra no signing pra MinIO em modo
// path-style, então URLs públicas validam mesmo chegando via outro nome
// de host.
//
// `region` fixo (env.minio.region): sem ele o SDK faz um GET ?location no
// bucket antes de assinar — presign vira chamada de rede (pro endpoint
// PÚBLICO, que do host pode nem resolver) e falha com bucket inexistente.
// =====================================================================

const REGION = env.minio.region;

// Singleton pra operações server-side (uploads, downloads, statObject).
export const minioClient = new MinioClient({
  endPoint: env.minio.endPoint,
  port: env.minio.port,
  useSSL: env.minio.useSSL,
  accessKey: env.minio.accessKey,
  secretKey: env.minio.secretKey,
  region: REGION,
});

// Singleton APENAS pra `presignedGetObject` / `presignedPutObject`.
// Configurado com hostname externamente acessível.
export const publicMinioClient = new MinioClient({
  endPoint: env.minio.publicEndPoint,
  port: env.minio.publicPort,
  useSSL: env.minio.publicUseSSL,
  accessKey: env.minio.accessKey,
  secretKey: env.minio.secretKey,
  region: REGION,
});

// Singleton APENAS pra presigned URLs entregues ao provider (Evolution
// baixando mídia de envio) — endpoint que resolve de dentro do container.
export const providerMinioClient = new MinioClient({
  endPoint: env.minio.providerEndPoint,
  port: env.minio.providerPort,
  useSSL: env.minio.providerUseSSL,
  accessKey: env.minio.accessKey,
  secretKey: env.minio.secretKey,
  region: REGION,
});

let bucketEnsured = false;

export async function ensureWhatsappBucket(): Promise<void> {
  if (bucketEnsured) return;
  const exists = await minioClient.bucketExists(env.minio.bucket).catch(() => false);
  if (!exists) {
    await minioClient.makeBucket(env.minio.bucket, REGION);
  }
  bucketEnsured = true;
}
