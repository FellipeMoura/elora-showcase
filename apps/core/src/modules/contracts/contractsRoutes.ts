import { Router, type Router as ExpressRouter } from 'express';
import { ensureAuthenticated } from '../../shared/middleware/ensureAuthenticated.js';
import { loadUserRoles } from '../../shared/middleware/loadUserRoles.js';
import { requirePermission } from '../../shared/middleware/requirePermission.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../shared/middleware/validate.js';
import {
  ERROR_RESPONSES,
  REQUIRES_AUTH,
  openApiRegistry,
  paginatedSchema,
} from '../../shared/openapi/index.js';
import { ContractsController } from './ContractsController.js';
import {
  contractIdParamSchema,
  contractResponseSchema,
  contractVariablesCatalogResponseSchema,
  createContractSchema,
  findContractsQuerySchema,
  resolveVariablesQuerySchema,
  resolveVariablesResponseSchema,
} from './ContractsTypes.js';
import { ContractTemplatesController } from './ContractTemplatesController.js';
import {
  contractTemplateIdParamSchema,
  contractTemplateResponseSchema,
  createContractTemplateSchema,
  findContractTemplatesQuerySchema,
  linkProcedureBodySchema,
  templateProcedureParamsSchema,
  templateProceduresResponseSchema,
  updateContractTemplateSchema,
  zapsignPanelInfoResponseSchema,
  zapsignTemplateIdParamSchema,
  zapsignTemplateInfoResponseSchema,
  zapsignTemplatesListResponseSchema,
} from './ContractTemplatesTypes.js';

const router: ExpressRouter = Router();

router.use(ensureAuthenticated);
router.use(loadUserRoles);

// =====================================================================
// Templates de contrato — CRUD administrativo. Admin/manager cadastra
// templates apontando pro ID do template no painel ZapSign.
// =====================================================================

const TAG_TEMPLATES = 'Contract Templates';

