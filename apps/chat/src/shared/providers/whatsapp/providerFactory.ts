import type { InferSelectModel, whatsappChannels } from '@elora/db';
import { AppError } from '../../errors/AppError.js';
import { EvolutionAdapter } from './EvolutionAdapter.js';
import type { IWhatsAppProvider } from './IWhatsAppProvider.js';
import { MockAdapter } from './MockAdapter.js';

type WhatsappChannel = InferSelectModel<typeof whatsappChannels>;

// Cria o adapter correto pra um canal. Lê `provider_type` + `provider_config`
// e retorna a impl. Evolution v2 cobre os dois tracks (baileys e meta_cloud)
// via mesmo gateway — adapter ramifica internamente por `integration`.
//
// Modo MOCK em dev: se `provider_config.mock === true`, retorna MockAdapter
// independente do `provider_type`. Permite cadastrar um canal "fake" pra
// testar UI/fluxo sem subir Evolution real. Em prod a flag não é setada
// (campo simplesmente ausente).
export function createWhatsappProvider(
  channel: Pick<WhatsappChannel, 'id' | 'providerType' | 'providerConfig'>
): IWhatsAppProvider {
  const config = (channel.providerConfig ?? {}) as Record<string, unknown>;
  if (config.mock === true) {
    return new MockAdapter(channel.id);
  }

  switch (channel.providerType) {
    case 'baileys':
    case 'meta_cloud': {
      // EvolutionAdapter valida o shape de `provider_config` no construtor —
      // se faltar baseUrl/instanceName/apiKey/webhookToken, lança AppError 500
      // com mensagem específica. Forçamos `integration` pra bater com
      // `providerType` (defesa contra config inconsistente entre os campos).
      const evolutionConfig = {
        ...config,
        integration: channel.providerType,
      };
      return new EvolutionAdapter(channel.id, evolutionConfig);
    }
    default:
      throw new AppError(
        `Provider desconhecido: ${channel.providerType}`,
        500
      );
  }
}
