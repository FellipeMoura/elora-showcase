import type { CoreGateway } from './CoreGateway.js';
import { LocalCoreGateway } from './LocalCoreGateway.js';

// Singleton. Quando o core ganhar `modules/clients` e `modules/journeys`
// + rotas internas, substituir por `new HttpCoreGateway(env.coreInternalUrl,
// env.internalApiSecret)`. Call sites no normalizer NÃO mudam.
export const coreGateway: CoreGateway = new LocalCoreGateway();

export type {
  Client,
  CoreGateway,
  FindOrCreateActiveJourneyInput,
  FindOrCreateClientInput,
  Journey,
} from './CoreGateway.js';