const paginatedContractTemplatesSchema = paginatedSchema(
  contractTemplateResponseSchema,
  'PaginatedContractTemplates',
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/contract-templates',
  tags: [TAG_TEMPLATES],
  summary: 'Lista templates de contrato cadastrados',
  security: REQUIRES_AUTH,
  request: { query: findContractTemplatesQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedContractTemplatesSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/contract-templates',
  requirePermission('contractTemplates:read'),
  validateQuery(findContractTemplatesQuerySchema),
  ContractTemplatesController.find,
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/contract-templates',
  tags: [TAG_TEMPLATES],
  summary: 'Cadastra apontamento pra template no painel ZapSign',
  description:
    'O template (PDF/DOCX + marcação de variáveis) é criado no painel ' +
    'da ZapSign. Aqui registramos só o ID externo + lista de variáveis ' +
    'esperadas (snapshot pro front renderizar o form de envio).',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createContractTemplateSchema } } },
  },
  responses: {
    201: {
      description: 'Template cadastrado',
      content: { 'application/json': { schema: contractTemplateResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/contract-templates',
  requirePermission('contractTemplates:write'),
  validateBody(createContractTemplateSchema),
  ContractTemplatesController.create,
);

// ----- ZapSign helpers -----
// Registrar ANTES da rota com `:id` pra Express matchear `zapsign/...`
// como segmento literal (e não como UUID que falharia validação).

openApiRegistry.registerPath({
  method: 'get',
  path: '/contract-templates/zapsign/panel-info',
  tags: [TAG_TEMPLATES],
  summary: 'Devolve URL do painel ZapSign + flag de sandbox + configurado',
  description:
    'Usado pelo formulário de cadastro de template no front pra mostrar ' +
    'link "Abrir painel ZapSign" e desabilitar o autofetch quando o backend ' +
    'está sem token. Não escopa por tenant — ZapSign é singleton da plataforma.',
  security: REQUIRES_AUTH,
  responses: {
    200: {
      description: 'Info do painel',
      content: { 'application/json': { schema: zapsignPanelInfoResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/contract-templates/zapsign/panel-info',
  requirePermission('contractTemplates:write'),
  ContractTemplatesController.getZapsignPanelInfo,
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/contract-templates/zapsign/templates',
  tags: [TAG_TEMPLATES],
  summary: 'Lista templates da conta ZapSign (token + nome)',
  description:
    'Usado pelo combobox de seleção no cadastro de apontamento. Provider ' +
    'pagina internamente até cap defensivo (5 páginas × 100 = 500 templates).',
  security: REQUIRES_AUTH,
  responses: {
    200: {
      description: 'Lista de templates',
      content: { 'application/json': { schema: zapsignTemplatesListResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    502: ERROR_RESPONSES[502],
    503: ERROR_RESPONSES[503],
  },
});

router.get(
  '/contract-templates/zapsign/templates',
  requirePermission('contractTemplates:write'),
  ContractTemplatesController.listZapsignTemplates,
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/contract-templates/zapsign/templates/{zapsignTemplateId}',
  tags: [TAG_TEMPLATES],
  summary: 'Inspeciona template no painel ZapSign (nome + variáveis)',
  description:
    'Lookup do template no provider pra preencher automaticamente o array ' +
    'de variáveis no cadastro. Evita erro de digitação (variável errada quebra ' +
    'o envio). Retorna 503 se ZapSign não estiver provisionado.',
  security: REQUIRES_AUTH,
  request: { params: zapsignTemplateIdParamSchema },
  responses: {
    200: {
      description: 'Template encontrado',
      content: { 'application/json': { schema: zapsignTemplateInfoResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    502: ERROR_RESPONSES[502],
    503: ERROR_RESPONSES[503],
  },
});

router.get(
  '/contract-templates/zapsign/templates/:zapsignTemplateId',
  requirePermission('contractTemplates:write'),
  validateParams(zapsignTemplateIdParamSchema),
  ContractTemplatesController.inspectZapsignTemplate,
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/contract-templates/{id}',
  tags: [TAG_TEMPLATES],
  summary: 'Busca template por ID',
  security: REQUIRES_AUTH,
  request: { params: contractTemplateIdParamSchema },
  responses: {
    200: {
      description: 'Template encontrado',
      content: { 'application/json': { schema: contractTemplateResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/contract-templates/:id',
  requirePermission('contractTemplates:read'),
  validateParams(contractTemplateIdParamSchema),
  ContractTemplatesController.getById,
);

openApiRegistry.registerPath({
  method: 'patch',
  path: '/contract-templates/{id}',
  tags: [TAG_TEMPLATES],
  summary: 'Atualiza template (parcial)',
  security: REQUIRES_AUTH,
  request: {
    params: contractTemplateIdParamSchema,
    body: { content: { 'application/json': { schema: updateContractTemplateSchema } } },
  },
  responses: {
    200: {
      description: 'Template atualizado',
      content: { 'application/json': { schema: contractTemplateResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.patch(
  '/contract-templates/:id',
  requirePermission('contractTemplates:write'),
  validateParams(contractTemplateIdParamSchema),
  validateBody(updateContractTemplateSchema),
  ContractTemplatesController.update,
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/contract-templates/{id}',
  tags: [TAG_TEMPLATES],
  summary: 'Remove template. Falha 409 se houver contratos vinculados.',
  security: REQUIRES_AUTH,
  request: { params: contractTemplateIdParamSchema },
  responses: {
    204: { description: 'Removido' },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/contract-templates/:id',
  requirePermission('contractTemplates:delete'),
  validateParams(contractTemplateIdParamSchema),
  ContractTemplatesController.remove,
);

// ----- Vínculo template × procedimento (Fase 7) -----
// Só faz sentido pra templates `consent_term` — a service valida o kind.
// Define quais procedimentos exigem qual termo (alimenta o bulk da venda +
// a subtabela em Settings).

openApiRegistry.registerPath({
  method: 'get',
  path: '/contract-templates/{id}/procedures',
  tags: [TAG_TEMPLATES],
  summary: 'Lista procedimentos vinculados ao template de termo',
  security: REQUIRES_AUTH,
  request: { params: contractTemplateIdParamSchema },
  responses: {
    200: {
      description: 'Procedimentos vinculados',
      content: { 'application/json': { schema: templateProceduresResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/contract-templates/:id/procedures',
  requirePermission('contractTemplates:read'),
  validateParams(contractTemplateIdParamSchema),
  ContractTemplatesController.listProcedures,
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/contract-templates/{id}/procedures',
  tags: [TAG_TEMPLATES],
  summary: 'Vincula um procedimento ao template de termo de consentimento',
  description:
    'Só templates `consent_term` aceitam vínculo (409 caso contrário). ' +
    'Idempotente: re-vincular o mesmo procedimento é no-op. Devolve a lista ' +
    'atualizada de procedimentos vinculados.',
  security: REQUIRES_AUTH,
  request: {
    params: contractTemplateIdParamSchema,
    body: { content: { 'application/json': { schema: linkProcedureBodySchema } } },
  },
  responses: {
    200: {
      description: 'Vínculo criado; lista atualizada',
      content: { 'application/json': { schema: templateProceduresResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/contract-templates/:id/procedures',
  requirePermission('contractTemplates:write'),
  validateParams(contractTemplateIdParamSchema),
  validateBody(linkProcedureBodySchema),
  ContractTemplatesController.linkProcedure,
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/contract-templates/{id}/procedures/{procedureId}',
  tags: [TAG_TEMPLATES],
  summary: 'Remove o vínculo de um procedimento com o template',
  description: 'Idempotente: remover vínculo inexistente é no-op. Devolve a lista atualizada.',
  security: REQUIRES_AUTH,
  request: { params: templateProcedureParamsSchema },
  responses: {
    200: {
      description: 'Vínculo removido; lista atualizada',
      content: { 'application/json': { schema: templateProceduresResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.delete(
  '/contract-templates/:id/procedures/:procedureId',
  requirePermission('contractTemplates:write'),
  validateParams(templateProcedureParamsSchema),
  ContractTemplatesController.unlinkProcedure,
);

// =====================================================================
// Contratos — instâncias enviadas pra assinatura.
// =====================================================================

const TAG_CONTRACTS = 'Contracts';

const paginatedContractsSchema = paginatedSchema(
  contractResponseSchema,
  'PaginatedContracts',
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/contracts',
  tags: [TAG_CONTRACTS],
  summary: 'Lista contratos do tenant',
  security: REQUIRES_AUTH,
  request: { query: findContractsQuerySchema },
  responses: {
    200: {
      description: 'Lista paginada',
      content: { 'application/json': { schema: paginatedContractsSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/contracts',
  requirePermission('contracts:read'),
  validateQuery(findContractsQuerySchema),
  ContractsController.find,
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/contracts',
  tags: [TAG_CONTRACTS],
  summary: 'Cria contrato e envia pra ZapSign',
  description:
    'Cria documento na ZapSign a partir do template + variáveis, persiste ' +
    'com status=`sent` e devolve a URL pública de assinatura. Disparo ' +
    'automático via WhatsApp não está ativo nesta fase — frontend recebe ' +
    'a signUrl e mostra opção de copiar/abrir.',
  security: REQUIRES_AUTH,
  request: {
    body: { content: { 'application/json': { schema: createContractSchema } } },
  },
  responses: {
    201: {
      description: 'Contrato criado e enviado',
      content: { 'application/json': { schema: contractResponseSchema } },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
    502: ERROR_RESPONSES[502],
    503: ERROR_RESPONSES[503],
  },
});

router.post(
  '/contracts',
  requirePermission('contracts:write'),
  validateBody(createContractSchema),
  ContractsController.create,
);

// ----- Resolver de variáveis conhecidas -----
// Registrar ANTES das rotas com `:id` pra Express matchear `variables/...`
// como segmento literal (id seria UUID e falharia validação).

openApiRegistry.registerPath({
  method: 'get',
  path: '/contracts/variables/catalog',
  tags: [TAG_CONTRACTS],
  summary: 'Lista de chaves de variáveis que o backend sabe resolver',
  description:
    'Catálogo estático de chaves "conhecidas" (ver docs/contracts-domain.md §11). ' +
    'Frontend usa pra marcar variáveis auto-preenchidas no ContractTemplateSheet.',
  security: REQUIRES_AUTH,
  responses: {
    200: {
      description: 'Lista de chaves',
      content: {
        'application/json': { schema: contractVariablesCatalogResponseSchema },
      },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
  },
});

router.get(
  '/contracts/variables/catalog',
  requirePermission('contracts:read'),
  ContractsController.listVariablesCatalog,
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/contracts/variables/resolve',
  tags: [TAG_CONTRACTS],
  summary: 'Resolve variáveis conhecidas pra um cliente específico',
  description:
    'Retorna mapa chave→valor já formatado (CPF mascarado, datas dd/mm/aaaa, ' +
    'endereço completo concatenado). UI do ContractSendSheet usa pra pré-' +
    'preencher inputs ao escolher template — operador só preenche o que for ' +
    'específico de contexto (ex: procedure, session_count).',
  security: REQUIRES_AUTH,
  request: { query: resolveVariablesQuerySchema },
  responses: {
    200: {
      description: 'Variáveis resolvidas',
      content: {
        'application/json': { schema: resolveVariablesResponseSchema },
      },
    },
    400: ERROR_RESPONSES[400],
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/contracts/variables/resolve',
  requirePermission('contracts:write'),
  validateQuery(resolveVariablesQuerySchema),
  ContractsController.resolveVariables,
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/contracts/{id}',
  tags: [TAG_CONTRACTS],
  summary: 'Busca contrato por ID',
  security: REQUIRES_AUTH,
  request: { params: contractIdParamSchema },
  responses: {
    200: {
      description: 'Contrato encontrado',
      content: { 'application/json': { schema: contractResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
  },
});

router.get(
  '/contracts/:id',
  requirePermission('contracts:read'),
  validateParams(contractIdParamSchema),
  ContractsController.getById,
);

openApiRegistry.registerPath({
  method: 'post',
  path: '/contracts/{id}/copy-link',
  tags: [TAG_CONTRACTS],
  summary: 'Devolve o link de assinatura (pra UI copiar)',
  description:
    'Devolve o contrato com signUrl pronta pra UI copiar pra área de ' +
    'transferência. Não dispara nada — quem manda o link é a operadora. ' +
    'Em fase futura este endpoint vai disparar mensagem WhatsApp pelo ' +
    'backend (aí virará `resend` de fato).',
  security: REQUIRES_AUTH,
  request: { params: contractIdParamSchema },
  responses: {
    200: {
      description: 'Contrato',
      content: { 'application/json': { schema: contractResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.post(
  '/contracts/:id/copy-link',
  requirePermission('contracts:write'),
  validateParams(contractIdParamSchema),
  ContractsController.copyLink,
);

openApiRegistry.registerPath({
  method: 'delete',
  path: '/contracts/{id}',
  tags: [TAG_CONTRACTS],
  summary: 'Cancela o contrato (cancela documento na ZapSign também)',
  security: REQUIRES_AUTH,
  request: { params: contractIdParamSchema },
  responses: {
    200: {
      description: 'Contrato cancelado',
      content: { 'application/json': { schema: contractResponseSchema } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
  },
});

router.delete(
  '/contracts/:id',
  requirePermission('contracts:write'),
  validateParams(contractIdParamSchema),
  ContractsController.cancel,
);

openApiRegistry.registerPath({
  method: 'get',
  path: '/contracts/{id}/signed-pdf',
  tags: [TAG_CONTRACTS],
  summary: 'Baixa o PDF assinado (binary)',
  description:
    'Disponível apenas quando status=`signed`. MVP: baixa do ZapSign a cada ' +
    'chamada. Fase futura: redireciona pra presigned URL no MinIO/R2.',
  security: REQUIRES_AUTH,
  request: { params: contractIdParamSchema },
  responses: {
    200: {
      description: 'PDF do contrato assinado',
      content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
    },
    401: ERROR_RESPONSES[401],
    403: ERROR_RESPONSES[403],
    404: ERROR_RESPONSES[404],
    409: ERROR_RESPONSES[409],
    502: ERROR_RESPONSES[502],
    503: ERROR_RESPONSES[503],
  },
});

router.get(
  '/contracts/:id/signed-pdf',
  requirePermission('contracts:read'),
  validateParams(contractIdParamSchema),
  ContractsController.downloadSignedPdf,
);

export default router;
