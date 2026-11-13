import { env, isProd } from '../../../env.js';
import { logger } from '../../observability/logger.js';
import type { ISignatureProvider } from './ISignatureProvider.js';
import { ZapSignAdapter } from './ZapSignAdapter.js';

// Singleton — uma instância global do provider. Diferente do WhatsApp
// (config por canal em `whatsapp_channels`), aqui há uma conta única
// servindo todos os tenants. Se um dia quisermos conta por tenant,
// migra pra factory por tenantId + tabela `signature_providers`.
let cached: ISignatureProvider | null = null;

export function getSignatureProvider(): ISignatureProvider {
  if (cached) return cached;
  cached = createProvider();
  return cached;
}

function createProvider(): ISignatureProvider {
  const adapter = new ZapSignAdapter({
    apiToken: env.zapsign.apiToken,
    apiBaseUrl: env.zapsign.apiBaseUrl,
    webhookToken: env.zapsign.webhookToken,
  });

  // Sandbox detectado pelo subdomínio na URL — não há flag separada.
  if (adapter.isConfigured && env.zapsign.apiBaseUrl.includes('sandbox.')) {
    logger.warn(
      { provider: 'zapsign', baseUrl: env.zapsign.apiBaseUrl },
      'ZapSign rodando em MODO SANDBOX — documentos não têm validade jurídica. Em produção, trocar ZAPSIGN_API_BASE_URL pra https://api.zapsign.com.br/api/v1.',
    );
  }

  if (!adapter.isConfigured) {
    logger.warn(
      { provider: 'zapsign' },
      'ZapSign sem ZAPSIGN_API_TOKEN — operações de assinatura retornarão 503 até provisionar.',
    );
  }

  if (isProd && !env.zapsign.webhookToken) {
    logger.warn(
      { provider: 'zapsign' },
      'ZapSign sem ZAPSIGN_WEBHOOK_TOKEN em produção — webhook aceitará qualquer payload. Configurar antes de ativar webhook no painel.',
    );
  }

  return adapter;
}

// Helper de teste — permite injetar mock no lugar do singleton.
// SÓ usado em testes; não exportar pelo barrel pra evitar uso acidental.
export function setSignatureProviderForTesting(provider: ISignatureProvider | null): void {
  cached = provider;
}
