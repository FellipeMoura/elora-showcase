import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { env } from '../../env.js';
import { openApiRegistry } from './registry.js';

// Declara os security schemes na criação do registry (uma vez por boot).
// Cada endpoint protegido referencia esses nomes via `security: REQUIRES_AUTH`
// (ver helpers.ts). Mesma estratégia do apps/core — JWT é compartilhado
// entre os dois apps (mesmo segredo, mesmo cookie name).
openApiRegistry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'elora_token',
  description:
    'Cookie httpOnly setado pelo POST /auth/login do CORE. Postman captura ' +
    'via cookie jar; o mesmo cookie autentica requests no chat (mesma origem).',
});

openApiRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'JWT no header `Authorization: Bearer <token>`. Útil quando você quer ' +
    'rodar fora do flow de cookie (CI, integração externa).',
});

// Monta o documento OpenAPI a partir de tudo que foi registrado.
// Chamado pelo handler GET /openapi.json a cada request — barato
// (Map → object). Mantemos dinâmico em vez de cachear pra dev hot-reload
// funcionar bem; em prod o custo é desprezível.
//
// Usamos OpenAPI 3.0.3 (não 3.1) porque o Postman tem suporte irregular
// pra 3.1 — alguns specs válidos dão "Incorrect format" no import.
//
// `servers`: em dev declaramos com placeholder `{tenant}` no host. Postman
// renderiza como variável editável — troca o valor pra alternar entre tenants
// seedados sem editar requests. Em prod override via env (SERVER_URL_OVERRIDE).
export function buildOpenApiDocument(): object {
  const generator = new OpenApiGeneratorV3(openApiRegistry.definitions);
  const override = process.env.SERVER_URL_OVERRIDE;
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Elora Chat API',
      version: env.appVersion,
      description:
        'API do serviço de chat: WhatsApp transport, mensagens domain, ' +
        'templates, conversations e webhook normalizer. Importe em Postman ' +
        'via File → Import → Link e marque "Auto-update" pra re-sincronizar.',
    },
    servers: override
      ? [{ url: override, description: 'Prod / staging' }]
      : [
          {
            url: `http://{tenant}.localhost:${env.port}`,
            description: 'Dev local (substitua {tenant} pelo slug — clinica-a, clinica-b).',
            variables: {
              tenant: {
                default: 'clinica-a',
                description: 'Slug do tenant (subdomínio).',
                enum: ['clinica-a', 'clinica-b'],
              },
            },
          },
        ],
  });
}
