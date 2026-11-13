// Detector pra suspeita de duplicação outbound (UI → pipeline).
//
// Bug observado em 2026-05-21: mesma mensagem aparecia 2x — uma sem
// `authoredOnDevice` (caminho UI) e outra com (caminho pipeline subcaso B).
// Não reproduzimos após dessincronizar WhatsApp Web pareado, mas tampouco
// confirmamos a causa. Este módulo registra o envio da UI numa janela
// curta; o pipeline consulta antes de criar mensagem como "outbound externo
// novo" e loga warn se houver hit (sinal forte de duplicação real).
//
// In-memory; em scale-out vira false negative silencioso (aceito — é só
// detector, não fix). Cleanup amortizado, sem TTL ativo.
const TTL_MS = 10_000;
const MAX_ENTRIES_BEFORE_GC = 200;
const recent = new Map<string, number>();

function buildKey(tenantId: string, conversationId: string): string {
  return `${tenantId}:${conversationId}`;
}

export function markUiOutbound(tenantId: string, conversationId: string): void {
  recent.set(buildKey(tenantId, conversationId), Date.now());
  if (recent.size > MAX_ENTRIES_BEFORE_GC) {
    const cutoff = Date.now() - TTL_MS;
    for (const [k, t] of recent) {
      if (t < cutoff) recent.delete(k);
    }
  }
}

export function hadRecentUiOutbound(
  tenantId: string,
  conversationId: string,
): boolean {
  const t = recent.get(buildKey(tenantId, conversationId));
  if (!t) return false;
  return Date.now() - t < TTL_MS;
}
