// Leitura tipada das vars do Vite + derivação de URLs de API.
//
// Em dev, herda o subdomínio do tenant via window.location.hostname.
// Em prod, espera VITE_CORE_URL/VITE_CHAT_URL absolutos.

function deriveApiUrl(
  absolute: string | undefined,
  port: string | undefined,
  fallbackPort: string
): string {
  if (absolute) return absolute.replace(/\/$/, '');
  const p = port ?? fallbackPort;
  return `${window.location.protocol}//${window.location.hostname}:${p}`;
}

export const env = {
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
  api: {
    core: deriveApiUrl(
      import.meta.env.VITE_CORE_URL,
      import.meta.env.VITE_CORE_PORT,
      '5501'
    ),
    chat: deriveApiUrl(
      import.meta.env.VITE_CHAT_URL,
      import.meta.env.VITE_CHAT_PORT,
      '5502'
    ),
  },
} as const;
