import { tenants, type InferSelectModel } from '@elora/db';
import { z } from '../../shared/openapi/registry.js';

export type Tenant = InferSelectModel<typeof tenants>;

// HH:mm 24h. Aceita 00:00..23:59. Sem segundos pra simplificar UX do form.
const timeOfDayRegex = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

// Schedule: lista de janelas (dayOfWeek 0=Dom..6=Sáb + open/close). Cada
// dia pode aparecer 0..N vezes — N permite duas faixas (manhã/tarde) no
// futuro sem migration. Validação de coerência (close > open, sem overlap)
// fica fora por ora — o detector trata janela inválida como "fechado".
// Literal union (0..6) em vez de min/max: TS herda o mesmo tipo da
// interface BusinessHours em @elora/db, evitando cast na hora do insert.
const dayScheduleSchema = z.object({
  dayOfWeek: z
    .union([
      z.literal(0),
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ])
    .openapi({ example: 1, description: '0=Dom..6=Sáb' }),
  open: z.string().regex(timeOfDayRegex, 'Formato esperado: HH:mm'),
  close: z.string().regex(timeOfDayRegex, 'Formato esperado: HH:mm'),
});

// businessHours = null no DB significa "agente nunca dispara fora do
// horário porque não sabe qual é". `timezone` é IANA — defaults sensatos
// pra BR vivem na UI, não no backend (DB aceita qualquer string).
export const businessHoursSchema = z
  .object({
    timezone: z
      .string()
      .trim()
      .min(1)
      .openapi({ example: 'America/Sao_Paulo' }),
    schedule: z.array(dayScheduleSchema).max(14),
  })
  .openapi('BusinessHours');

// Aceita "limpar" via null em PATCH; undefined = não mexer.
const optionalNullableBusinessHours = businessHoursSchema.nullable();

// Slug ocupa o lugar do subdomínio (clinica-x.elora.app.br) — precisa ser
// DNS-safe e estável. Regex: começa/termina com alfanumérico, miolo aceita
// hífens. Lowercase só. Max 63 = limite de label DNS (também o length
// declarado no schema).
const slugRegex = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const slugSchema = z
  .string()
  .trim()
  .min(2, 'Slug mínimo de 2 caracteres')
  .max(63, 'Slug máximo de 63 caracteres')
  .regex(
    slugRegex,
    'Slug deve conter apenas letras minúsculas, números e hífens (não pode começar/terminar com hífen)'
  );

// CNPJ — armazenado em dígitos apenas. Aceita entrada com ou sem máscara
// e normaliza no transform. Refine confere só o tamanho (14); validação
// completa do DV fica fora do escopo pra não bloquear ambiente de dev/seed
// com CNPJs fictícios.
const cnpjSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/\D/g, ''))
  .refine((s) => s.length === 14, 'CNPJ deve conter 14 dígitos');

// Aceita "limpar" via null em PATCH; undefined = não mexer.
const optionalNullableCnpj = cnpjSchema.nullable();
const optionalNullableShortText = z.string().trim().min(1).max(255).nullable();
const optionalNullableUrl = z.string().trim().min(1).max(1024).nullable();

// Resumo do tenant pra rotas de super-admin (catálogo, vínculos menu↔tenant).
// Mantido enxuto pra continuar consumível por callers existentes.
export const tenantSummarySchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
  })
  .openapi('TenantSummary');

export type TenantSummary = z.infer<typeof tenantSummarySchema>;

// Detalhe — expõe campos editáveis e timestamps. Usado por GET /tenants/:id
// e como resposta de create/update.
export const tenantResponseSchema = z
  .object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    legalName: z.string().nullable(),
    tradeName: z.string().nullable(),
    document: z.string().nullable(),
    representativeName: z.string().nullable(),
    logoUrl: z.string().nullable(),
    skipEvaluation: z.boolean(),
    agentEnabled: z.boolean(),
    agentIdleMinutes: z.number().int().positive(),
    agentPersona: z.string().nullable(),
    businessHours: businessHoursSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .openapi('Tenant');

