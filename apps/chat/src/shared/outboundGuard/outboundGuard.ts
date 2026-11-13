import { createHash } from 'node:crypto';
import { AppError } from '../errors/AppError.js';
import { logger } from '../observability/logger.js';
import { redis } from '../redis/redis.js';

// =====================================================================
// OutboundGuard — proteção principal contra banimento em providers que
// não enforçam a janela 24h/template no protocolo (Baileys).
//
// Cobertura:
//   1. Rate limit por canal (per-min + per-hour) — anti-burst.
//   2. Dedupe por canal — bloqueia "mesmo body pra N contatos distintos em
//      janela curta", o pattern clássico de disparo em massa que os
//      heurísticos de spam do WhatsApp pegam primeiro.
//
// Por que cumprir AQUI em vez de no provider/adapter:
//   - Service vê o tenant + canal + recipient + body. Adapter só vê o
//     payload da rede.
//   - Persistência (Redis) é compartilhada — funciona horizontalmente.
//   - Errors viram AppError com statusCode coerente (429) — caller já
//     trata HTTP.
//
// Quando RODA:
//   - Apenas pra providers com `requiresWindowGate()=false` (Baileys/mock).
//   - Cloud API tem o Meta protegendo o tráfego — checar de novo seria
//     redundância sem benefício e atrapalha campaigns legítimas.
//
// CONFIG hardcoded por enquanto; pesquisa de produção pode justificar mover
// pra `tenants.preferences` ou env vars no futuro.
// =====================================================================

interface RateLimits {
  perMinute: number;
  perHour: number;
}

interface DedupePolicy {
  // Quantos recipients DISTINTOS toleramos pro mesmo body em `windowSec`
  // antes de bloquear. Acima disso a mensagem parece disparo em massa.
  maxDistinctRecipients: number;
  windowSec: number;
}

const DEFAULT_LIMITS: RateLimits = {
  // 20 msgs por minuto cobre conversas paralelas naturais sem permitir burst
  // de robô. Pra clínica típica (1–3 atendentes humanos), passar disso já é
  // sinal de script.
  perMinute: 20,
  // 200 msgs por hora bate com uso intenso de equipe pequena (200 conversas
  // ativas é muita coisa). Limite "abafa" antes do volume virar suspeito.
  perHour: 200,
};

const DEFAULT_DEDUPE: DedupePolicy = {
  // Mesmo conteúdo pra 10+ contatos distintos em 30min vira modo "campanha"
  // que precisaria entrar por outro caminho (auditado, opt-in respeitado).
  // Limiar baixo o suficiente pra pegar disparo de fato; alto o suficiente
  // pra não bloquear "ok!" ou saudações repetidas.
  maxDistinctRecipients: 10,
  windowSec: 30 * 60,
};

// Hash do body (sha-1, truncado) — dedupe não precisa de cripto forte, só
// de stable identifier compacto. Normalizamos (lower + trim + collapse
// whitespace) pra "Oi  maria!" e "oi maria!" caírem no mesmo bucket — gente
// que tenta burlar dedupe com variações triviais é exatamente quem queremos
// pegar.
function bodyFingerprint(body: string): string {
  const normalized = body.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha1').update(normalized).digest('hex').slice(0, 16);
}

interface GuardArgs {
  channelId: string;
  recipientPhone: string;
  // Conteúdo a ser deduped. Texto → body; mídia → caption (ou nome do arquivo
  // se sem caption). Quando vazio (mídia sem caption nem nome), dedupe pula —
  // o conteúdo real (binário) varia entre envios, então repetir o objectKey
  // não significa pattern de spam.
  body: string | null;
}

// Resultado em vez de throw — caller decide se converte em erro HTTP ou se
// loga + degrada graciosamente. Padrão atual: throw via `assertAllowed`.
export interface GuardResult {
  allowed: boolean;
  reason?: 'rate_minute' | 'rate_hour' | 'dedupe_mass';
  // Pra rate limit, segundos até janela atual liberar. Pra dedupe, segundos
  // até o body expirar do cache. Frontend pode mostrar countdown.
  retryAfterSec?: number;
}

