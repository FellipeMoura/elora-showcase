import { contracts, type InferSelectModel } from '@elora/db';
import {
  createSortSpec,
  sortQuerySchema,
} from '../../shared/sorting/buildSort.js';
import { z } from '../../shared/openapi/registry.js';

export type Contract = InferSelectModel<typeof contracts>;

// Contract enriquecido com info de cliente e template (denormalizado pra
// evitar N+1 na listagem). Vem das queries `findPaginated` / `findById`.
export interface ContractWithRelations extends Contract {
  client: {
    id: string;
    name: string;
    phoneE164: string;
  };
  template: {
    id: string;
    name: string;
    kind: 'consent_term' | 'service_contract' | 'image_release' | 'other';
  } | null;
}

export const contractsSortSpec = createSortSpec(
  {
    createdAt: contracts.createdAt,
    updatedAt: contracts.updatedAt,
    sentAt: contracts.sentAt,
    signedAt: contracts.signedAt,
    title: contracts.title,
    status: contracts.status,
  },
  { field: 'createdAt', direction: 'desc' },
);

const contractKindEnum = z.enum([
  'consent_term',
  'service_contract',
  'image_release',
  'other',
]);

// `draft` está reservado pra fluxo futuro (operadora salva rascunho antes
// de disparar pra ZapSign). Hoje `create` sempre seta `sent` direto — nenhum
// código produz draft. Mantido no enum + DB pra evitar migration agressiva
// quando o fluxo for ativado.
const contractStatusEnum = z.enum([
  'draft',
  'sent',
  'viewed',
  'signed',
  'declined',
  'expired',
  'cancelled',
]);

const variableSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Nome da variável obrigatório')
    .max(64)
    .openapi({ example: 'clientName' }),
  value: z
    .string()
    .trim()
    .max(2000)
    .openapi({ example: 'Maria Silva' }),
});

export const contractResponseSchema = z
  .object({
    id: z.string().uuid(),
    tenantId: z.string().uuid(),
    clientId: z.string().uuid(),
    journeyId: z.string().uuid().nullable(),
    // Vínculo com a venda (Fase 7). Null em contratos avulsos antigos.
    saleId: z.string().uuid().nullable(),
    templateId: z.string().uuid().nullable(),
    variables: z.array(variableSchema),
    kind: contractKindEnum,
    title: z.string(),
    status: contractStatusEnum,
    // ZapSign refs — null no estado 'draft', preenchidos a partir de 'sent'.
    zapsignDocumentId: z.string().nullable(),
    zapsignOpenId: z.string().nullable(),
    signUrl: z.string().nullable(),
    signedPdfObjectKey: z.string().nullable(),
    sentAt: z.string().datetime().nullable(),
    viewedAt: z.string().datetime().nullable(),
    signedAt: z.string().datetime().nullable(),
    declinedAt: z.string().datetime().nullable(),
    expiresAt: z.string().datetime().nullable(),
    failureReason: z.string().nullable(),
    createdByUserId: z.string().uuid().nullable(),
    idempotencyKey: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    // Relacionados (denormalizados na listagem pra evitar N+1).
    client: z.object({
      id: z.string().uuid(),
      name: z.string(),
      phoneE164: z.string(),
    }),
    template: z
      .object({
        id: z.string().uuid(),
        name: z.string(),
        kind: contractKindEnum,
      })
      .nullable(),
  })
  .openapi('Contract');

