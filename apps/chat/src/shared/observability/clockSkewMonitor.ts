import { logger } from './logger.js';

// Alarme de relógio do servidor desajustado.
//
// Todo inbound traz o `messageTimestamp` do WhatsApp — relógio externo e
// sincronizado, serve de referência grátis. A diferença (chegada no nosso
// webhook − timestamp do provider) é latência de rede (~1s) + erro do nosso
// relógio. Mediana das últimas amostras por canal isola o erro do relógio dos
// picos de atraso pontuais.
//
// Por que importa: `messages.sent_at` usa o relógio do servidor
// (ver shared/utils/messageClock.ts). Relógio adiantado/atrasado não inverte
// mais a ordem, mas desloca todos os horários exibidos — e acima de
// MESSAGE_BACKLOG_THRESHOLD_MS (5 min) a timeline volta a misturar relógios.
//
// In-memory por processo (mesmo trade-off do outboundDuplicationDetector):
// em scale-out cada worker mede o próprio relógio, o que é o desejado.
const SAMPLE_SIZE = 20;
const MIN_SAMPLES = 5;
const SKEW_WARN_MS = 30_000;
const WARN_COOLDOWN_MS = 30 * 60 * 1000;
// Amostras com diferença maior que isso são histórico despejado (reconexão
// do Evolution com mensagens de horas/dias), não relógio — descartadas.
const MAX_SAMPLE_ABS_MS = 6 * 60 * 60 * 1000;

interface ChannelSamples {
  lags: number[];
  lastWarnAt: number;
}

const byChannel = new Map<string, ChannelSamples>();

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function recordClockSample(
  tenantId: string,
  channelId: string,
  providerAt: Date,
  arrivedAt: Date
): void {
  const lagMs = arrivedAt.getTime() - providerAt.getTime();
  if (!Number.isFinite(lagMs) || Math.abs(lagMs) > MAX_SAMPLE_ABS_MS) return;

  let entry = byChannel.get(channelId);
  if (!entry) {
    entry = { lags: [], lastWarnAt: 0 };
    byChannel.set(channelId, entry);
  }
  entry.lags.push(lagMs);
  if (entry.lags.length > SAMPLE_SIZE) entry.lags.shift();
  if (entry.lags.length < MIN_SAMPLES) return;

  const skewMs = median(entry.lags);
  if (Math.abs(skewMs) < SKEW_WARN_MS) return;

  const now = Date.now();
  if (now - entry.lastWarnAt < WARN_COOLDOWN_MS) return;
  entry.lastWarnAt = now;

  logger.warn(
    {
      tenantId,
      channelId,
      skewSec: Math.round(skewMs / 1000),
      samples: entry.lags.length,
    },
    `[clock] relógio do servidor ${skewMs > 0 ? 'adiantado' : 'atrasado'} ~${Math.round(Math.abs(skewMs) / 1000)}s em relação ao WhatsApp (mediana da chegada − messageTimestamp). Conferir NTP do host (timedatectl / w32tm) — ou o provider está entregando com atraso.`
  );
}