export const createTenantSchema = z
  .object({
    slug: slugSchema.openapi({ example: 'clinica-bela' }),
    name: z
      .string()
      .trim()
      .min(1, 'Nome obrigatório')
      .max(255)
      .openapi({ example: 'Clínica Bela' }),
    legalName: optionalNullableShortText
      .optional()
      .openapi({ example: 'Clínica Bela Estética LTDA' }),
    tradeName: optionalNullableShortText
      .optional()
      .openapi({ example: 'Clínica Bela' }),
    document: optionalNullableCnpj
      .optional()
      .openapi({ example: '12345678000190' }),
    representativeName: optionalNullableShortText
      .optional()
      .openapi({ example: 'Maria Souza' }),
    logoUrl: optionalNullableUrl
      .optional()
      .openapi({ example: 'https://cdn.elora.app/logos/clinica-bela.png' }),
    skipEvaluation: z.boolean().optional().openapi({ example: false }),
    agentEnabled: z.boolean().optional().openapi({ example: false }),
    agentIdleMinutes: z
      .number()
      .int()
      .positive()
      .max(1440)
      .optional()
      .openapi({ example: 15 }),
    agentPersona: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .nullable()
      .optional()
      .openapi({ example: 'Tom informal e próximo, sem jargão técnico.' }),
    businessHours: optionalNullableBusinessHours.optional(),
  })
  .openapi('CreateTenantInput');

export type CreateTenantInput = z.infer<typeof createTenantSchema>;

// Slug é imutável — está embutido no subdomínio e nos JWTs já emitidos.
// Permitir alterar quebra login dos usuários ativos. Update mexe só em
// rótulo + flag de comportamento.
export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    legalName: optionalNullableShortText.optional(),
    tradeName: optionalNullableShortText.optional(),
    document: optionalNullableCnpj.optional(),
    representativeName: optionalNullableShortText.optional(),
    logoUrl: optionalNullableUrl.optional(),
    skipEvaluation: z.boolean().optional(),
    agentEnabled: z.boolean().optional(),
    agentIdleMinutes: z.number().int().positive().max(1440).optional(),
    agentPersona: z.string().trim().min(1).max(2000).nullable().optional(),
    businessHours: optionalNullableBusinessHours.optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Nenhum campo para atualizar',
  })
  .openapi('UpdateTenantInput');

export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

export const tenantIdParamSchema = z.object({
  id: z
    .string()
    .uuid('ID inválido')
    .openapi({ example: '00000000-0000-0000-0000-000000000000' }),
});

export type TenantIdParam = z.infer<typeof tenantIdParamSchema>;

// ---------------------------------------------------------------------
// Logo — upload / delete / presigned URL. Mesma convenção do módulo
// whatsappContacts (chat): `logo_url` guarda objectKey do MinIO;
// endpoint separado devolve presigned URL pra renderizar.
// ---------------------------------------------------------------------

export const uploadLogoResponseSchema = z
  .object({
    objectKey: z.string().openapi({
      description:
        'Path estável no bucket (`tenants/{tenantId}/logo.{ext}`). ' +
        'Persistido em `tenants.logo_url` — passe em GET /tenants/{id}/logo-url ' +
        'pra receber presigned URL renderizável.',
    }),
    size: z.number().int().nonnegative(),
    mimeType: z.string(),
  })
  .openapi('UploadLogoResponse');

export type UploadLogoResponse = z.infer<typeof uploadLogoResponseSchema>;

export const logoUrlResponseSchema = z
  .object({
    url: z.string().url().nullable().openapi({
      description:
        'Presigned URL pra exibir o logo. Null quando tenant não tem logo ' +
        'persistido (frontend cai pro placeholder).',
    }),
    expiresInSec: z.number().int().positive(),
  })
  .openapi('LogoUrlResponse');

export type LogoUrlResponse = z.infer<typeof logoUrlResponseSchema>;
