import { OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { env } from '../../env.js';
import { openApiRegistry } from './registry.js';

// Declara os security schemes na criação do registry (uma vez por boot).
// Cada endpoint protegido referencia esses nomes via `security: REQUIRES_AUTH`
// (ver helpers.ts).
//
// `cookieAuth`: o flow padrão do app — após /auth/login, cookie httpOnly
//   `elora_token` é setado. Postman cookie jar carrega automaticamente.
// `bearerAuth`: fallback (Authorization: Bearer <token>) que o middleware
//   `ensureAuthenticated` também aceita — útil pra CI/Postman sem cookie jar.
openApiRegistry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'elora_token',
  description:
    'Cookie httpOnly setado pelo POST /auth/login. Postman captura via cookie ' +
    'jar; nenhuma config manual necessária após o login.',
});

openApiRegistry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
  description:
    'JWT no header `Authorization: Bearer <token>`. Útil quando você quer ' +
    'rodar fora do flow de cookie (CI, integração externa).',
});

// Usamos OpenAPI 3.0.3 (não 3.1) porque o Postman tem suporte irregular
// pra 3.1 — alguns specs válidos dão "Incorrect format" no import. 3.0 é
// universalmente aceito.
//
// `servers`: em dev declaramos com placeholder `{tenant}` no host. Postman
// renderiza esses placeholders como variáveis editáveis na collection — basta
// trocar o valor pra alternar entre tenants seedados (clinica-a, clinica-b).
// Sem isso, o Postman bate em `localhost` sem Host header → tenant não resolve
// → 404. Em prod, override via env (SERVER_URL_OVERRIDE).
export function buildOpenApiDocument(): object {
  const generator = new OpenApiGeneratorV3(openApiRegistry.definitions);
  const override = process.env.SERVER_URL_OVERRIDE;
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Elora Core API',
      version: env.appVersion,
      description:
        'API do core: auth, tenants, users, groups, menus. Importe em Postman ' +
        'via File → Import → Link.',
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
