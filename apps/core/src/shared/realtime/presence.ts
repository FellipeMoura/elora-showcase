// =====================================================================
// Quem está com o Elora "na frente" agora: aba visível, com foco e com
// interação recente (o front decide e avisa via socket `presence:active` /
// `presence:inactive` — ver apps/frontend/src/hooks/usePresenceReporter.ts).
// Usuário ativo em QUALQUER aparelho não recebe push: o toast in-app já
// avisa, e o celular no bolso não precisa vibrar junto (mesmo critério do
// WhatsApp Web).
//
// Em memória porque o core roda em 1 processo (ecosystem: fork, 1
// instância) e o push sai do mesmo processo que mantém os sockets. Se o
// core escalar horizontalmente, isto vira um Set no Redis com TTL.
// =====================================================================

const activeSocketsByUser = new Map<string, Set<string>>();

function key(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

export function markSocketActive(tenantId: string, userId: string, socketId: string): void {
  const k = key(tenantId, userId);
  let sockets = activeSocketsByUser.get(k);
  if (!sockets) {
    sockets = new Set();
    activeSocketsByUser.set(k, sockets);
  }
  sockets.add(socketId);
}

export function markSocketInactive(tenantId: string, userId: string, socketId: string): void {
  const k = key(tenantId, userId);
  const sockets = activeSocketsByUser.get(k);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) activeSocketsByUser.delete(k);
}

export function isUserActive(tenantId: string, userId: string): boolean {
  return (activeSocketsByUser.get(key(tenantId, userId))?.size ?? 0) > 0;
}