export const createContractSchema = z
  .object({
    clientId: z
      .string()
      .uuid()
      .openapi({ example: '11111111-2222-3333-4444-555555555555' }),
    templateId: z
      .string()
      .uuid()
      .openapi({ example: '66666666-7777-8888-9999-aaaaaaaaaaaa' }),
    journeyId: z.string().uuid().nullable().optional(),
    // Vínculo com a venda (Fase 7). Opcional pra preservar criação avulsa
    // (ClientDetailPage). Presente, os uniques parciais de venda passam a valer.
    saleId: z.string().uuid().nullable().optional(),
    // Título opcional — se omitido, usa o nome do template.
    title: z.string().trim().min(1).max(255).optional(),
    // Lista de variáveis preenchidas. As chaves devem bater com as cadastradas
    // no template (validado no service).
    variables: z
      .array(variableSchema)
      .default([])
      .openapi({
        example: [
          { name: 'clientName', value: 'Maria Silva' },
          { name: 'procedure', value: 'Depilação a laser axilas' },
        ],
      }),
    expiresInDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .openapi({ description: 'Prazo pra signer assinar antes de expirar.' }),
    // Idempotência client-side. Frontend gera 1 UUID quando o sheet abre e
    // reenvia o mesmo se o submit for repetido (double-click, retry de rede,
    // duas abas). Backend devolve o contrato existente em vez de criar novo.
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(64)
      .optional()
      .openapi({
        description:
          'UUID gerado pelo cliente pra prevenir criação duplicada. Em retry, ' +
          'reenvie o mesmo valor — o backend devolve o contrato já criado.',
      }),
  })
  .openapi('CreateContractInput');

export type CreateContractInput = z.infer<typeof createContractSchema>;

export const findContractsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(500).default(20),
    clientId: z.string().uuid().optional(),
    journeyId: z.string().uuid().optional(),
    saleId: z.string().uuid().optional(),
    status: contractStatusEnum.optional(),
    kind: contractKindEnum.optional(),
    // Quando true, filtra só pendentes de assinatura (sent + viewed).
    pendingOnly: z.coerce.boolean().optional(),
  })
  .merge(sortQuerySchema(contractsSortSpec))
  .openapi('FindContractsQuery');

export type FindContractsQuery = z.infer<typeof findContractsQuerySchema>;

export const contractIdParamSchema = z.object({
  id: z.string().uuid('ID inválido'),
});

// =====================================================================
// Resolver de variáveis conhecidas — alimenta ContractSendSheet com
// valores pré-preenchidos a partir do cliente+tenant.
// =====================================================================

export const resolveVariablesQuerySchema = z.object({
  clientId: z.string().uuid('clientId inválido'),
});

export const resolveVariablesResponseSchema = z
  .object({
    resolved: z
      .record(z.string(), z.string())
      .openapi({
        description:
          'Mapa chave→valor já formatado (CPF mascarado, datas dd/mm/aaaa, ' +
          'telefone humano). Inclui TODAS as chaves do catálogo — strings ' +
          'vazias quando o campo de origem não foi preenchido no cadastro.',
      }),
    knownKeys: z.array(z.string()).openapi({
      description:
        'Lista completa das chaves que o backend sabe resolver. UI usa ' +
        'pra marcar variáveis "conhecidas" no ContractTemplateSheet.',
    }),
    missing: z
      .array(
        z.object({
          keys: z.array(z.string()),
          source: z.enum(['client', 'tenant', 'system']),
          label: z.string(),
          reason: z.enum(['empty', 'invalid']),
        }),
      )
      .openapi({
        description:
          'Campos do cadastro que ainda estão vazios ou com formato inválido. ' +
          'UI mostra banner avisando o operador antes de gerar o contrato. ' +
          'Agrupado por label (ex: clientDocument + clientDocumentRaw viram ' +
          '"CPF do cliente"). `reason: invalid` quando o cadastro tem valor ' +
          'mas formatter rejeitou (ex: CPF com menos de 11 dígitos).',
      }),
  })
  .openapi('ResolveContractVariables');

export const contractVariablesCatalogResponseSchema = z
  .array(z.string())
  .openapi('ContractVariablesCatalog');

// =====================================================================
// Bulk de termos de consentimento por venda (Fase 7).
// POST /sales/:saleId/contracts/consent-terms
// =====================================================================

export const saleIdParamSchema = z.object({
  saleId: z.string().uuid('saleId inválido'),
});

// Resultado idempotente do bulk: `created` traz os termos gerados nesta chamada,
// `skipped` os que não foram criados (já ativos via 23505 ou erro de provider —
// erro num template não aborta os outros).
export const generateConsentTermsResponseSchema = z
  .object({
    created: z.array(contractResponseSchema),
    skipped: z.array(
      z.object({
        templateId: z.string().uuid(),
        templateName: z.string(),
        reason: z.enum(['already_active', 'provider_error']),
      }),
    ),
  })
  .openapi('GenerateConsentTermsResult');
