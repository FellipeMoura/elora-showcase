import type { CorsOptions } from 'cors';
import { env, isDev } from '../../env.js';
import { logger } from '../observability/logger.js';

// Mesma política do core (apps/core/src/shared/http/cors.ts) — manter as
// duas em sincronia. Antes os dois usavam `origin: true`.
//
// Allowlist de origem. O default anterior (`origin: true`) refletia qualquer
// Origin enviada pelo cliente E mandava `credentials: true` junto — ou seja,
// qualquer site conseguia fazer request autenticado com o cookie de sessão.
// SameSite=Lax segurava o caso normal, mas a política não deveria depender
// disso (clientes Bearer não passam por SameSite, e mudar cookie/domínio
// depois reabriria o buraco silenciosamente).
//
// Aceita:
//   1. o domínio do produto e qualquer subdomínio de tenant, sobre HTTPS
//      (`elora.app.br` + `<slug>.elora.app.br`)
//   2. origens exatas extras em CORS_EXTRA_ORIGINS (staging, app mobile, etc.)
//   3. em dev, `localhost` / `*.localhost` / `127.0.0.1` em qualquer porta —
//      o frontend roda em `<slug>.localhost:5500` e o chat em :5502
export function isOriginAllowed(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (env.cors.extraOrigins.includes(origin)) return true;

  const host = url.hostname.toLowerCase();
  const appDomain = env.cors.appDomain.toLowerCase();

  if (url.protocol === 'https:' && (host === appDomain || host.endsWith(`.${appDomain}`))) {
    return true;
  }

  if (
    isDev &&
    url.protocol === 'http:' &&
    (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1')
  ) {
    return true;
  }

  return false;
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    // Sem header Origin = request same-origin ou não-browser (curl, health
    // check do nginx, service-to-service). CORS não se aplica a esses.
    if (!origin) return callback(null, true);
    if (isOriginAllowed(origin)) return callback(null, true);
    // `false` (e não Error) porque a resposta correta é responder SEM os
    // headers CORS e deixar o browser bloquear — devolver 500 no preflight
    // só embaralharia o diagnóstico.
    logger.warn({ origin }, '[cors] origem bloqueada');
    return callback(null, false);
  },
  credentials: true,
  exposedHeaders: ['X-App-Version', 'X-Total-Count', 'X-Request-Id'],
};