export const OutboundGuard = {
  // Avalia e RESERVA contadores atomicamente. Retorna `allowed:false` quando
  // alguma regra estourou; nesse caso nada é reservado (decrement é evitado
  // pra simplicidade — TTL natural reseta a janela).
  //
  // Chamado ANTES do provider.send. Se passar aqui, o envio acontece e o
  // dedupe REGISTRA o body (não throw). Se o provider falhar depois, o
  // dedupe fica registrado erroneamente — aceito: na pior hipótese, o
  // próximo send com mesmo body conta como recipient adicional, o que é
  // conservador (anti-spam vence ergonomia).
  check: async (args: GuardArgs): Promise<GuardResult> => {
    const limits = DEFAULT_LIMITS;
    const dedupe = DEFAULT_DEDUPE;
    const now = Date.now();

    // ---- Rate limit (per-minute + per-hour, atomic INCR) ----
    const minuteBucket = Math.floor(now / 60_000);
    const hourBucket = Math.floor(now / 3_600_000);
    const minKey = `og:rate:${args.channelId}:m:${minuteBucket}`;
    const hourKey = `og:rate:${args.channelId}:h:${hourBucket}`;

    // Pipeline: INCR + EXPIRE no mesmo round-trip. EXPIRE é idempotente —
    // setar de novo em re-INCRs não causa drift (TTL cobre só a janela
    // atual, próximo bucket usa key diferente).
    const pipeline = redis.pipeline();
    pipeline.incr(minKey);
    pipeline.expire(minKey, 90); // 60s + slack pra evitar TTL=0 antes do bucket virar
    pipeline.incr(hourKey);
    pipeline.expire(hourKey, 3700);
    const results = await pipeline.exec();

    if (!results) {
      logger.warn(
        { channelId: args.channelId },
        '[outboundGuard] Redis pipeline retornou null — permitindo envio (fail-open)',
      );
      return { allowed: true };
    }

    const minuteCount = Number(results[0]?.[1] ?? 0);
    const hourCount = Number(results[2]?.[1] ?? 0);

    if (minuteCount > limits.perMinute) {
      const retryAfterSec = 60 - Math.floor((now % 60_000) / 1000);
      return { allowed: false, reason: 'rate_minute', retryAfterSec };
    }
    if (hourCount > limits.perHour) {
      const retryAfterSec = 3600 - Math.floor((now % 3_600_000) / 1000);
      return { allowed: false, reason: 'rate_hour', retryAfterSec };
    }

    // ---- Dedupe (mass-send detection) ----
    // Pula quando body vazio: mídia sem caption/filename varia o binário
    // entre envios; dedupar por path do MinIO daria falso positivo (mesmo
    // template de foto enviado pra clientes legítimos).
    const trimmed = args.body?.trim();
    if (!trimmed) {
      return { allowed: true };
    }

    const fp = bodyFingerprint(trimmed);
    const dedupeKey = `og:dedupe:${args.channelId}:${fp}`;

    // SADD adiciona o telefone ao set; retorna 1 se novo, 0 se já existia.
    // SCARD conta distinct. EXPIRE no set inteiro = janela rolante.
    const dedupePipeline = redis.pipeline();
    dedupePipeline.sadd(dedupeKey, args.recipientPhone);
    dedupePipeline.scard(dedupeKey);
    dedupePipeline.expire(dedupeKey, dedupe.windowSec);
    const dedupeResults = await dedupePipeline.exec();

    if (!dedupeResults) return { allowed: true };

    const distinctCount = Number(dedupeResults[1]?.[1] ?? 0);
    if (distinctCount > dedupe.maxDistinctRecipients) {
      // Pra simplicidade não rolamos back o SADD — o telefone fica no set
      // mas o envio é bloqueado. Próximo recipient distinto vai ver count
      // ainda maior, igual bloqueio. Conservador no sentido certo.
      return {
        allowed: false,
        reason: 'dedupe_mass',
        retryAfterSec: dedupe.windowSec,
      };
    }

    return { allowed: true };
  },

  // Variante que throw direto pra simplificar callers que querem retornar
  // 429 ao frontend. AppError carrega `retryAfterSec` em `details` pra UI
  // mostrar countdown.
  assertAllowed: async (args: GuardArgs): Promise<void> => {
    const result = await OutboundGuard.check(args);
    if (result.allowed) return;

    const messages: Record<NonNullable<GuardResult['reason']>, string> = {
      rate_minute:
        'Limite de envios por minuto atingido neste canal. Tente novamente em instantes.',
      rate_hour:
        'Limite de envios por hora atingido neste canal. Aguarde antes de continuar.',
      dedupe_mass:
        'Mensagem repetida para muitos contatos em pouco tempo — sinal de disparo em massa. Use templates auditados ou personalize cada mensagem.',
    };
    const reason = result.reason ?? 'rate_minute';
    throw new AppError(messages[reason], 429, {
      reason,
      retryAfterSec: result.retryAfterSec ?? null,
    });
  },
};
