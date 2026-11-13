import {
  OpenAPIRegistry,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// Mutate o prototype do Zod adicionando `.openapi(...)`. Tem que rodar UMA
// vez antes de qualquer schema chamar `.openapi()`. Como este arquivo é
// importado pelo server.ts ANTES de qualquer rota/módulo (ver topo de
// server.ts), a mutação acontece a tempo.
//
// Side-effect na importação — não há nada a "chamar". Importar é suficiente.
extendZodWithOpenApi(z);

// Singleton compartilhado. Cada *Routes.ts faz `registry.registerPath(...)`
// pra declarar seu endpoint. `document.ts` lê esse registry pra montar o
// JSON final.
export const openApiRegistry = new OpenAPIRegistry();

// Re-exporta `z` extendido pra schemas usarem `import { z } from
// '../../shared/openapi/registry.js'` sem se preocupar com ordem de import.
// Quem só consome Zod puro pode seguir importando de 'zod' direto.
export { z };
