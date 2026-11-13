// Extrai o slug do tenant a partir do hostname (`clinica-a.localhost` ou
// `clinica-a.elora.app.br`). Retorna null em `localhost` puro — frontend deve
// tratar essa rota como "sem tenant" (provavelmente landing ou redirect).

export function getTenantSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const hostname = window.location.hostname;

  if (hostname === 'localhost' || hostname === '127.0.0.1') return null;

  const parts = hostname.split('.');
  if (parts.length < 2) return null;

  return parts[0] ?? null;
}
